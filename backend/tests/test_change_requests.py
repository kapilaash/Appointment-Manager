"""Coach change requests need admin approval; admin actions still apply immediately.

These tests run the real FastAPI routes against PostgreSQL (partial unique indexes,
row locks and JSONB are Postgres features). Set TEST_DATABASE_URL to a database whose
name ends with ``_test``; the tests are skipped otherwise.
"""

import os
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.dependencies import get_current_user
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.scheduling import change_requests as cr
from app.scheduling.models import (
    Appointment,
    AvailabilityException,
    AvailabilityRule,
    ChangeRequest,
    NotificationEvent,
    OutboxEvent,
)
from app.users.models import Instructor, User, UserRole
from app.workers import main as worker


@pytest.fixture(scope="module")
def database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    if not (make_url(url).database or "").endswith("_test"):
        pytest.fail("Refusing to modify a database whose name does not end with _test")
    sync_engine = create_engine(make_url(url).set(drivername="postgresql+psycopg"))
    with sync_engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
    Base.metadata.drop_all(sync_engine)
    Base.metadata.create_all(sync_engine)
    with sync_engine.begin() as connection:
        connection.execute(text("""
            ALTER TABLE appointments ADD CONSTRAINT ex_appointments_instructor_occupied
            EXCLUDE USING gist (
                instructor_id WITH =,
                tstzrange(occupied_from, occupied_until, '[)') WITH &&
            ) WHERE (status = 'confirmed')
        """))
    yield url
    Base.metadata.drop_all(sync_engine)
    sync_engine.dispose()


