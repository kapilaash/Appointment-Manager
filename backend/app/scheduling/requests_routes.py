"""Admin review queue for coach change requests (availability, time zone, cancel, reschedule)."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user, require_admin
from app.db.session import get_db_session
from app.scheduling import change_requests as cr
from app.scheduling.models import Appointment, ChangeRequest, OutboxEvent
from app.scheduling.routes import (
    ExceptionIn,
    RuleIn,
    apply_cancel,
    apply_exception_add,
    apply_exception_remove,
    apply_reschedule,
    apply_timezone_change,
    apply_weekly_rules,
)
from app.users.models import Instructor, User, UserRole

router = APIRouter(prefix="/api/v1/change-requests", tags=["Change requests"])


class ReviewIn(BaseModel):
    review_note: str | None = Field(default=None, max_length=1000)

    @field_validator("review_note")
    @classmethod
    def clean_note(cls, value: str | None) -> str | None:
        return value.strip() or None if value else None


class RejectIn(BaseModel):
    review_note: str = Field(min_length=3, max_length=1000)

    @field_validator("review_note")
    @classmethod
    def clean_note(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Tell the coach why the request was rejected")
        return value


async def _coach_id_for(db: AsyncSession, user: User) -> UUID | None:
    if user.role != UserRole.INSTRUCTOR:
        return None
    coach_id = await db.scalar(select(Instructor.id).where(Instructor.user_id == user.id))
    if coach_id is None:
        raise HTTPException(404, "Coach profile not found")
    return coach_id


def _request_out(item: ChangeRequest, coach: Instructor | None, emails: dict[UUID, str]) -> dict:
    timezone_name = coach.timezone if coach else "UTC"
    proposed = {key: value for key, value in item.payload.items() if key != "before"}
    return {
        "id": str(item.id),
        "request_type": item.request_type,
        "label": cr.REQUEST_LABELS.get(item.request_type, item.request_type),
        "summary": cr.describe_request(item.request_type, item.payload, timezone_name),
        "status": item.status,
        "instructor_id": str(item.instructor_id),
        "instructor_name": coach.display_name if coach else "Coach",
        "instructor_timezone": timezone_name,
        "requested_by_email": emails.get(item.requested_by) if item.requested_by else None,
        "appointment_id": str(item.appointment_id) if item.appointment_id else None,
        "exception_id": str(item.exception_id) if item.exception_id else None,
        "coach_note": item.coach_note,
        "proposed": proposed,
        "before": item.payload.get("before"),
        "review_note": item.review_note,
        "reviewed_by_email": emails.get(item.reviewed_by) if item.reviewed_by else None,
        "reviewed_at": item.reviewed_at.isoformat() if item.reviewed_at else None,
        "created_at": item.created_at.isoformat(),
    }


async def _serialize(db: AsyncSession, items: list[ChangeRequest]) -> list[dict]:
    coach_ids = {item.instructor_id for item in items}
    user_ids = {uid for item in items for uid in (item.requested_by, item.reviewed_by) if uid}
    coaches = {c.id: c for c in (await db.scalars(select(Instructor).where(Instructor.id.in_(coach_ids)))).all()} if coach_ids else {}
    emails = {uid: email for uid, email in (await db.execute(select(User.id, User.email).where(User.id.in_(user_ids)))).all()} if user_ids else {}
    return [_request_out(item, coaches.get(item.instructor_id), emails) for item in items]


@router.get("")
async def list_change_requests(
    status: str | None = Query(default=None),
    instructor_id: UUID | None = None,
    before: datetime | None = Query(default=None, description="Cursor: created_at of the last item already shown"),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    if status is not None and status not in cr.STATUSES:
        raise HTTPException(422, "Invalid request status")
    query = select(ChangeRequest)
    own_coach_id = await _coach_id_for(db, user)
    if own_coach_id is not None:
        query = query.where(ChangeRequest.instructor_id == own_coach_id)
    elif instructor_id is not None:
        query = query.where(ChangeRequest.instructor_id == instructor_id)
    if status:
        query = query.where(ChangeRequest.status == status)
    if before is not None:
        query = query.where(ChangeRequest.created_at < before)
    # Pending requests are worked oldest-first; history reads newest-first.
    order = ChangeRequest.created_at.asc() if status == cr.PENDING else ChangeRequest.created_at.desc()
    rows = list((await db.scalars(query.order_by(order, ChangeRequest.id).limit(limit + 1))).all())
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "items": await _serialize(db, rows),
        "next_cursor": rows[-1].created_at.isoformat() if has_more and status != cr.PENDING else None,
    }


@router.get("/pending-count")
async def pending_count(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> dict[str, int]:
    query = select(func.count(ChangeRequest.id)).where(ChangeRequest.status == cr.PENDING)
    own_coach_id = await _coach_id_for(db, user)
    if own_coach_id is not None:
        query = query.where(ChangeRequest.instructor_id == own_coach_id)
    return {"pending": int(await db.scalar(query) or 0)}


async def _locked_pending(db: AsyncSession, request_id: UUID, owner_coach_id: UUID | None = None) -> ChangeRequest:
    query = select(ChangeRequest).where(ChangeRequest.id == request_id)
    if owner_coach_id is not None:
        query = query.where(ChangeRequest.instructor_id == owner_coach_id)
    item = await db.scalar(query.with_for_update())
    if item is None:
        raise HTTPException(404, "Request not found")
    if item.status != cr.PENDING:
        raise HTTPException(409, f"This request is already {item.status}")
    return item


def _queue_reviewed(db: AsyncSession, item: ChangeRequest) -> None:
    db.add(OutboxEvent(
        event_type=cr.REVIEWED_EVENT, aggregate_id=item.id,
        payload={"change_request_id": str(item.id), "status": item.status},
        processing_status="pending", attempt_count=0,
    ))


async def _apply(db: AsyncSession, item: ChangeRequest) -> list[str]:
    """Apply an approved request with the same code path admins use directly."""
    coach = await db.get(Instructor, item.instructor_id)
    if coach is None:
        raise HTTPException(409, "The coach for this request no longer exists")
    payload = item.payload
    if item.request_type == cr.WEEKLY_AVAILABILITY:
        return await apply_weekly_rules(db, coach, [RuleIn.model_validate(rule) for rule in payload["rules"]])
    if item.request_type == cr.EXCEPTION_ADD:
        _, affected = await apply_exception_add(db, coach, ExceptionIn.model_validate(payload))
        return affected
    if item.request_type == cr.EXCEPTION_REMOVE:
        if item.exception_id is None:
            raise HTTPException(409, "This request has no time-off entry to remove")
        await apply_exception_remove(db, coach, item.exception_id)
        return []
    if item.request_type == cr.TIMEZONE_CHANGE:
        await apply_timezone_change(db, coach, payload["timezone"], payload.get("country_code"))
        return []
    if item.request_type in (cr.APPOINTMENT_CANCEL, cr.APPOINTMENT_RESCHEDULE):
        appointment = await db.scalar(
            select(Appointment).options(selectinload(Appointment.student)).where(Appointment.id == item.appointment_id)
        ) if item.appointment_id else None
        if appointment is None:
            raise HTTPException(409, "The demo for this request no longer exists")
        if item.request_type == cr.APPOINTMENT_CANCEL:
            await apply_cancel(db, appointment, payload["reason"])
        else:
            await apply_reschedule(db, appointment, datetime.fromisoformat(payload["starts_at"]), payload["reason"])
        return []
    raise HTTPException(409, "Unsupported request type")


@router.post("/{request_id}/approve")
async def approve_change_request(
    request_id: UUID,
    data: ReviewIn | None = None,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    item = await _locked_pending(db, request_id)
    # Mark approved first so the apply step's "supersede other pending requests" skips this one.
    item.status = cr.APPROVED
    item.reviewed_by = admin.id
    item.reviewed_at = datetime.now(UTC)
    item.review_note = data.review_note if data else None
    try:
        affected = await _apply(db, item)
    except HTTPException as exc:
        await db.rollback()
        # The request stays pending so the admin can reject it or the coach can resubmit.
        raise HTTPException(409, f"Could not apply this request: {exc.detail}") from exc
    _queue_reviewed(db, item)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Could not apply this request: the time was just booked. Reject it or ask the coach to pick another time.") from exc
    return {
        "request": (await _serialize(db, [item]))[0],
        "affected_bookings": affected,
        "warning": "Existing bookings were preserved. Review these classes." if affected else None,
    }


@router.post("/{request_id}/reject")
async def reject_change_request(
    request_id: UUID,
    data: RejectIn,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    item = await _locked_pending(db, request_id)
    item.status = cr.REJECTED
    item.reviewed_by = admin.id
    item.reviewed_at = datetime.now(UTC)
    item.review_note = data.review_note
    _queue_reviewed(db, item)
    await db.commit()
    return {"request": (await _serialize(db, [item]))[0]}


@router.post("/{request_id}/withdraw")
async def withdraw_change_request(
    request_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    own_coach_id = await _coach_id_for(db, user)
    if own_coach_id is None:
        raise HTTPException(403, "Only the coach who made a request can withdraw it")
    item = await _locked_pending(db, request_id, own_coach_id)
    item.status = cr.WITHDRAWN
    await db.commit()
    return {"request": (await _serialize(db, [item]))[0]}
