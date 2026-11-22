import hashlib
from collections.abc import Awaitable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, cast
from urllib.parse import urlsplit
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, field_validator
from redis.exceptions import RedisError
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user, require_admin
from app.auth.session_store import get_redis_client
from app.availability.engine import Interval, actual_windows, generate_slots, merge, subtract
from app.db.session import get_db_session
from app.scheduling import change_requests as cr
from app.scheduling.models import (
    AcademySetting,
    Appointment,
    AvailabilityException,
    AvailabilityRule,
    ChangeRequest,
    NotificationEvent,
    OutboxEvent,
    Student,
)
from app.search.meili import SEARCH_EVENT_TYPE, SearchUnavailable
from app.search.meili import search_appointments as search_appointment_documents
from app.users.models import Instructor, User, UserRole

router = APIRouter(prefix="/api/v1", tags=["Scheduling"])


def _validated_meeting_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    cleaned = value.strip()
    if any(character.isspace() for character in cleaned):
        raise ValueError("Meeting links cannot contain spaces")
    try:
        parsed = urlsplit(cleaned)
        hostname = parsed.hostname
    except ValueError as exc:
        raise ValueError("Enter a valid HTTPS meeting link") from exc
    if parsed.scheme.lower() != "https" or not hostname or parsed.username or parsed.password:
        raise ValueError("Meeting links must be valid HTTPS URLs without embedded credentials")
    return cleaned


class RuleIn(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    start_local_time: time
    end_local_time: time
    effective_from: date | None = None
    effective_until: date | None = None


class AvailabilityIn(BaseModel):
    rules: list[RuleIn] = Field(max_length=80)
    # Optional context a coach can give the approving administrator.
    note: str | None = Field(default=None, max_length=1000)


class ExceptionIn(BaseModel):
    exception_date: date
    start_local_time: time | None = None
    end_local_time: time | None = None
    exception_type: str
    reason: str | None = Field(default=None, max_length=240)


class ProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    display_name: str = Field(min_length=1, max_length=150)
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    timezone: str = Field(min_length=1, max_length=64)
    meeting_url: str | None = Field(default=None, max_length=2048)

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Use a valid IANA time zone") from exc
        return value

    @field_validator("meeting_url")
    @classmethod
    def valid_meeting_link(cls, value: str | None) -> str | None:
        return _validated_meeting_url(value)


class StudentIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    parent_name: str | None = Field(default=None, max_length=160)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=40)
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    timezone: str = "UTC"


class BookingIn(BaseModel):
    instructor_id: UUID
    starts_at: datetime
    duration_minutes: int = Field(default=60, ge=15, le=180)
    student: StudentIn
    notes: str | None = Field(default=None, max_length=4000)
    meeting_url: str | None = Field(default=None, max_length=2048)

    @field_validator("meeting_url")
    @classmethod
    def valid_meeting_link(cls, value: str | None) -> str | None:
        return _validated_meeting_url(value)


class PublicBookingIn(BookingIn):
    # Honeypot field for unsophisticated form bots; it is hidden from people.
    website: str = Field(default="", max_length=200)


class AppointmentRescheduleIn(BaseModel):
    starts_at: datetime
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A reschedule reason is required")
        return value


class AppointmentCancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A cancellation reason is required")
        return value


class AppointmentSearchIn(BaseModel):
    query: str = Field(max_length=200)
    status: str | None = None


class InstructorUpdateIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=150)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    is_available_for_booking: bool | None = None
    meeting_url: str | None = Field(default=None, max_length=2048)

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Use a valid IANA time zone") from exc
        return value

    @field_validator("meeting_url")
    @classmethod
    def valid_meeting_link(cls, value: str | None) -> str | None:
        return _validated_meeting_url(value)


class AcademySettingsIn(BaseModel):
    demo_duration_minutes: int = Field(ge=15, le=180)
    slot_interval_minutes: int = Field(ge=5, le=180)
    buffer_before_minutes: int = Field(ge=0, le=120)
    buffer_after_minutes: int = Field(ge=0, le=120)


DEFAULT_SETTINGS = {
    "demo_duration_minutes": 60,
    "slot_interval_minutes": 30,
    "buffer_before_minutes": 0,
    "buffer_after_minutes": 0,
}


async def _academy_settings(db: AsyncSession) -> dict[str, int]:
    rows = (await db.scalars(select(AcademySetting))).all()
    values = {row.key: row.value for row in rows}
    return {key: int(values.get(key, value)) for key, value in DEFAULT_SETTINGS.items()}


async def _instructor(db: AsyncSession, user: User, instructor_id: UUID) -> Instructor:
    query = select(Instructor).where(Instructor.id == instructor_id)
    if user.role == UserRole.INSTRUCTOR:
        query = query.where(Instructor.user_id == user.id)
    instructor = await db.scalar(query)
    if instructor is None:
        raise HTTPException(404, "Coach not found")
    return instructor


def _queue_appointment_search_sync(db: AsyncSession, appointment_id: UUID) -> None:
    db.add(OutboxEvent(
        event_type=SEARCH_EVENT_TYPE,
        aggregate_id=appointment_id,
        payload={"appointment_id": str(appointment_id)},
        processing_status="pending",
        attempt_count=0,
    ))


async def _queue_coach_search_sync(db: AsyncSession, instructor_id: UUID) -> None:
    appointment_ids = await db.scalars(select(Appointment.id).where(Appointment.instructor_id == instructor_id))
    for appointment_id in appointment_ids:
        _queue_appointment_search_sync(db, appointment_id)


async def _slots(
    db: AsyncSession,
    coach: Instructor,
    first: date,
    last: date,
    duration: int | None = None,
    exclude_appointment_id: UUID | None = None,
) -> list[datetime]:
    if last < first or (last - first).days > 90:
        raise HTTPException(422, "Date range must be between 0 and 90 days")
    coach_user = await db.get(User, coach.user_id)
    if not coach.is_available_for_booking or coach_user is None or not coach_user.is_active:
        return []
    config = await _academy_settings(db)
    zone = ZoneInfo(coach.timezone)
    from_utc = datetime.combine(first, time.min, zone).astimezone(UTC)
    until_utc = datetime.combine(last + timedelta(days=1), time.min, zone).astimezone(UTC)
    rules = list((await db.scalars(select(AvailabilityRule).where(AvailabilityRule.instructor_id == coach.id))).all())
    exceptions = list((await db.scalars(select(AvailabilityException).where(
        AvailabilityException.instructor_id == coach.id,
        AvailabilityException.exception_date.between(first, last),
    ))).all())
    busy_rows = list((await db.scalars(select(Appointment).where(
        Appointment.instructor_id == coach.id,
        Appointment.status == "confirmed",
        Appointment.occupied_from < until_utc,
        Appointment.occupied_until > from_utc,
        *([Appointment.id != exclude_appointment_id] if exclude_appointment_id else []),
    ))).all())
    busy = [Interval(row.occupied_from, row.occupied_until) for row in busy_rows]
    try:
        slots = generate_slots(
            first,
            last,
            coach.timezone,
            rules,
            exceptions,
            busy,
            duration or config["demo_duration_minutes"],
            config["slot_interval_minutes"],
            config["buffer_before_minutes"],
            config["buffer_after_minutes"],
        )
        return _future_slots(slots)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _future_slots(slots: list[datetime], *, now: datetime | None = None) -> list[datetime]:
    current = (now or datetime.now(UTC)).astimezone(UTC)
    return [slot for slot in slots if slot > current]


