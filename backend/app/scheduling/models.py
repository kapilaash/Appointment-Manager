from datetime import date, datetime, time
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import conv

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.users.models import Instructor


class AvailabilityRule(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "availability_rules"
    instructor_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("instructors.id", ondelete="CASCADE"), index=True
    )
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)
    start_local_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_local_time: Mapped[time] = mapped_column(Time, nullable=False)
    effective_from: Mapped[date | None] = mapped_column(Date)
    effective_until: Mapped[date | None] = mapped_column(Date)
    __table_args__ = (
        CheckConstraint("day_of_week between 0 and 6", name=conv("ck_availability_weekday")),
        CheckConstraint("start_local_time < end_local_time", name=conv("ck_availability_interval")),
    )


class AvailabilityException(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "availability_exceptions"
    instructor_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("instructors.id", ondelete="CASCADE"), index=True
    )
    exception_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_local_time: Mapped[time | None] = mapped_column(Time)
    end_local_time: Mapped[time | None] = mapped_column(Time)
    exception_type: Mapped[str] = mapped_column(String(30), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(240))
    __table_args__ = (
        CheckConstraint(
            "exception_type in ('unavailable', 'additional_available')",
            name=conv("ck_availability_exception_type"),
        ),
        CheckConstraint(
            "(start_local_time is null) = (end_local_time is null)",
            name=conv("ck_availability_exception_bounds"),
        ),
        CheckConstraint(
            "start_local_time is null or start_local_time < end_local_time",
            name=conv("ck_availability_exception_order"),
        ),
    )


class Student(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "students"
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    parent_name: Mapped[str | None] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    timezone: Mapped[str] = mapped_column(String(80), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2))


class Appointment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "appointments"
    instructor_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("instructors.id"), nullable=False)
    student_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("students.id", ondelete="SET NULL"), nullable=True
    )
    # Public client bookings do not have an authenticated workspace user.
    created_by: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("users.id"), nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    occupied_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    occupied_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="confirmed")
    meeting_url: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    cancellation_reason: Mapped[str | None] = mapped_column(String(1000))
    reschedule_reason: Mapped[str | None] = mapped_column(String(1000))
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    student: Mapped[Student | None] = relationship()
    instructor: Mapped["Instructor"] = relationship()
    __table_args__ = (
        CheckConstraint("starts_at < ends_at", name=conv("ck_appointment_order")),
        CheckConstraint(
            "occupied_from <= starts_at and ends_at <= occupied_until",
            name=conv("ck_appointment_occupied_bounds"),
        ),
        CheckConstraint(
            "status in ('confirmed', 'cancelled', 'completed')",
            name=conv("ck_appointment_status"),
        ),
        UniqueConstraint("created_by", "idempotency_key", name="uq_appointments_idempotency_key"),
        Index(
            "uq_appointments_public_idempotency_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("created_by IS NULL"),
        ),
        Index("ix_appointments_instructor_starts", "instructor_id", "starts_at"),
    )


class OutboxEvent(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "outbox_events"
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    aggregate_id: Mapped[UUID] = mapped_column(Uuid, nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    processing_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending", index=True
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class ChangeRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A coach-submitted change that only takes effect after an administrator approves it."""

    __tablename__ = "change_requests"
    instructor_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("instructors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    requested_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    request_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # The proposed change plus a "before" snapshot taken when the request was submitted.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    appointment_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("appointments.id", ondelete="SET NULL")
    )
    exception_id: Mapped[UUID | None] = mapped_column(Uuid)
    coach_note: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    reviewed_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(String(1000))
    __table_args__ = (
        CheckConstraint(
            "request_type in ('weekly_availability', 'exception_add', 'exception_remove', "
            "'timezone_change', 'appointment_cancel', 'appointment_reschedule')",
            name=conv("ck_change_requests_type"),
        ),
        CheckConstraint(
            "status in ('pending', 'approved', 'rejected', 'withdrawn', 'superseded')",
            name=conv("ck_change_requests_status"),
        ),
        Index("ix_change_requests_status_created", "status", "created_at"),
        Index(
            "uq_change_requests_pending_weekly",
            "instructor_id",
            unique=True,
            postgresql_where=text("status = 'pending' AND request_type = 'weekly_availability'"),
        ),
        Index(
            "uq_change_requests_pending_timezone",
            "instructor_id",
            unique=True,
            postgresql_where=text("status = 'pending' AND request_type = 'timezone_change'"),
        ),
        Index(
            "uq_change_requests_pending_appointment",
            "appointment_id",
            unique=True,
            postgresql_where=text("status = 'pending' AND appointment_id IS NOT NULL"),
        ),
        Index(
            "uq_change_requests_pending_exception_remove",
            "exception_id",
            unique=True,
            postgresql_where=text("status = 'pending' AND request_type = 'exception_remove'"),
        ),
    )


class NotificationEvent(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "notification_events"
    # Exactly one of appointment_id / change_request_id identifies what the message is about.
    appointment_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("appointments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    change_request_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("change_requests.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Account security notices (password changed, two-step sign-in on/off) concern a user, not a booking.
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    event_key: Mapped[str] = mapped_column(String(36), nullable=False)
    recipient: Mapped[str] = mapped_column(String(320), nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(30), nullable=False, default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(500))
    provider_reference: Mapped[str | None] = mapped_column(String(240))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=text("now()"),
    )
    __table_args__ = (
        Index("uq_notification_event_recipient", "event_key", "recipient", unique=True),
        CheckConstraint(
            "num_nonnulls(appointment_id, change_request_id, user_id) = 1",
            name=conv("ck_notification_events_subject"),
        ),
    )


class AcademySetting(Base):
    __tablename__ = "academy_settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
