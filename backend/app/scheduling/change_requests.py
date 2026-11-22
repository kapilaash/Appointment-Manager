"""Shared vocabulary for coach change requests, used by the API and the notification worker."""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

CHANGE_REQUEST_EVENT_PREFIX = "change_request."
SUBMITTED_EVENT = "change_request.submitted"
REVIEWED_EVENT = "change_request.reviewed"

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"
WITHDRAWN = "withdrawn"
SUPERSEDED = "superseded"
STATUSES = (PENDING, APPROVED, REJECTED, WITHDRAWN, SUPERSEDED)

WEEKLY_AVAILABILITY = "weekly_availability"
EXCEPTION_ADD = "exception_add"
EXCEPTION_REMOVE = "exception_remove"
TIMEZONE_CHANGE = "timezone_change"
APPOINTMENT_CANCEL = "appointment_cancel"
APPOINTMENT_RESCHEDULE = "appointment_reschedule"

REQUEST_LABELS = {
    WEEKLY_AVAILABILITY: "Weekly availability change",
    EXCEPTION_ADD: "Time off or extra hours",
    EXCEPTION_REMOVE: "Remove time off or extra hours",
    TIMEZONE_CHANGE: "Time zone change",
    APPOINTMENT_CANCEL: "Demo cancellation",
    APPOINTMENT_RESCHEDULE: "Demo reschedule",
}

_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _hhmm(value: str | None) -> str:
    return value[:5] if value else ""


def _exception_phrase(item: dict[str, Any]) -> str:
    kind = "Extra hours" if item.get("exception_type") == "additional_available" else "Time off"
    start, end = _hhmm(item.get("start_local_time")), _hhmm(item.get("end_local_time"))
    span = f"{start}–{end}" if start and end else "all day"
    return f"{kind} on {item.get('exception_date')} ({span})"


def _moment(value: str | None, zone_name: str) -> str:
    if not value:
        return "unknown time"
    moment = datetime.fromisoformat(value).astimezone(ZoneInfo(zone_name))
    return f"{moment:%a %d %b %Y, %I:%M %p} {zone_name}"


def describe_request(request_type: str, payload: dict[str, Any], coach_timezone: str) -> str:
    """Return a one-paragraph, plain-language summary of what the coach asked for."""
    if request_type == WEEKLY_AVAILABILITY:
        rules = payload.get("rules", [])
        if not rules:
            return "Remove all weekly working hours."
        by_day: dict[int, list[str]] = {}
        for rule in rules:
            by_day.setdefault(int(rule["day_of_week"]), []).append(
                f"{_hhmm(rule['start_local_time'])}–{_hhmm(rule['end_local_time'])}"
            )
        days = "; ".join(f"{_WEEKDAYS[day]} {', '.join(spans)}" for day, spans in sorted(by_day.items()))
        return f"New weekly hours ({coach_timezone}): {days}."
    if request_type == EXCEPTION_ADD:
        return f"Add {_exception_phrase(payload)}."
    if request_type == EXCEPTION_REMOVE:
        before = payload.get("before") or {}
        return f"Remove {_exception_phrase(before)}." if before else "Remove a time-off or extra-hours entry."
    if request_type == TIMEZONE_CHANGE:
        before = payload.get("before") or {}
        return (
            f"Change time zone from {before.get('timezone', 'unknown')} to {payload.get('timezone')}"
            f" (country {payload.get('country_code') or 'not set'})."
        )
    if request_type == APPOINTMENT_CANCEL:
        before = payload.get("before") or {}
        return f"Cancel the demo on {_moment(before.get('starts_at'), coach_timezone)}."
    if request_type == APPOINTMENT_RESCHEDULE:
        before = payload.get("before") or {}
        return (
            f"Move the demo from {_moment(before.get('starts_at'), coach_timezone)}"
            f" to {_moment(payload.get('starts_at'), coach_timezone)}."
        )
    return REQUEST_LABELS.get(request_type, request_type)