def _rule_json(rule: AvailabilityRule | RuleIn) -> dict:
    return {
        "day_of_week": rule.day_of_week,
        "start_local_time": rule.start_local_time.isoformat(),
        "end_local_time": rule.end_local_time.isoformat(),
        "effective_from": rule.effective_from.isoformat() if rule.effective_from else None,
        "effective_until": rule.effective_until.isoformat() if rule.effective_until else None,
    }


def _exception_json(item: AvailabilityException) -> dict:
    return {
        "id": str(item.id),
        "exception_date": item.exception_date.isoformat(),
        "start_local_time": item.start_local_time.isoformat() if item.start_local_time else None,
        "end_local_time": item.end_local_time.isoformat() if item.end_local_time else None,
        "exception_type": item.exception_type,
        "reason": item.reason,
    }


def _appointment_snapshot(appointment: Appointment) -> dict:
    student = appointment.__dict__.get("student")
    return {
        "starts_at": appointment.starts_at.isoformat(),
        "ends_at": appointment.ends_at.isoformat(),
        "student_name": student.name if student else None,
        "student_timezone": student.timezone if student else None,
    }


# ---- Changes shared by direct admin actions and approved coach requests.
# These functions stage changes on the session and never commit, so the caller
# decides the transaction boundary.

def validate_rules(rules: list[RuleIn]) -> list[RuleIn]:
    ordered = sorted(rules, key=lambda r: (r.day_of_week, r.start_local_time))
    for i, current in enumerate(ordered):
        if current.start_local_time >= current.end_local_time:
            raise HTTPException(422, "End time must be later than start time")
        for other in ordered[i + 1:]:
            if other.day_of_week != current.day_of_week:
                break
            if other.start_local_time < current.end_local_time:
                raise HTTPException(422, "Availability intervals overlap")
    return ordered


async def apply_weekly_rules(db: AsyncSession, coach: Instructor, rules: list[RuleIn]) -> list[str]:
    """Replace the coach's weekly rules and return confirmed bookings now outside them."""
    rules = validate_rules(rules)
    now = datetime.now(UTC)
    future = (await db.scalars(select(Appointment).where(
        Appointment.instructor_id == coach.id,
        Appointment.status == "confirmed",
        Appointment.ends_at >= now,
    ))).all()
    existing_exceptions = list((await db.scalars(select(AvailabilityException).where(AvailabilityException.instructor_id == coach.id))).all())
    affected = []
    for appointment in future:
        local_day = appointment.starts_at.astimezone(ZoneInfo(coach.timezone)).date()
        windows = actual_windows(local_day, coach.timezone, rules, existing_exceptions)  # type: ignore[arg-type]
        if not any(w.start <= appointment.occupied_from and appointment.occupied_until <= w.end for w in windows):
            affected.append(str(appointment.id))
    await db.execute(delete(AvailabilityRule).where(AvailabilityRule.instructor_id == coach.id))
    db.add_all([AvailabilityRule(instructor_id=coach.id, **rule.model_dump()) for rule in rules])
    return affected


def validate_exception(data: ExceptionIn) -> None:
    if data.exception_type not in {"unavailable", "additional_available"}:
        raise HTTPException(422, "Invalid exception type")
    if (data.start_local_time is None) != (data.end_local_time is None):
        raise HTTPException(422, "Provide both local times or leave both blank for all day")
    if data.start_local_time is not None and data.end_local_time is not None and data.start_local_time >= data.end_local_time:
        raise HTTPException(422, "End time must be later than start time")


async def apply_exception_add(db: AsyncSession, coach: Instructor, data: ExceptionIn) -> tuple[AvailabilityException, list[str]]:
    validate_exception(data)
    item = AvailabilityException(instructor_id=coach.id, **data.model_dump())
    db.add(item)
    affected: list[str] = []
    if data.exception_type == "unavailable":
        local_zone = ZoneInfo(coach.timezone)
        if data.start_local_time is None or data.end_local_time is None:
            block_start = datetime.combine(data.exception_date, time.min, local_zone).astimezone(UTC)
            block_end = datetime.combine(data.exception_date + timedelta(days=1), time.min, local_zone).astimezone(UTC)
        else:
            block_start = datetime.combine(data.exception_date, data.start_local_time, local_zone).astimezone(UTC)
            block_end = datetime.combine(data.exception_date, data.end_local_time, local_zone).astimezone(UTC)
        rows = (await db.scalars(select(Appointment).where(
            Appointment.instructor_id == coach.id,
            Appointment.status == "confirmed",
            Appointment.occupied_from < block_end,
            Appointment.occupied_until > block_start,
        ))).all()
        affected = [str(row.id) for row in rows]
    return item, affected


async def _supersede_pending(db: AsyncSession, *conditions: Any) -> None:
    """Retire pending coach requests that an admin action has made obsolete."""
    await db.execute(
        update(ChangeRequest)
        .where(ChangeRequest.status == cr.PENDING, *conditions)
        .values(status=cr.SUPERSEDED, updated_at=datetime.now(UTC))
    )


async def apply_exception_remove(db: AsyncSession, coach: Instructor, exception_id: UUID) -> None:
    item = await db.scalar(select(AvailabilityException).where(AvailabilityException.id == exception_id, AvailabilityException.instructor_id == coach.id))
    if item is None:
        raise HTTPException(404, "Availability exception not found")
    await _supersede_pending(db, ChangeRequest.request_type == cr.EXCEPTION_REMOVE, ChangeRequest.exception_id == exception_id)
    await db.delete(item)


