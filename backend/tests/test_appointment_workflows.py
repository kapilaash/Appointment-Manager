from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.scheduling.routes import (
    BookingIn,
    _future_slots,
    _validated_meeting_url,
    complete_appointment,
    list_appointments,
)
from app.search import meili
from app.search.indexing import appointment_document
from app.users.models import UserRole


class FakeSession:
    def __init__(self, appointment: SimpleNamespace) -> None:
        self.appointment = appointment
        self.added: list[object] = []
        self.committed = False

    async def get(self, _model: object, _appointment_id: object) -> SimpleNamespace:
        return self.appointment

    def add(self, value: object) -> None:
        self.added.append(value)

    async def commit(self) -> None:
        self.committed = True


def test_meeting_links_require_https_and_reject_embedded_credentials() -> None:
    assert (
        _validated_meeting_url("  https://meet.example.com/room  ")
        == "https://meet.example.com/room"
    )
    assert _validated_meeting_url(None) is None
    assert _validated_meeting_url("  ") is None

    for link in (
        "http://meet.example.com/room",
        "https://user:password@meet.example.com/room",
        "https://meet example.com",
    ):
        with pytest.raises(ValueError):
            _validated_meeting_url(link)


def test_booking_schema_rejects_non_https_meeting_links() -> None:
    with pytest.raises(ValidationError):
        BookingIn(
            instructor_id=uuid4(),
            starts_at=datetime.now(UTC),
            student={"name": "Student", "email": "student@example.com", "country_code": "US"},
            meeting_url="http://meet.example.com/room",
        )


def test_available_slots_exclude_past_times_and_the_current_instant() -> None:
    now = datetime(2026, 11, 14, 15, 0, tzinfo=UTC)
    slots = [now - timedelta(minutes=30), now, now + timedelta(minutes=30)]

    assert _future_slots(slots, now=now) == [now + timedelta(minutes=30)]


@pytest.mark.asyncio
async def test_completion_marks_only_ended_confirmed_appointments() -> None:
    appointment_id = uuid4()
    appointment = SimpleNamespace(
        id=appointment_id,
        status="confirmed",
        ends_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    db = FakeSession(appointment)

    result = await complete_appointment(appointment_id, SimpleNamespace(role=UserRole.ADMIN), db)

    assert result == {"status": "completed"}
    assert appointment.status == "completed"
    assert db.committed
    assert len(db.added) == 1  # Keep the Meilisearch index in sync with the new status.


@pytest.mark.asyncio
async def test_completion_rejects_an_appointment_that_has_not_ended() -> None:
    appointment_id = uuid4()
    appointment = SimpleNamespace(
        id=appointment_id,
        status="confirmed",
        ends_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    db = FakeSession(appointment)

    with pytest.raises(HTTPException) as error:
        await complete_appointment(appointment_id, SimpleNamespace(role=UserRole.ADMIN), db)

    assert error.value.status_code == 409
    assert appointment.status == "confirmed"
    assert not db.committed


@pytest.mark.asyncio
async def test_only_admins_and_assigned_coaches_can_mark_a_demo_complete() -> None:
    appointment_id = uuid4()
    appointment = SimpleNamespace(
        id=appointment_id,
        status="confirmed",
        ends_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    db = FakeSession(appointment)

    with pytest.raises(HTTPException) as error:
        await complete_appointment(appointment_id, SimpleNamespace(role="student"), db)

    assert error.value.status_code == 403
    assert not db.committed


@pytest.mark.asyncio
async def test_appointment_ranges_require_both_timezone_aware_bounds() -> None:
    admin = SimpleNamespace(role=UserRole.ADMIN)
    start = datetime(2026, 11, 18, 12, tzinfo=UTC)

    for values in (
        {"start": start},
        {"start": datetime(2026, 11, 18, 12), "end": start + timedelta(days=1)},
        {"start": start, "end": start},
        {"start": start, "end": start + timedelta(days=367)},
    ):
        with pytest.raises(HTTPException) as error:
            await list_appointments(user=admin, db=object(), **values)
        assert error.value.status_code == 422


def test_deleted_student_history_is_indexed_without_personal_information() -> None:
    appointment = SimpleNamespace(id=uuid4(), instructor_id=uuid4(), status="completed")
    instructor = SimpleNamespace(display_name="Coach")

    document = appointment_document(appointment, None, instructor)

    assert document["booking_reference"] == str(appointment.id)
    assert document["student_name"] == ""
    assert document["student_email"] == ""


@pytest.mark.asyncio
async def test_meilisearch_index_enables_reasonable_first_letter_tolerance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[tuple[str, str, dict]] = []

    async def fake_request(method: str, path: str, **kwargs: object) -> dict:
        requests.append((method, path, kwargs))
        return {"uid": "appointments"} if method == "GET" else {"taskUid": 1}

    async def fake_wait(_task_uid: int) -> None:
        return None

    monkeypatch.setattr(meili, "_request", fake_request)
    monkeypatch.setattr(meili, "_wait_for_task", fake_wait)

    await meili.ensure_appointment_index()

    settings = requests[-1][2]["json"]["typoTolerance"]
    assert settings["minWordSizeForTypos"] == {"oneTypo": 3, "twoTypos": 4}
    assert settings["disableOnAttributes"] == ["booking_reference"]
