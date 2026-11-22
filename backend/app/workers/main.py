import asyncio
import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any, ClassVar
from zoneinfo import ZoneInfo

import httpx
import structlog
from arq.connections import RedisSettings
from arq.cron import cron
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.mailer import build_message, send_message
from app.db.session import AsyncSessionLocal
from app.observability.error_tracking import (
    capture_exception,
    configure_error_tracking,
    worker_span,
)
from app.scheduling import change_requests as cr
from app.scheduling.models import Appointment, ChangeRequest, NotificationEvent, OutboxEvent
from app.search.indexing import rebuild_appointment_index, sync_appointment
from app.search.meili import SEARCH_EVENT_TYPE, ensure_appointment_index
from app.users.models import Instructor, User, UserRole
from app.workers.maintenance import run_purge
from app.workers.metrics import (
    record_worker_failure,
    record_worker_success,
    set_oldest_unprocessed,
    set_outbox_count,
    set_worker_search_available,
    set_worker_uptime_heartbeat_enabled,
    set_worker_uptime_heartbeat_success,
    start_worker_metrics,
    stop_worker_metrics,
)

configure_error_tracking()

logger = structlog.get_logger(__name__)


def _booking_notification_body(
    *,
    event_label: str,
    student_name: str,
    parent_name: str,
    contact_email: str,
    coach_name: str,
    student_local_time: str,
    coach_local_time: str,
    meeting_url: str,
    reason: str | None,
    booking_reference: str,
) -> str:
    reason_line = f"Reason: {reason}\n" if reason else ""
    return (
        f"A chess demo class has been {event_label}.\n\n"
        f"Student: {student_name}\n"
        f"Parent/guardian: {parent_name}\n"
        f"Contact: {contact_email}\n"
        f"Coach: {coach_name}\n"
        f"When: {student_local_time}\n"
        f"Coach local time: {coach_local_time}\n"
        f"Meeting link: {meeting_url}\n"
        f"{reason_line}"
        f"Booking reference: {booking_reference}\n"
    )


def change_request_email(
    *,
    event_type: str,
    request: ChangeRequest,
    coach_name: str,
    coach_timezone: str,
    reviewer_email: str | None,
) -> tuple[str, str]:
    """Return (subject, body) for a change-request email."""
    label = cr.REQUEST_LABELS.get(request.request_type, "Change request")
    summary = cr.describe_request(request.request_type, request.payload, coach_timezone)
    if event_type == cr.SUBMITTED_EVENT:
        note = f"Coach note: {request.coach_note}\n" if request.coach_note else ""
        return (
            f"Approval needed: {label} from {coach_name}",
            (f"{coach_name} has asked for a change that needs your approval.\n\n"
            f"Request: {label}\n"
            f"Details: {summary}\n"
            f"{note}\n"
            f"Review it here: {settings.FRONTEND_URL.rstrip('/')}/requests\n"
            f"Request reference: {request.id}\n"),
        )
    outcome = "approved" if request.status == cr.APPROVED else "not approved"
    note = f"Admin note: {request.review_note}\n" if request.review_note else ""
    reviewer = f"Reviewed by: {reviewer_email}\n" if reviewer_email else ""
    return (
        f"Your request was {outcome}: {label}",
        (f"Hello {coach_name},\n\n"
        f"Your request has been {outcome}.\n\n"
        f"Request: {label}\n"
        f"Details: {summary}\n"
        f"{note}{reviewer}\n"
        f"See your requests: {settings.FRONTEND_URL.rstrip('/')}/my-requests\n"
        f"Request reference: {request.id}\n"),
    )