async def apply_timezone_change(db: AsyncSession, coach: Instructor, timezone_name: str, country_code: str | None) -> None:
    coach.timezone = timezone_name
    coach.country_code = country_code
    await _queue_coach_search_sync(db, coach.id)


async def apply_cancel(db: AsyncSession, appointment: Appointment, reason: str) -> None:
    if appointment.status == "cancelled":
        return
    if appointment.status != "confirmed":
        raise HTTPException(409, "This appointment can no longer be cancelled")
    appointment.status = "cancelled"
    appointment.cancellation_reason = reason
    db.add(OutboxEvent(
        event_type="booking.cancelled",
        aggregate_id=appointment.id,
        payload={"appointment_id": str(appointment.id), "reason": reason},
        processing_status="pending",
        attempt_count=0,
    ))
    _queue_appointment_search_sync(db, appointment.id)
    await _supersede_pending(db, ChangeRequest.appointment_id == appointment.id)


async def validated_reschedule_start(db: AsyncSession, appointment: Appointment, starts_at: datetime) -> tuple[datetime, int]:
    """Check that a confirmed appointment can move to starts_at; return the UTC start and duration."""
    if appointment.status != "confirmed":
        raise HTTPException(409, "Only confirmed appointments can be rescheduled")
    if starts_at.tzinfo is None:
        raise HTTPException(422, "Appointment start must include a time zone")
    start = starts_at.astimezone(UTC)
    duration = int((appointment.ends_at - appointment.starts_at).total_seconds() // 60)
    coach = await db.get(Instructor, appointment.instructor_id)
    if coach is None:
        raise HTTPException(409, "The assigned coach no longer exists")
    local_date = start.astimezone(ZoneInfo(coach.timezone)).date()
    if start not in await _slots(db, coach, local_date, local_date, duration, appointment.id):
        raise HTTPException(409, "This time is no longer available")
    return start, duration


async def apply_reschedule(db: AsyncSession, appointment: Appointment, starts_at: datetime, reason: str) -> None:
    start, duration = await validated_reschedule_start(db, appointment, starts_at)
    appointment.starts_at = start
    appointment.ends_at = start + timedelta(minutes=duration)
    appointment.reschedule_reason = reason
    appointment.occupied_from = appointment.starts_at
    appointment.occupied_until = appointment.ends_at
    db.add(OutboxEvent(
        event_type="booking.rescheduled",
        aggregate_id=appointment.id,
        payload={
            "appointment_id": str(appointment.id),
            "reason": reason,
            "starts_at": start.isoformat(),
            "ends_at": appointment.ends_at.isoformat(),
        },
        processing_status="pending",
        attempt_count=0,
    ))
    _queue_appointment_search_sync(db, appointment.id)
    await _supersede_pending(db, ChangeRequest.appointment_id == appointment.id)


async def submit_change_request(
    db: AsyncSession,
    *,
    coach: Instructor,
    user: User,
    request_type: str,
    payload: dict,
    appointment_id: UUID | None = None,
    exception_id: UUID | None = None,
    coach_note: str | None = None,
    replace_pending: bool = False,
) -> ChangeRequest:
    """Record a coach request (with any other staged changes), queue admin emails, and commit."""
    if replace_pending:
        await _supersede_pending(db, ChangeRequest.instructor_id == coach.id, ChangeRequest.request_type == request_type)
    note = coach_note.strip() if coach_note and coach_note.strip() else None
    request = ChangeRequest(
        instructor_id=coach.id, requested_by=user.id, request_type=request_type, payload=payload,
        appointment_id=appointment_id, exception_id=exception_id, coach_note=note, status=cr.PENDING,
    )
    db.add(request)
    try:
        await db.flush()
        db.add(OutboxEvent(
            event_type=cr.SUBMITTED_EVENT, aggregate_id=request.id,
            payload={"change_request_id": str(request.id)}, processing_status="pending", attempt_count=0,
        ))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "A matching request is already waiting for admin approval. Refresh to see it.") from exc
    return request


def pending_response(request: ChangeRequest, message: str) -> JSONResponse:
    return JSONResponse(status_code=202, content={"request_id": str(request.id), "status": cr.PENDING, "message": message})


@router.get("/profile")
async def get_profile(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> dict:
    profile = await db.scalar(select(Instructor).where(Instructor.user_id == user.id)) if user.role == UserRole.INSTRUCTOR else None
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name, "role": user.role.value,
            "display_name": profile.display_name if profile else user.full_name,
            "country_code": profile.country_code if profile else None,
            "timezone": profile.timezone if profile else "UTC",
            "meeting_url": profile.meeting_url if profile else None}


@router.get("/settings")
async def scheduling_settings(
    _: User = Depends(require_admin), db: AsyncSession = Depends(get_db_session)
) -> dict[str, int]:
    return await _academy_settings(db)


@router.put("/settings")
async def update_scheduling_settings(
    data: AcademySettingsIn,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, int]:
    for key, value in data.model_dump().items():
        setting = await db.get(AcademySetting, key)
        if setting is None:
            db.add(AcademySetting(key=key, value=str(value)))
        else:
            setting.value = str(value)
    await db.commit()
    return data.model_dump()


@router.get("/integrations")
async def integrations(_: User = Depends(require_admin)) -> list[dict]:
    # No external meeting account is connected in this release.
    return []


@router.patch("/profile")
async def update_profile(data: ProfileIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> dict:
    user.full_name = data.full_name.strip()
    profile: Instructor | None = None
    pending: ChangeRequest | None = None
    if user.role == UserRole.INSTRUCTOR:
        if data.country_code is None:
            raise HTTPException(422, "Select the coach's country")
        profile = await db.scalar(select(Instructor).where(Instructor.user_id == user.id))
        if profile is None:
            raise HTTPException(409, "Coach profile is missing")
        profile.display_name = data.display_name.strip()
        if "meeting_url" in data.model_fields_set:
            profile.meeting_url = data.meeting_url
        await _queue_coach_search_sync(db, profile.id)
        # A time zone or country change moves every weekly slot, so an admin must approve it.
        if (data.timezone, data.country_code) != (profile.timezone, profile.country_code):
            pending = await submit_change_request(
                db, coach=profile, user=user, request_type=cr.TIMEZONE_CHANGE, replace_pending=True,
                payload={"timezone": data.timezone, "country_code": data.country_code,
                         "before": {"timezone": profile.timezone, "country_code": profile.country_code}},
            )
    if pending is None:
        await db.commit()
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name, "role": user.role.value,
            "display_name": profile.display_name if profile else user.full_name,
            "country_code": profile.country_code if profile else None,
            "timezone": profile.timezone if profile else data.timezone,
            "meeting_url": profile.meeting_url if profile else None,
            "pending_request_id": str(pending.id) if pending else None}