@pytest.fixture
async def sessions(database_url: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(make_url(database_url).set(drivername="postgresql+asyncpg"))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


@pytest.fixture
async def world(sessions: async_sessionmaker[AsyncSession]) -> SimpleNamespace:
    """An admin, two coaches (Mon–Sun 08:00–20:00 UTC) and one confirmed demo next week."""
    async with sessions() as db:
        admin = User(email=f"admin-{uuid4()}@example.test", password_hash="x", role=UserRole.ADMIN, full_name="Admin")
        coach_user = User(email=f"coach-{uuid4()}@example.test", password_hash="x", role=UserRole.INSTRUCTOR, full_name="Coach One")
        other_user = User(email=f"other-{uuid4()}@example.test", password_hash="x", role=UserRole.INSTRUCTOR, full_name="Coach Two")
        db.add_all([admin, coach_user, other_user])
        await db.flush()
        coach = Instructor(user_id=coach_user.id, display_name="Coach One", timezone="UTC", country_code="GB")
        other = Instructor(user_id=other_user.id, display_name="Coach Two", timezone="UTC", country_code="GB")
        db.add_all([coach, other])
        await db.flush()
        db.add_all([
            AvailabilityRule(instructor_id=c.id, day_of_week=day, start_local_time=time(8), end_local_time=time(20))
            for c in (coach, other) for day in range(7)
        ])
        demo_day = date.today() + timedelta(days=7)
        starts = datetime.combine(demo_day, time(10), UTC)
        appointment = Appointment(
            instructor_id=coach.id, starts_at=starts, ends_at=starts + timedelta(hours=1),
            occupied_from=starts, occupied_until=starts + timedelta(hours=1),
            status="confirmed", idempotency_key=str(uuid4()),
        )
        db.add(appointment)
        await db.commit()
    acting = SimpleNamespace(user=admin)

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_session
    app.dependency_overrides[get_current_user] = lambda: acting.user
    world = SimpleNamespace(
        admin=admin, coach_user=coach_user, other_user=other_user, coach=coach, other=other,
        appointment=appointment, demo_day=demo_day, acting=acting, sessions=sessions,
    )
    yield world
    app.dependency_overrides.clear()


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        yield http


def act_as(world: SimpleNamespace, user: User) -> None:
    world.acting.user = user


async def rules_for(world: SimpleNamespace, coach: Instructor) -> list[tuple[int, time, time]]:
    async with world.sessions() as db:
        rows = (await db.scalars(select(AvailabilityRule).where(AvailabilityRule.instructor_id == coach.id))).all()
        return sorted((r.day_of_week, r.start_local_time, r.end_local_time) for r in rows)


async def request_row(world: SimpleNamespace, request_id: str) -> ChangeRequest:
    async with world.sessions() as db:
        item = await db.get(ChangeRequest, request_id)
        assert item is not None
        return item


NEW_RULES = {"rules": [{"day_of_week": 0, "start_local_time": "09:00", "end_local_time": "12:00"}], "note": "School term"}


async def test_coach_weekly_hours_wait_for_approval_then_apply(world, client) -> None:
    before = await rules_for(world, world.coach)
    act_as(world, world.coach_user)
    response = await client.put(f"/api/v1/instructors/{world.coach.id}/availability", json=NEW_RULES)
    assert response.status_code == 202, response.text
    request_id = response.json()["request_id"]
    assert await rules_for(world, world.coach) == before  # nothing changes yet

    availability = (await client.get(f"/api/v1/instructors/{world.coach.id}/availability")).json()
    assert [p["request_type"] for p in availability["pending_requests"]] == [cr.WEEKLY_AVAILABILITY]

    async with world.sessions() as db:
        events = (await db.scalars(select(OutboxEvent.event_type).where(OutboxEvent.aggregate_id == request_id))).all()
    assert events == [cr.SUBMITTED_EVENT]

    act_as(world, world.coach_user)
    assert (await client.post(f"/api/v1/change-requests/{request_id}/approve", json={})).status_code == 403

    act_as(world, world.admin)
    approved = await client.post(f"/api/v1/change-requests/{request_id}/approve", json={"review_note": "OK"})
    assert approved.status_code == 200, approved.text
    assert await rules_for(world, world.coach) == [(0, time(9), time(12))]
    item = await request_row(world, request_id)
    assert (item.status, item.reviewed_by, item.review_note) == (cr.APPROVED, world.admin.id, "OK")

    again = await client.post(f"/api/v1/change-requests/{request_id}/approve", json={})
    assert again.status_code == 409


async def test_new_weekly_request_supersedes_the_pending_one(world, client) -> None:
    act_as(world, world.coach_user)
    first = (await client.put(f"/api/v1/instructors/{world.coach.id}/availability", json=NEW_RULES)).json()["request_id"]
    second = (await client.put(f"/api/v1/instructors/{world.coach.id}/availability", json=NEW_RULES)).json()["request_id"]
    assert (await request_row(world, first)).status == cr.SUPERSEDED
    assert (await request_row(world, second)).status == cr.PENDING


async def test_admin_changes_still_apply_immediately(world, client) -> None:
    act_as(world, world.admin)
    response = await client.put(f"/api/v1/instructors/{world.coach.id}/availability", json=NEW_RULES)
    assert response.status_code == 200
    assert response.json()["saved"] is True
    assert await rules_for(world, world.coach) == [(0, time(9), time(12))]


async def test_time_off_request_then_rejection_needs_a_note(world, client) -> None:
    act_as(world, world.coach_user)
    body = {"exception_date": str(world.demo_day), "exception_type": "unavailable", "reason": "Exam day"}
    response = await client.post(f"/api/v1/instructors/{world.coach.id}/availability/exceptions", json=body)
    assert response.status_code == 202
    request_id = response.json()["request_id"]
    async with world.sessions() as db:
        assert (await db.scalars(select(AvailabilityException).where(AvailabilityException.instructor_id == world.coach.id))).all() == []

    act_as(world, world.admin)
    assert (await client.post(f"/api/v1/change-requests/{request_id}/reject", json={"review_note": " "})).status_code == 422
    rejected = await client.post(f"/api/v1/change-requests/{request_id}/reject", json={"review_note": "Demo already booked"})
    assert rejected.status_code == 200
    assert (await request_row(world, request_id)).status == cr.REJECTED


async def test_time_off_approval_reports_affected_bookings(world, client) -> None:
    act_as(world, world.coach_user)
    body = {"exception_date": str(world.demo_day), "exception_type": "unavailable", "reason": "Exam day"}
    request_id = (await client.post(f"/api/v1/instructors/{world.coach.id}/availability/exceptions", json=body)).json()["request_id"]
    act_as(world, world.admin)
    approved = (await client.post(f"/api/v1/change-requests/{request_id}/approve", json={})).json()
    assert approved["affected_bookings"] == [str(world.appointment.id)]
    async with world.sessions() as db:
        assert len((await db.scalars(select(AvailabilityException).where(AvailabilityException.instructor_id == world.coach.id))).all()) == 1


async def test_time_zone_change_needs_approval_but_name_does_not(world, client) -> None:
    act_as(world, world.coach_user)
    response = await client.patch("/api/v1/profile", json={
        "full_name": "Coach One", "display_name": "Coach Uno", "country_code": "IN", "timezone": "Asia/Kolkata",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["timezone"] == "UTC" and body["display_name"] == "Coach Uno"
    assert body["pending_request_id"]

    act_as(world, world.admin)
    assert (await client.post(f"/api/v1/change-requests/{body['pending_request_id']}/approve", json={})).status_code == 200
    async with world.sessions() as db:
        coach = await db.get(Instructor, world.coach.id)
        assert (coach.timezone, coach.country_code, coach.display_name) == ("Asia/Kolkata", "IN", "Coach Uno")


async def test_coach_cancel_request_cancels_only_after_approval(world, client) -> None:
    act_as(world, world.coach_user)
    url = f"/api/v1/appointments/{world.appointment.id}/cancel"
    response = await client.post(url, json={"reason": "Family emergency"})
    assert response.status_code == 202
    request_id = response.json()["request_id"]
    duplicate = await client.post(url, json={"reason": "Family emergency"})
    assert duplicate.status_code == 409  # one pending request per demo

    listed = (await client.get("/api/v1/appointments")).json()
    assert listed[0]["status"] == "confirmed"
    assert listed[0]["pending_request"]["request_type"] == cr.APPOINTMENT_CANCEL

    act_as(world, world.admin)
    assert (await client.post(f"/api/v1/change-requests/{request_id}/approve", json={})).status_code == 200
    async with world.sessions() as db:
        appointment = await db.get(Appointment, world.appointment.id)
        assert (appointment.status, appointment.cancellation_reason) == ("cancelled", "Family emergency")
        events = (await db.scalars(select(OutboxEvent.event_type).where(OutboxEvent.aggregate_id == world.appointment.id))).all()
        assert "booking.cancelled" in events


async def test_reschedule_conflict_on_approval_keeps_request_pending(world, client) -> None:
    target = datetime.combine(world.demo_day, time(14), UTC)
    act_as(world, world.coach_user)
    response = await client.post(
        f"/api/v1/appointments/{world.appointment.id}/reschedule",
        json={"starts_at": target.isoformat(), "reason": "Clash with tournament"},
    )
    assert response.status_code == 202, response.text
    request_id = response.json()["request_id"]

    # Someone books the requested time before the admin gets to the request.
    async with world.sessions() as db:
        db.add(Appointment(
            instructor_id=world.coach.id, starts_at=target, ends_at=target + timedelta(hours=1),
            occupied_from=target, occupied_until=target + timedelta(hours=1),
            status="confirmed", idempotency_key=str(uuid4()),
        ))
        await db.commit()

    act_as(world, world.admin)
    approved = await client.post(f"/api/v1/change-requests/{request_id}/approve", json={})
    assert approved.status_code == 409
    assert "no longer available" in approved.json()["detail"]
    assert (await request_row(world, request_id)).status == cr.PENDING
    async with world.sessions() as db:
        assert (await db.get(Appointment, world.appointment.id)).starts_at == world.appointment.starts_at


async def test_coaches_only_see_and_withdraw_their_own_requests(world, client) -> None:
    act_as(world, world.coach_user)
    request_id = (await client.put(f"/api/v1/instructors/{world.coach.id}/availability", json=NEW_RULES)).json()["request_id"]
    assert (await client.get("/api/v1/change-requests/pending-count")).json() == {"pending": 1}

    act_as(world, world.other_user)
    assert (await client.get("/api/v1/change-requests")).json()["items"] == []
    assert (await client.post(f"/api/v1/change-requests/{request_id}/withdraw")).status_code == 404
    assert (await client.post(f"/api/v1/appointments/{world.appointment.id}/cancel", json={"reason": "Not mine"})).status_code == 404

    act_as(world, world.coach_user)
    assert (await client.post(f"/api/v1/change-requests/{request_id}/withdraw")).status_code == 200
    assert (await request_row(world, request_id)).status == cr.WITHDRAWN


async def test_database_allows_only_one_pending_weekly_request(world) -> None:
    def pending() -> ChangeRequest:
        return ChangeRequest(instructor_id=world.other.id, request_type=cr.WEEKLY_AVAILABILITY, payload={"rules": []}, status=cr.PENDING)

    async with world.sessions() as db:
        db.add(pending())
        await db.commit()
        db.add(pending())
        with pytest.raises(IntegrityError):
            await db.commit()


async def test_submitted_request_emails_every_active_admin(world, client, monkeypatch) -> None:
    sent = []

    async def fake_send(message) -> None:
        sent.append((message["To"], message["Subject"]))

    monkeypatch.setattr(worker, "send_message", fake_send)
    act_as(world, world.coach_user)
    request_id = (await client.put(f"/api/v1/instructors/{world.coach.id}/availability", json=NEW_RULES)).json()["request_id"]

    async with world.sessions() as db:
        event = await db.scalar(select(OutboxEvent).where(OutboxEvent.aggregate_id == request_id))
        await worker._deliver_change_request_event(db, event_key=str(event.id), event_type=event.event_type, request_id=event.aggregate_id)
        # A retry of the same event must not email anyone twice.
        await worker._deliver_change_request_event(db, event_key=str(event.id), event_type=event.event_type, request_id=event.aggregate_id)
        admins = (await db.scalars(select(User.email).where(User.role == UserRole.ADMIN, User.is_active.is_(True)))).all()
        records = (await db.scalars(select(NotificationEvent).where(NotificationEvent.change_request_id == request_id))).all()
    assert sorted(to for to, _ in sent) == sorted(admins)
    assert all(subject.startswith("Approval needed: Weekly availability change") for _, subject in sent)
    assert {r.delivery_status for r in records} == {"provider_accepted"}


def test_reviewed_email_tells_the_coach_the_outcome_and_note() -> None:
    request = ChangeRequest(
        id=uuid4(), request_type=cr.APPOINTMENT_CANCEL, status=cr.REJECTED, review_note="Please keep this demo",
        payload={"reason": "Busy", "before": {"starts_at": "2030-01-07T10:00:00+00:00"}},
    )
    subject, body = worker.change_request_email(
        event_type=cr.REVIEWED_EVENT, request=request, coach_name="Coach One", coach_timezone="UTC", reviewer_email="a@x.test",
    )
    assert subject == "Your request was not approved: Demo cancellation"
    assert "Please keep this demo" in body
    assert "Cancel the demo on Mon 07 Jan 2030, 10:00 AM UTC." in body