async def _send_once(
    db: Any,
    *,
    address: str,
    subject: str,
    body: str,
    event_key: str,
    event_type: str,
    change_request_id: Any,
) -> None:
    """Send one message per (outbox event, recipient), surviving worker retries."""
    record_query = select(NotificationEvent).where(
        NotificationEvent.event_key == event_key,
        NotificationEvent.recipient == address,
    )
    record = await db.scalar(record_query)
    if record and record.delivery_status == "provider_accepted":
        return
    if record is None:
        record = NotificationEvent(
            change_request_id=change_request_id,
            event_type=event_type,
            event_key=event_key,
            recipient=address,
            delivery_status="queued",
            attempt_count=0,
        )
        db.add(record)
        await db.flush()
    record.delivery_status = "attempting"
    record.attempt_count += 1
    record.last_error = None
    await db.commit()

    message = build_message(address, subject, body)
    address_digest = hashlib.sha256(address.strip().lower().encode()).hexdigest()[:16]
    sender_domain = settings.MAIL_FROM.rpartition("@")[2] or "localhost"
    message["Message-ID"] = f"<{event_key}.{address_digest}@{sender_domain}>"
    try:
        await send_message(message)
    except Exception as exc:
        await db.rollback()
        record = await db.scalar(record_query)
        if record:
            record.delivery_status = "queued"
            record.last_error = type(exc).__name__
            await db.commit()
        raise
    record = await db.scalar(record_query)
    if record:
        record.delivery_status = "provider_accepted"
        record.provider_reference = message["Message-ID"]
        record.last_error = None
        await db.commit()


async def _deliver_change_request_event(db: Any, *, event_key: str, event_type: str, request_id: Any) -> None:
    request = await db.get(ChangeRequest, request_id)
    if request is None:
        return  # The coach (and their requests) were deleted; nothing left to tell anyone.
    coach = await db.get(Instructor, request.instructor_id)
    coach_user = await db.get(User, coach.user_id) if coach else None
    reviewer = await db.get(User, request.reviewed_by) if request.reviewed_by else None
    if event_type == cr.SUBMITTED_EVENT:
        recipients = list((await db.scalars(select(User.email).where(
            User.role == UserRole.ADMIN, User.is_active.is_(True),
        ))).all())
    elif event_type == cr.REVIEWED_EVENT:
        recipients = [coach_user.email] if coach_user and coach_user.is_active else []
    else:
        raise ValueError(f"Unsupported change request event: {event_type}")
    subject, body = change_request_email(
        event_type=event_type,
        request=request,
        coach_name=coach.display_name if coach else "A coach",
        coach_timezone=coach.timezone if coach else "UTC",
        reviewer_email=reviewer.email if reviewer else None,
    )
    for address in dict.fromkeys(recipients):
        await _send_once(
            db, address=address, subject=subject, body=body, event_key=event_key,
            event_type=event_type, change_request_id=request.id,
        )