@router.get("/instructors")
async def list_instructors(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> list[dict]:
    query = select(Instructor, User).join(User, Instructor.user_id == User.id).order_by(Instructor.display_name)
    if user.role == UserRole.INSTRUCTOR:
        query = query.where(Instructor.user_id == user.id)
    rows = (await db.execute(query)).all()
    return [{"id": str(i.id), "user_id": str(u.id), "display_name": i.display_name, "timezone": i.timezone,
             "country_code": i.country_code,
             "meeting_url": i.meeting_url,
             "is_available_for_booking": i.is_available_for_booking and u.is_active, "email": u.email, "is_active": u.is_active}
            for i, u in rows]


async def _enforce_public_rate_limit(request: Request, *, scope: str, limit: int, window_seconds: int) -> None:
    # request.client is resolved by uvicorn from X-Forwarded-For only when the peer is a trusted proxy
    # (FORWARDED_ALLOW_IPS), so callers cannot spoof it to dodge the limit.
    client_id = request.client.host if request.client else "unknown"
    digest = hashlib.sha256(client_id.encode("utf-8")).hexdigest()
    redis = get_redis_client()
    try:
        # The asyncio client always returns an awaitable; redis-py's shared stubs also allow str.
        count = await cast("Awaitable[int]", redis.eval(
            "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n",
            1,
            f"public-booking:{scope}:{digest}",
            str(window_seconds),
        ))
    except RedisError as exc:
        raise HTTPException(503, "Booking is temporarily unavailable. Please try again shortly.") from exc
    if int(count) > limit:
        raise HTTPException(
            status_code=429,
            detail="Too many booking requests. Please wait a little and try again.",
            headers={"Retry-After": str(window_seconds)},
        )


@router.get("/public/instructors")
async def public_booking_instructors(request: Request, db: AsyncSession = Depends(get_db_session)) -> list[dict[str, str]]:
    await _enforce_public_rate_limit(request, scope="instructors", limit=120, window_seconds=60)
    rows = (await db.execute(
        select(Instructor, User)
        .join(User, User.id == Instructor.user_id)
        .where(Instructor.is_available_for_booking.is_(True), User.is_active.is_(True))
        .order_by(Instructor.display_name)
    )).all()
    # Never expose coach email addresses, account IDs, or meeting links publicly.
    return [
        {"id": str(coach.id), "display_name": coach.display_name, "timezone": coach.timezone}
        for coach, _user in rows
    ]


@router.get("/public/booking-settings")
async def public_booking_settings(request: Request, db: AsyncSession = Depends(get_db_session)) -> dict[str, int]:
    await _enforce_public_rate_limit(request, scope="settings", limit=120, window_seconds=60)
    config = await _academy_settings(db)
    return {"demo_duration_minutes": config["demo_duration_minutes"]}


@router.get("/public/instructors/{instructor_id}/available-slots")
async def public_available_slots(
    instructor_id: UUID,
    request: Request,
    start_date: date,
    end_date: date,
    duration_minutes: int | None = Query(default=None, ge=15, le=180),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    await _enforce_public_rate_limit(request, scope="slots", limit=120, window_seconds=60)
    if end_date < start_date or (end_date - start_date).days > 30:
        raise HTTPException(422, "Date range must be between 0 and 30 days")
    coach = await db.scalar(
        select(Instructor)
        .join(User, User.id == Instructor.user_id)
        .where(
            Instructor.id == instructor_id,
            Instructor.is_available_for_booking.is_(True),
            User.is_active.is_(True),
        )
    )
    if coach is None:
        raise HTTPException(404, "Coach is not available for booking")
    return {
        "timezone": coach.timezone,
        "slots": await _slots(db, coach, start_date, end_date, duration_minutes),
    }


@router.patch("/instructors/{instructor_id}")
async def update_instructor(
    instructor_id: UUID,
    data: InstructorUpdateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    coach = await _instructor(db, user, instructor_id)
    is_coach = user.role == UserRole.INSTRUCTOR
    if is_coach and data.is_available_for_booking is not None:
        raise HTTPException(403, "Only an administrator can change booking access")
    if data.display_name is not None:
        coach.display_name = data.display_name.strip()
    new_timezone = data.timezone if data.timezone is not None else coach.timezone
    new_country = data.country_code if data.country_code is not None else coach.country_code
    zone_changed = (new_timezone, new_country) != (coach.timezone, coach.country_code)
    if zone_changed and not is_coach:
        coach.timezone = new_timezone
        coach.country_code = new_country
    if "meeting_url" in data.model_fields_set:
        coach.meeting_url = data.meeting_url
    if data.is_available_for_booking is not None:
        coach.is_available_for_booking = data.is_available_for_booking
    if data.display_name is not None or zone_changed:
        await _queue_coach_search_sync(db, coach.id)
    pending: ChangeRequest | None = None
    if zone_changed and is_coach:
        # A time zone or country change moves every weekly slot, so an admin must approve it.
        pending = await submit_change_request(
            db, coach=coach, user=user, request_type=cr.TIMEZONE_CHANGE, replace_pending=True,
            payload={"timezone": new_timezone, "country_code": new_country,
                     "before": {"timezone": coach.timezone, "country_code": coach.country_code}},
        )
    else:
        await db.commit()
    return {
        "pending_request_id": str(pending.id) if pending else None,
        "id": str(coach.id),
        "display_name": coach.display_name,
        "timezone": coach.timezone,
        "country_code": coach.country_code,
        "meeting_url": coach.meeting_url,
        "is_available_for_booking": coach.is_available_for_booking,
    }


@router.get("/instructors/{instructor_id}/availability")
async def get_availability(instructor_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> dict:
    coach = await _instructor(db, user, instructor_id)
    rules = (await db.scalars(select(AvailabilityRule).where(AvailabilityRule.instructor_id == coach.id).order_by(AvailabilityRule.day_of_week, AvailabilityRule.start_local_time))).all()
    exceptions = (await db.scalars(select(AvailabilityException).where(AvailabilityException.instructor_id == coach.id).order_by(AvailabilityException.exception_date))).all()
    pending = (await db.scalars(select(ChangeRequest).where(
        ChangeRequest.instructor_id == coach.id,
        ChangeRequest.status == cr.PENDING,
        ChangeRequest.request_type.in_([cr.WEEKLY_AVAILABILITY, cr.EXCEPTION_ADD, cr.EXCEPTION_REMOVE, cr.TIMEZONE_CHANGE]),
    ).order_by(ChangeRequest.created_at))).all()
    return {
        "timezone": coach.timezone,
        "country_code": coach.country_code,
        "rules": [{"id": str(rule.id), **_rule_json(rule)} for rule in rules],
        "exceptions": [_exception_json(item) for item in exceptions],
        "pending_requests": [
            {
                "id": str(item.id),
                "request_type": item.request_type,
                "created_at": item.created_at.isoformat(),
                "exception_id": str(item.exception_id) if item.exception_id else None,
                "payload": {key: value for key, value in item.payload.items() if key != "before"},
            }
            for item in pending
        ],
    }


PRESERVED_WARNING = "Existing bookings were preserved. Review these classes."


@router.put("/instructors/{instructor_id}/availability", response_model=None)
async def replace_availability(instructor_id: UUID, data: AvailabilityIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> dict | JSONResponse:
    coach = await _instructor(db, user, instructor_id)
    rules = validate_rules(data.rules)
    if user.role == UserRole.INSTRUCTOR:
        current = (await db.scalars(select(AvailabilityRule).where(AvailabilityRule.instructor_id == coach.id).order_by(AvailabilityRule.day_of_week, AvailabilityRule.start_local_time))).all()
        request = await submit_change_request(
            db, coach=coach, user=user, request_type=cr.WEEKLY_AVAILABILITY, replace_pending=True, coach_note=data.note,
            payload={"rules": [_rule_json(rule) for rule in rules], "before": {"rules": [_rule_json(rule) for rule in current]}},
        )
        return pending_response(request, "Your weekly hours were sent to an administrator for approval.")
    affected = await apply_weekly_rules(db, coach, rules)
    await db.commit()
    return {"saved": True, "affected_bookings": affected, "warning": PRESERVED_WARNING if affected else None}


@router.post("/instructors/{instructor_id}/availability/exceptions", status_code=201, response_model=None)
async def add_exception(instructor_id: UUID, data: ExceptionIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> dict | JSONResponse:
    coach = await _instructor(db, user, instructor_id)
    validate_exception(data)
    if user.role == UserRole.INSTRUCTOR:
        request = await submit_change_request(
            db, coach=coach, user=user, request_type=cr.EXCEPTION_ADD, coach_note=data.reason,
            payload=data.model_dump(mode="json"),
        )
        return pending_response(request, "Your request was sent to an administrator for approval.")
    item, affected = await apply_exception_add(db, coach, data)
    await db.commit()
    await db.refresh(item)
    return {"id": str(item.id), "exception_date": item.exception_date, "exception_type": item.exception_type,
            "affected_bookings": affected, "warning": PRESERVED_WARNING if affected else None}


@router.delete("/instructors/{instructor_id}/availability/exceptions/{exception_id}", status_code=204, response_model=None)
async def delete_exception(instructor_id: UUID, exception_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> JSONResponse | None:
    coach = await _instructor(db, user, instructor_id)
    if user.role == UserRole.INSTRUCTOR:
        item = await db.scalar(select(AvailabilityException).where(AvailabilityException.id == exception_id, AvailabilityException.instructor_id == coach.id))
        if item is None:
            raise HTTPException(404, "Availability exception not found")
        request = await submit_change_request(
            db, coach=coach, user=user, request_type=cr.EXCEPTION_REMOVE, exception_id=item.id,
            payload={"exception_id": str(item.id), "before": _exception_json(item)},
        )
        return pending_response(request, "Your removal request was sent to an administrator for approval.")
    await apply_exception_remove(db, coach, exception_id)
    await db.commit()
    return None


@router.get("/instructors/{instructor_id}/available-slots")
async def available_slots(
    instructor_id: UUID,
    start_date: date,
    end_date: date,
    duration_minutes: int | None = Query(default=None, ge=15, le=180),
    exclude_appointment_id: UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    coach = await _instructor(db, user, instructor_id)
    if exclude_appointment_id is not None:
        excluded = await db.get(Appointment, exclude_appointment_id)
        if excluded is None or excluded.instructor_id != coach.id or excluded.status != "confirmed":
            raise HTTPException(404, "Appointment not found")
        if user.role == UserRole.INSTRUCTOR and excluded.instructor_id != coach.id:
            raise HTTPException(404, "Appointment not found")
    slots = await _slots(db, coach, start_date, end_date, duration_minutes, exclude_appointment_id)
    return {"timezone": coach.timezone, "slots": slots}


async def _appointment_out(db: AsyncSession, appointment: Appointment) -> dict:
    # List endpoints eager-load this relationship to avoid one database round-trip
    # per appointment. Single-item mutation paths keep the small lazy fallback.
    coach = appointment.__dict__.get("instructor") or await db.get(Instructor, appointment.instructor_id)
    student = appointment.student
    return {
        "id": str(appointment.id),
        "instructor_id": str(appointment.instructor_id),
        "student_id": str(appointment.student_id) if appointment.student_id else None,
        "starts_at": appointment.starts_at,
        "ends_at": appointment.ends_at,
        "status": appointment.status,
        "meeting_provider": "manual",
        "meeting_url": appointment.meeting_url,
        "cancellation_reason": appointment.cancellation_reason,
        "reschedule_reason": appointment.reschedule_reason,
        "instructor_timezone": coach.timezone if coach else "UTC",
        "student": {
            "id": str(student.id),
            "name": student.name,
            "parent_name": student.parent_name,
            "email": student.email,
            "phone": student.phone,
            "country_code": student.country_code,
            "timezone": student.timezone,
        } if student else None,
        "instructor_name": coach.display_name if coach else "Coach",
    }


async def _create_booking(data: BookingIn, idempotency_key: str, creator_id: UUID | None, db: AsyncSession) -> dict:
    owner_filter = Appointment.created_by == creator_id if creator_id is not None else Appointment.created_by.is_(None)
    existing = await db.scalar(select(Appointment).where(owner_filter, Appointment.idempotency_key == idempotency_key))
    if existing:
        with_student = await db.scalar(
            select(Appointment).options(selectinload(Appointment.student)).where(Appointment.id == existing.id)
        )
        return await _appointment_out(db, with_student or existing)
    coach = await db.scalar(
        select(Instructor)
        .join(User, User.id == Instructor.user_id)
        .where(
            Instructor.id == data.instructor_id,
            Instructor.is_available_for_booking.is_(True),
            User.is_active.is_(True),
        )
    )
    if coach is None:
        raise HTTPException(404, "Coach is not available for booking")
    if data.starts_at.tzinfo is None:
        raise HTTPException(422, "Appointment start must include a time zone")
    start = data.starts_at.astimezone(UTC)
    local_date = start.astimezone(ZoneInfo(coach.timezone)).date()
    if start not in await _slots(db, coach, local_date, local_date, data.duration_minutes):
        raise HTTPException(409, "This time is no longer available")
    try:
        ZoneInfo(data.student.timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(422, "Invalid student time zone") from exc
    student = Student(**{**data.student.model_dump(), "email": str(data.student.email).strip().lower()})
    db.add(student)
    await db.flush()
    ends = start + timedelta(minutes=data.duration_minutes)
    appointment = Appointment(instructor_id=coach.id, student_id=student.id, created_by=creator_id,
        starts_at=start, ends_at=ends, occupied_from=start, occupied_until=ends,
        status="confirmed", notes=data.notes,
        meeting_url=data.meeting_url if "meeting_url" in data.model_fields_set else coach.meeting_url,
        idempotency_key=idempotency_key)
    db.add(appointment)
    await db.flush()
    _queue_appointment_search_sync(db, appointment.id)
    db.add(OutboxEvent(event_type="booking.created", aggregate_id=appointment.id,
        payload={"appointment_id": str(appointment.id)}, processing_status="pending", attempt_count=0))
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        existing = await db.scalar(
            select(Appointment)
            .options(selectinload(Appointment.student))
            .where(owner_filter, Appointment.idempotency_key == idempotency_key)
        )
        if existing:
            return await _appointment_out(db, existing)
        raise HTTPException(409, "This coach's slot was just booked. Choose another time.") from exc
    return await _appointment_out(db, appointment)


@router.post("/appointments", status_code=201)
async def book_demo(data: BookingIn, idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=128),
                    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db_session)) -> dict:
    return await _create_booking(data, idempotency_key, admin.id, db)


@router.post("/public/appointments", status_code=201)
async def public_book_demo(
    data: PublicBookingIn,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=128),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    await _enforce_public_rate_limit(request, scope="create", limit=5, window_seconds=3600)
    if data.website.strip():
        raise HTTPException(400, "Unable to process this booking request")
    if data.meeting_url is not None:
        raise HTTPException(422, "Meeting links are managed by the academy")
    result = await _create_booking(data, idempotency_key, None, db)
    # The public client only needs a receipt. Do not echo student contact data or
    # internal appointment fields from this unauthenticated endpoint.
    return {
        "id": result["id"],
        "starts_at": result["starts_at"],
        "ends_at": result["ends_at"],
        "status": result["status"],
    }


@router.get("/appointments")
async def list_appointments(
    status: str | None = None,
    instructor_id: UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    if (start is None) != (end is None):
        raise HTTPException(422, "Provide both start and end timestamps")
    if start is not None and end is not None:
        if start.utcoffset() is None or end.utcoffset() is None:
            raise HTTPException(422, "Appointment range timestamps must include a time zone")
        if end <= start:
            raise HTTPException(422, "End must be after start")
        if end - start > timedelta(days=366):
            raise HTTPException(422, "Appointment range cannot exceed one year")

    query = select(Appointment).options(
        selectinload(Appointment.student),
        selectinload(Appointment.instructor),
    )
    if user.role == UserRole.INSTRUCTOR:
        profile = await db.scalar(select(Instructor).where(Instructor.user_id == user.id))
        if profile is None:
            return []
        query = query.where(Appointment.instructor_id == profile.id)
    elif instructor_id is not None:
        query = query.where(Appointment.instructor_id == instructor_id)
    if status:
        if status not in {"confirmed", "cancelled", "completed"}:
            raise HTTPException(422, "Invalid appointment status")
        query = query.where(Appointment.status == status)
    if start is not None and end is not None:
        query = query.where(Appointment.starts_at < end, Appointment.ends_at > start)
    rows = (await db.scalars(query.order_by(Appointment.starts_at).limit(500))).all()
    pending_by_appointment: dict[UUID, ChangeRequest] = {}
    if rows:
        pending_rows = (await db.scalars(select(ChangeRequest).where(
            ChangeRequest.status == cr.PENDING,
            ChangeRequest.appointment_id.in_([row.id for row in rows]),
        ))).all()
        pending_by_appointment = {item.appointment_id: item for item in pending_rows if item.appointment_id}
    output = []
    for row in rows:
        item = await _appointment_out(db, row)
        request = pending_by_appointment.get(row.id)
        item["pending_request"] = {"id": str(request.id), "request_type": request.request_type} if request else None
        output.append(item)
    return output


@router.post("/appointments/search")
async def search_appointments_route(
    data: AppointmentSearchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    query = data.query.strip()
    if data.status not in (None, "", "confirmed", "cancelled", "completed"):
        raise HTTPException(422, "Invalid appointment status")
    if len(query) < 2:
        return {"items": [], "estimated_total_hits": 0}

    instructor_id = None
    if user.role == UserRole.INSTRUCTOR:
        profile = await db.scalar(select(Instructor).where(Instructor.user_id == user.id))
        if profile is None:
            return {"items": [], "estimated_total_hits": 0}
        instructor_id = str(profile.id)
    try:
        result = await search_appointment_documents(
            query,
            limit=100,
            instructor_id=instructor_id,
            status=data.status or None,
        )
    except SearchUnavailable as exc:
        raise HTTPException(503, "Search is temporarily unavailable. Retry in a moment.") from exc

    hits = result.get("hits", [])
    try:
        ids = [UUID(hit["id"]) for hit in hits]
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(503, "Search returned an invalid result. Retry in a moment.") from exc
    if not ids:
        return {"items": [], "estimated_total_hits": result.get("estimatedTotalHits", 0)}

    query_rows = select(Appointment).options(
        selectinload(Appointment.student),
        selectinload(Appointment.instructor),
    ).where(Appointment.id.in_(ids))
    if instructor_id:
        query_rows = query_rows.where(Appointment.instructor_id == UUID(instructor_id))
    if data.status:
        query_rows = query_rows.where(Appointment.status == data.status)
    rows = (await db.scalars(query_rows)).all()
    appointment_by_id = {row.id: row for row in rows}
    return {
        "items": [await _appointment_out(db, appointment_by_id[id_]) for id_ in ids if id_ in appointment_by_id],
        "estimated_total_hits": result.get("estimatedTotalHits", len(appointment_by_id)),
    }


@router.get("/appointments/{appointment_id}")
async def get_appointment(
    appointment_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    appointment = await db.scalar(
        select(Appointment)
        .options(selectinload(Appointment.student), selectinload(Appointment.instructor))
        .where(Appointment.id == appointment_id)
    )
    if appointment is None:
        raise HTTPException(404, "Appointment not found")
    if user.role == UserRole.INSTRUCTOR:
        await _instructor(db, user, appointment.instructor_id)
    return await _appointment_out(db, appointment)


async def _appointment_for_change(db: AsyncSession, user: User, appointment_id: UUID) -> tuple[Appointment, Instructor | None]:
    """Load an appointment; for coaches also return their profile, hiding other coaches' bookings."""
    appointment = await db.scalar(
        select(Appointment).options(selectinload(Appointment.student)).where(Appointment.id == appointment_id)
    )
    if appointment is None:
        raise HTTPException(404, "Appointment not found")
    if user.role != UserRole.INSTRUCTOR:
        return appointment, None
    coach = await db.scalar(select(Instructor).where(Instructor.user_id == user.id))
    if coach is None or appointment.instructor_id != coach.id:
        raise HTTPException(404, "Appointment not found")
    return appointment, coach


@router.post("/appointments/{appointment_id}/cancel", response_model=None)
async def cancel_appointment(
    appointment_id: UUID,
    data: AppointmentCancelIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str] | JSONResponse:
    appointment, coach = await _appointment_for_change(db, user, appointment_id)
    if coach is not None:
        if appointment.status != "confirmed":
            raise HTTPException(409, "Only confirmed demos can be cancelled")
        request = await submit_change_request(
            db, coach=coach, user=user, request_type=cr.APPOINTMENT_CANCEL, appointment_id=appointment.id,
            coach_note=data.reason, payload={"reason": data.reason, "before": _appointment_snapshot(appointment)},
        )
        return pending_response(request, "Your cancellation request was sent to an administrator for approval.")
    await apply_cancel(db, appointment, data.reason)
    await db.commit()
    return {"status": "cancelled"}


@router.post("/appointments/{appointment_id}/complete")
async def complete_appointment(
    appointment_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    if user.role not in {UserRole.ADMIN, UserRole.INSTRUCTOR}:
        raise HTTPException(403, "Only administrators and assigned coaches can mark demos complete")
    appointment = await db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(404, "Appointment not found")
    if user.role == UserRole.INSTRUCTOR:
        await _instructor(db, user, appointment.instructor_id)
    if appointment.status == "completed":
        return {"status": "completed"}
    if appointment.status != "confirmed":
        raise HTTPException(409, "Only confirmed appointments can be marked completed")
    if appointment.ends_at > datetime.now(UTC):
        raise HTTPException(409, "A demo can be marked completed after its scheduled end time")

    appointment.status = "completed"
    _queue_appointment_search_sync(db, appointment.id)
    await db.commit()
    return {"status": "completed"}


@router.post("/appointments/{appointment_id}/reschedule", response_model=None)
async def reschedule_appointment(
    appointment_id: UUID,
    data: AppointmentRescheduleIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict | JSONResponse:
    appointment, coach = await _appointment_for_change(db, user, appointment_id)
    if coach is not None:
        # Checked now so coaches only propose open times; checked again when an admin approves.
        start, duration = await validated_reschedule_start(db, appointment, data.starts_at)
        request = await submit_change_request(
            db, coach=coach, user=user, request_type=cr.APPOINTMENT_RESCHEDULE, appointment_id=appointment.id,
            coach_note=data.reason,
            payload={"starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=duration)).isoformat(),
                     "reason": data.reason, "before": _appointment_snapshot(appointment)},
        )
        return pending_response(request, "Your reschedule request was sent to an administrator for approval.")
    await apply_reschedule(db, appointment, data.starts_at, data.reason)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "This coach's slot was just booked. Choose another time.") from exc
    return await _appointment_out(db, appointment)


@router.get("/appointments/{appointment_id}/notifications")
async def appointment_notifications(
    appointment_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    appointment = await db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(404, "Appointment not found")
    if user.role == UserRole.INSTRUCTOR:
        await _instructor(db, user, appointment.instructor_id)
    rows = (await db.scalars(
        select(NotificationEvent)
        .where(NotificationEvent.appointment_id == appointment_id)
        .order_by(NotificationEvent.created_at, NotificationEvent.recipient)
    )).all()
    return [
        {
            "event_type": row.event_type,
            "recipient": row.recipient,
            "delivery_status": row.delivery_status,
            "attempt_count": row.attempt_count,
            "last_error": row.last_error,
        }
        for row in rows
    ]


@router.get("/students")
async def list_students(
    user: User = Depends(require_admin), db: AsyncSession = Depends(get_db_session)
) -> list[dict]:
    students = (await db.scalars(
        select(Student).order_by(Student.name, Student.email).limit(500)
    )).all()
    return [
        {
            "id": str(student.id),
            "name": student.name,
            "parent_name": student.parent_name,
            "email": student.email,
            "phone": student.phone,
            "country_code": student.country_code,
            "timezone": student.timezone,
        }
        for student in students
    ]


@router.delete("/students/{student_id}")
async def delete_student_data(
    student_id: UUID,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    student = await db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
    now = datetime.now(UTC)
    upcoming = await db.scalar(
        select(func.count(Appointment.id)).where(
            Appointment.student_id == student.id,
            Appointment.status == "confirmed",
            Appointment.ends_at > now,
        )
    )
    if upcoming:
        raise HTTPException(409, "Cancel or reschedule active and future classes before deleting student data")
    appointment_ids = list(await db.scalars(select(Appointment.id).where(Appointment.student_id == student.id)))
    result = "deleted"
    if appointment_ids:
        await db.execute(delete(NotificationEvent).where(
            NotificationEvent.appointment_id.in_(appointment_ids),
            NotificationEvent.recipient == student.email,
        ))
        appointments = (await db.scalars(select(Appointment).where(Appointment.id.in_(appointment_ids)))).all()
        for appointment in appointments:
            appointment.student_id = None
            appointment.notes = None
            appointment.cancellation_reason = None
            appointment.reschedule_reason = None
        await db.flush()
        pending_events = (await db.scalars(select(OutboxEvent).where(
            OutboxEvent.aggregate_id.in_(appointment_ids),
            OutboxEvent.event_type.in_(["booking.cancelled", "booking.rescheduled"]),
            OutboxEvent.processing_status.in_(["pending", "processing"]),
        ))).all()
        for event in pending_events:
            event.payload = {key: value for key, value in event.payload.items() if key != "reason"}
        for appointment_id in appointment_ids:
            _queue_appointment_search_sync(db, appointment_id)
    await db.delete(student)
    await db.commit()
    return {"status": result}


def _interval_out(interval: Interval) -> dict[str, str]:
    return {"start": interval.start.isoformat(), "end": interval.end.isoformat()}


@router.get("/availability/overview")
async def availability_overview(
    day: date,
    timezone: str = Query(default="UTC", max_length=64, description="Show the day in this IANA time zone, e.g. the client's"),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Every bookable coach's free and booked time for one day, seen from one time zone.

    Admins use this to match a client's preferred time against the whole team at once.
    The data is fetched in a fixed number of queries regardless of how many coaches exist.
    """
    try:
        view_zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(422, "Use a valid IANA time zone") from exc
    view_start = datetime.combine(day, time.min, view_zone).astimezone(UTC)
    view_end = datetime.combine(day + timedelta(days=1), time.min, view_zone).astimezone(UTC)
    view = [Interval(view_start, view_end)]

    coaches = (await db.execute(
        select(Instructor)
        .join(User, User.id == Instructor.user_id)
        .where(User.is_active.is_(True), Instructor.is_available_for_booking.is_(True))
        .order_by(Instructor.display_name)
    )).scalars().all()
    coach_ids = [coach.id for coach in coaches]
    if not coach_ids:
        return {"day": day.isoformat(), "timezone": timezone, "start": view_start.isoformat(), "end": view_end.isoformat(), "coaches": []}

    rules_by_coach: dict[UUID, list[AvailabilityRule]] = {coach_id: [] for coach_id in coach_ids}
    for rule in (await db.scalars(select(AvailabilityRule).where(AvailabilityRule.instructor_id.in_(coach_ids)))).all():
        rules_by_coach[rule.instructor_id].append(rule)
    # Any coach's local date touching this view day is within one day either side.
    exceptions_by_coach: dict[UUID, list[AvailabilityException]] = {coach_id: [] for coach_id in coach_ids}
    for item in (await db.scalars(select(AvailabilityException).where(
        AvailabilityException.instructor_id.in_(coach_ids),
        AvailabilityException.exception_date.between(day - timedelta(days=1), day + timedelta(days=1)),
    ))).all():
        exceptions_by_coach[item.instructor_id].append(item)
    booked_by_coach: dict[UUID, list[Appointment]] = {coach_id: [] for coach_id in coach_ids}
    for appointment in (await db.scalars(
        select(Appointment).options(selectinload(Appointment.student)).where(
            Appointment.instructor_id.in_(coach_ids),
            Appointment.status == "confirmed",
            Appointment.occupied_from < view_end,
            Appointment.occupied_until > view_start,
        ).order_by(Appointment.starts_at)
    )).all():
        booked_by_coach[appointment.instructor_id].append(appointment)
    pending_by_coach = dict((await db.execute(
        select(ChangeRequest.instructor_id, func.count(ChangeRequest.id))
        .where(ChangeRequest.instructor_id.in_(coach_ids), ChangeRequest.status == cr.PENDING)
        .group_by(ChangeRequest.instructor_id)
    )).all())

    output = []
    for coach in coaches:
        coach_zone = ZoneInfo(coach.timezone)
        local_days = {view_start.astimezone(coach_zone).date(), (view_end - timedelta(microseconds=1)).astimezone(coach_zone).date()}
        windows: list[Interval] = []
        for local_day in sorted(local_days):
            windows.extend(actual_windows(local_day, coach.timezone, rules_by_coach[coach.id], exceptions_by_coach[coach.id]))
        # Clip working hours to the viewed day, then remove booked time.
        working = subtract(view, subtract(view, merge(windows)))
        booked = booked_by_coach[coach.id]
        free = subtract(working, [Interval(item.occupied_from, item.occupied_until) for item in booked])
        output.append({
            "id": str(coach.id),
            "display_name": coach.display_name,
            "timezone": coach.timezone,
            "free": [_interval_out(interval) for interval in free],
            "booked": [
                {
                    "id": str(item.id),
                    "start": item.starts_at.isoformat(),
                    "end": item.ends_at.isoformat(),
                    "student_name": item.student.name if item.student else "Deleted student",
                }
                for item in booked
            ],
            "pending_requests": int(pending_by_coach.get(coach.id, 0)),
        })
    return {"day": day.isoformat(), "timezone": timezone, "start": view_start.isoformat(), "end": view_end.isoformat(), "coaches": output}


@router.get("/dashboard/summary")
async def dashboard_summary(
    timezone: str | None = Query(default=None, max_length=64, description="Viewer's IANA time zone for 'today'"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, int]:
    coach_ids: list[UUID] | None = None
    zone_name = "UTC"
    if timezone:
        try:
            ZoneInfo(timezone)
            zone_name = timezone
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise HTTPException(422, "Use a valid IANA time zone") from exc
    if user.role == UserRole.INSTRUCTOR:
        profile = await db.scalar(select(Instructor).where(Instructor.user_id == user.id))
        if profile is None:
            return {
                "total_instructors": 0,
                "upcoming_appointments": 0,
                "today_appointments": 0,
                "cancelled_appointments": 0,
            }
        coach_ids = [profile.id]
        zone_name = profile.timezone  # a coach's "today" is their own working day

    now = datetime.now(UTC)
    zone = ZoneInfo(zone_name)
    local_today = now.astimezone(zone).date()
    today_start = datetime.combine(local_today, time.min, zone).astimezone(UTC)
    tomorrow = datetime.combine(local_today + timedelta(days=1), time.min, zone).astimezone(UTC)
    scope = [Appointment.instructor_id.in_(coach_ids)] if coach_ids else []
    total_instructors = 0 if coach_ids else int(
        await db.scalar(select(func.count(Instructor.id)).join(User, User.id == Instructor.user_id).where(User.is_active.is_(True))) or 0
    )
    upcoming = int(await db.scalar(select(func.count(Appointment.id)).where(
        *scope, Appointment.status == "confirmed", Appointment.starts_at >= now,
    )) or 0)
    today = int(await db.scalar(select(func.count(Appointment.id)).where(
        *scope, Appointment.status == "confirmed", Appointment.starts_at >= today_start,
        Appointment.starts_at < tomorrow,
    )) or 0)
    cancelled = int(await db.scalar(select(func.count(Appointment.id)).where(
        *scope, Appointment.status == "cancelled",
    )) or 0)
    return {
        "total_instructors": total_instructors,
        "upcoming_appointments": upcoming,
        "today_appointments": today,
        "cancelled_appointments": cancelled,
    }