async def _process_outbox(ctx: dict[str, Any]) -> int:
    processed = 0
    for _ in range(25):
        async with AsyncSessionLocal() as db:
            async with db.begin():
                event = await db.scalar(
                    select(OutboxEvent)
                    .where(or_(
                        OutboxEvent.processing_status == "pending",
                        and_(OutboxEvent.processing_status == "processing",
                             OutboxEvent.processing_started_at < datetime.now(UTC) - timedelta(minutes=10)),
                    ), OutboxEvent.event_type != SEARCH_EVENT_TYPE)
                    .order_by(OutboxEvent.created_at)
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
                if event is None:
                    return processed
                event.processing_status = "processing"
                event.attempt_count += 1
                event.processing_started_at = datetime.now(UTC)
                event_id = event.id
                event_key = str(event.id)
                event_type = event.event_type
                appointment_id = event.aggregate_id
                event_payload = dict(event.payload)
            try:
                if event_type.startswith(cr.CHANGE_REQUEST_EVENT_PREFIX):
                    await _deliver_change_request_event(
                        db, event_key=event_key, event_type=event_type, request_id=appointment_id,
                    )
                else:
                    appointment = await db.scalar(
                        select(Appointment)
                        .options(selectinload(Appointment.student))
                        .where(Appointment.id == appointment_id)
                    )
                    if appointment is None:
                        raise ValueError("Booking no longer exists")
                    instructor = await db.get(Instructor, appointment.instructor_id)
                    coach_user = await db.get(User, instructor.user_id) if instructor else None
                    admin_user = await db.get(User, appointment.created_by)
                    recipients = list(dict.fromkeys(
                        address for address in (
                            coach_user.email if coach_user else None,
                            admin_user.email if admin_user else None,
                            appointment.student.email if appointment.student else None,
                        ) if address
                    ))
                    zone_name = appointment.student.timezone if appointment.student else (instructor.timezone if instructor else "UTC")
                    event_start = datetime.fromisoformat(event_payload["starts_at"]) if event_payload.get("starts_at") else appointment.starts_at
                    event_end = datetime.fromisoformat(event_payload["ends_at"]) if event_payload.get("ends_at") else appointment.ends_at
                    start = event_start.astimezone(ZoneInfo(zone_name))
                    end = event_end.astimezone(ZoneInfo(zone_name))
                    coach_start = event_start.astimezone(ZoneInfo(instructor.timezone)) if instructor else event_start
                    coach_end = event_end.astimezone(ZoneInfo(instructor.timezone)) if instructor else event_end
                    event_label = {
                        "booking.created": "booked",
                        "booking.rescheduled": "rescheduled",
                        "booking.cancelled": "cancelled",
                    }.get(event_type)
                    if event_label is None:
                        raise ValueError(f"Unsupported notification event: {event_type}")
                    subject = f"Chess demo class {event_label}"
                    for address in recipients:
                        record_query = select(NotificationEvent).where(
                            NotificationEvent.appointment_id == appointment.id,
                            NotificationEvent.event_key == event_key,
                            NotificationEvent.recipient == address,
                        )
                        record = await db.scalar(record_query)
                        if record and record.delivery_status == "provider_accepted":
                            continue
                        if record is None:
                            record = NotificationEvent(
                                appointment_id=appointment.id,
                                event_type=event_type,
                                event_key=event_key,
                                recipient=address,
                                delivery_status="queued",
                                attempt_count=0,
                            )
                            db.add(record)
                            await db.flush()
                        record.delivery_status = "attempting"
                        record.attempt_count += 1
                        record.last_error = None
                        await db.commit()

                        message = build_message(
                            address,
                            subject,
                            _booking_notification_body(
                                event_label=event_label,
                                student_name=appointment.student.name if appointment.student else "Deleted student",
                                parent_name=(appointment.student.parent_name or "Not provided") if appointment.student else "Not provided",
                                contact_email=appointment.student.email if appointment.student else "Removed",
                                coach_name=instructor.display_name if instructor else "Coach",
                                student_local_time=f"{start:%A, %B %d, %Y at %I:%M %p %Z} – {end:%I:%M %p %Z}",
                                coach_local_time=f"{coach_start:%A, %B %d, %Y at %I:%M %p %Z} – {coach_end:%I:%M %p %Z}",
                                meeting_url=appointment.meeting_url or "Not set",
                                reason=event_payload.get("reason"),
                                booking_reference=str(appointment.id),
                            ),
                        )
                        address_digest = hashlib.sha256(address.strip().lower().encode()).hexdigest()[:16]
                        sender_domain = settings.MAIL_FROM.rpartition("@")[2] or "localhost"
                        message["Message-ID"] = f"<{event_key}.{address_digest}@{sender_domain}>"
                        try:
                            await send_message(message)
                        except Exception as exc:
                            await db.rollback()
                            record = await db.scalar(record_query)
                            if record:
                                record.delivery_status = "queued"
                                record.last_error = type(exc).__name__
                                await db.commit()
                            raise

                        record = await db.scalar(record_query)
                        if record:
                            record.delivery_status = "provider_accepted"
                            record.provider_reference = message["Message-ID"]
                            record.last_error = None
                            await db.commit()

                event = await db.get(OutboxEvent, event_id)
                if event:
                    event.processing_status = "processed"
                    event.processed_at = datetime.now(UTC)
                    event.processing_started_at = None
                await db.commit()
                processed += 1
            except Exception as exc:
                record_worker_failure("notification_delivery")
                capture_exception(exc)
                logger.exception("booking_notification_failed", outbox_event_id=str(event_id))
                await db.rollback()
                event = await db.get(OutboxEvent, event_id)
                if event:
                    event.processing_status = "failed" if event.attempt_count >= 6 else "pending"
                    event.processing_started_at = None
                pending_records = (await db.scalars(select(NotificationEvent).where(
                    NotificationEvent.event_key == str(event_id),
                    NotificationEvent.delivery_status.in_(["queued", "attempting"]),
                ))).all()
                for record in pending_records:
                    record.delivery_status = "failed" if event and event.attempt_count >= 6 else "queued"
                    record.last_error = type(exc).__name__
                await db.commit()
                break
    return processed


async def process_outbox(ctx: dict[str, Any]) -> int:
    try:
        with worker_span("notifications.process") as span:
            processed = await _process_outbox(ctx)
            if span is not None:
                span.set_data("events_processed", processed)
            record_worker_success("notifications")
            await refresh_outbox_metrics()
            await maybe_send_worker_heartbeat(ctx)
            return processed
    except Exception as exc:
        record_worker_failure("notification_worker")
        capture_exception(exc)
        raise


async def initialize_search(ctx: dict[str, Any]) -> None:
    try:
        await ensure_appointment_index()
        async with AsyncSessionLocal() as db:
            count = await rebuild_appointment_index(db)
        ctx["search_index_ready"] = True
        set_worker_search_available(True)
        logger.info("appointment_search_index_ready", indexed_appointments=count)
    except Exception as exc:  # noqa: BLE001 - search startup must not stop notification delivery.
        ctx["search_index_ready"] = False
        set_worker_search_available(False)
        record_worker_failure("search_index_startup")
        capture_exception(exc)
        logger.warning("appointment_search_startup_sync_failed", error_type=type(exc).__name__)


async def _process_search_outbox(ctx: dict[str, Any]) -> int:
    if not ctx.get("search_index_ready", False):
        try:
            await ensure_appointment_index()
            async with AsyncSessionLocal() as db:
                count = await rebuild_appointment_index(db)
            ctx["search_index_ready"] = True
            set_worker_search_available(True)
            logger.info("appointment_search_index_recovered", indexed_appointments=count)
        except Exception as exc:  # noqa: BLE001 - search startup must not stop notification delivery.
            set_worker_search_available(False)
            record_worker_failure("search_index_recovery")
            capture_exception(exc)
            logger.warning("appointment_search_index_unavailable", error_type=type(exc).__name__)
            return 0

    processed = 0
    for _ in range(50):
        async with AsyncSessionLocal() as db, db.begin():
            event = await db.scalar(
                select(OutboxEvent)
                .where(
                    OutboxEvent.event_type == SEARCH_EVENT_TYPE,
                    or_(
                        OutboxEvent.processing_status == "pending",
                        and_(
                            OutboxEvent.processing_status == "processing",
                            OutboxEvent.processing_started_at < datetime.now(UTC) - timedelta(minutes=10),
                        ),
                    ),
                )
                .order_by(OutboxEvent.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if event is None:
                return processed
            event.processing_status = "processing"
            event.attempt_count += 1
            event.processing_started_at = datetime.now(UTC)
            event_id = event.id
            appointment_id = event.aggregate_id

        try:
            async with AsyncSessionLocal() as db:
                await sync_appointment(db, appointment_id)
            async with AsyncSessionLocal() as db, db.begin():
                event = await db.get(OutboxEvent, event_id)
                if event:
                    event.processing_status = "processed"
                    event.processed_at = datetime.now(UTC)
                    event.processing_started_at = None
            processed += 1
        except Exception as exc:  # noqa: BLE001 - isolated search events must not stop the worker.
            ctx["search_index_ready"] = False
            set_worker_search_available(False)
            record_worker_failure("search_index_sync")
            capture_exception(exc)
            logger.warning(
                "appointment_search_sync_failed",
                outbox_event_id=str(event_id),
                error_type=type(exc).__name__,
            )
            async with AsyncSessionLocal() as db, db.begin():
                event = await db.get(OutboxEvent, event_id)
                if event:
                    event.processing_status = "failed" if event.attempt_count >= 10 else "pending"
                    event.processing_started_at = None
    return processed


async def process_search_outbox(ctx: dict[str, Any]) -> int:
    try:
        with worker_span("search.process") as span:
            processed = await _process_search_outbox(ctx)
            if span is not None:
                span.set_data("events_processed", processed)
            if ctx.get("search_index_ready", False):
                record_worker_success("search")
            await refresh_outbox_metrics()
            await maybe_send_worker_heartbeat(ctx)
            return processed
    except Exception as exc:
        record_worker_failure("search_worker")
        capture_exception(exc)
        raise


async def refresh_outbox_metrics() -> None:
    queues = ("notifications", "search")
    statuses = ("pending", "processing", "failed")
    counts = {(queue, status): 0 for queue in queues for status in statuses}
    oldest = {queue: 0.0 for queue in queues}
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(
                    OutboxEvent.event_type,
                    OutboxEvent.processing_status,
                    func.count(),
                    func.min(OutboxEvent.created_at),
                )
                .where(OutboxEvent.processing_status.in_(statuses))
                .group_by(OutboxEvent.event_type, OutboxEvent.processing_status)
            )
        ).all()
    for event_type, status, count, oldest_created_at in rows:
        queue = "search" if event_type == SEARCH_EVENT_TYPE else "notifications"
        counts[(queue, status)] += count
        if status in {"pending", "processing"} and oldest_created_at is not None:
            timestamp = oldest_created_at.timestamp()
            oldest[queue] = timestamp if not oldest[queue] else min(oldest[queue], timestamp)
    for (queue, status), count in counts.items():
        set_outbox_count(queue, status, count)
    for queue, timestamp in oldest.items():
        set_oldest_unprocessed(queue, timestamp)


async def maybe_send_worker_heartbeat(ctx: dict[str, Any]) -> None:
    heartbeat_url = settings.UPTIME_WORKER_HEARTBEAT_URL
    if not heartbeat_url:
        return
    if not ctx.get("search_index_ready", False):
        set_worker_uptime_heartbeat_success(False)
        return
    loop = asyncio.get_running_loop()
    now = loop.time()
    last_sent = ctx.get("uptime_heartbeat_last_sent", 0.0)
    if now - last_sent < settings.UPTIME_HEARTBEAT_INTERVAL_SECONDS:
        return
    ctx["uptime_heartbeat_last_sent"] = now
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(heartbeat_url)
            response.raise_for_status()
        set_worker_uptime_heartbeat_success(True)
    except Exception as exc:  # noqa: BLE001 - provider delivery status is also exposed as a metric.
        set_worker_uptime_heartbeat_success(False)
        logger.warning("worker_external_uptime_heartbeat_failed", error_type=type(exc).__name__)


async def worker_startup(ctx: dict[str, Any]) -> None:
    await start_worker_metrics(ctx)
    set_worker_uptime_heartbeat_enabled(bool(settings.UPTIME_WORKER_HEARTBEAT_URL))
    if settings.UPTIME_WORKER_HEARTBEAT_URL:
        set_worker_uptime_heartbeat_success(False)
    await initialize_search(ctx)
    try:
        await refresh_outbox_metrics()
    except Exception as exc:  # noqa: BLE001 - worker can recover while metrics report its dependency state.
        record_worker_failure("outbox_metrics_refresh")
        logger.warning("worker_outbox_metrics_initial_refresh_failed", error_type=type(exc).__name__)


async def worker_shutdown(ctx: dict[str, Any]) -> None:
    await stop_worker_metrics(ctx)


async def purge_expired_records(ctx: dict[str, Any]) -> dict[str, int]:
    """Daily housekeeping; failures surface through the existing worker failure alerts."""
    try:
        removed = await run_purge(ctx)
    except Exception as exc:
        record_worker_failure("maintenance_purge")
        capture_exception(exc)
        raise
    record_worker_success("maintenance_purge")
    return removed


class WorkerSettings:
    functions: ClassVar[list] = [process_outbox, process_search_outbox, purge_expired_records]
    on_startup = worker_startup
    on_shutdown = worker_shutdown
    cron_jobs: ClassVar[list] = [
        cron(process_outbox, second={0, 15, 30, 45}, run_at_startup=True),
        cron(process_search_outbox, second=set(range(0, 60, 3)), run_at_startup=True),
        # Quiet hour for most users; a missed run simply catches up the next day.
        cron(purge_expired_records, hour={3}, minute={17}, second={0}),
    ]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 2
