from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

if TYPE_CHECKING:
    from app.scheduling.models import AvailabilityException, AvailabilityRule


@dataclass(frozen=True, order=True)
class Interval:
    start: datetime
    end: datetime


def _local_to_utc(day: date, local_time: time, zone: ZoneInfo) -> datetime | None:
    naive = datetime.combine(day, local_time)
    candidate = naive.replace(tzinfo=zone, fold=0)
    # A round trip identifies nonexistent wall-clock times during a spring DST jump.
    if candidate.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != naive:
        return None
    return candidate.astimezone(UTC)


def merge(intervals: list[Interval]) -> list[Interval]:
    if not intervals:
        return []
    ordered = sorted(intervals)
    result = [ordered[0]]
    for current in ordered[1:]:
        last = result[-1]
        if current.start <= last.end:
            result[-1] = Interval(last.start, max(last.end, current.end))
        else:
            result.append(current)
    return result


def subtract(available: list[Interval], busy: list[Interval]) -> list[Interval]:
    output: list[Interval] = []
    windows = merge(available)
    blocks = merge(busy)
    block_index = 0
    for window in windows:
        cursor = window.start
        while block_index < len(blocks) and blocks[block_index].end <= cursor:
            block_index += 1
        index = block_index
        while index < len(blocks):
            block = blocks[index]
            if block.start >= window.end:
                break
            if block.start > cursor:
                output.append(Interval(cursor, min(block.start, window.end)))
            cursor = max(cursor, block.end)
            if cursor >= window.end:
                break
            index += 1
        if cursor < window.end:
            output.append(Interval(cursor, window.end))
    return output


def actual_windows(
    day: date,
    timezone_name: str,
    rules: list[AvailabilityRule],
    exceptions: list[AvailabilityException],
) -> list[Interval]:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("Unknown IANA time zone") from exc
    local_rules = [
        rule
        for rule in rules
        if rule.day_of_week == day.weekday()
        and (rule.effective_from is None or rule.effective_from <= day)
        and (rule.effective_until is None or rule.effective_until >= day)
    ]
    windows: list[Interval] = []
    for rule in local_rules:
        start = _local_to_utc(day, rule.start_local_time, zone)
        end = _local_to_utc(day, rule.end_local_time, zone)
        if start is not None and end is not None and start < end:
            windows.append(Interval(start, end))
    blocks: list[Interval] = []
    additions: list[Interval] = []
    for exception in exceptions:
        if exception.exception_date != day:
            continue
        if exception.start_local_time is None or exception.end_local_time is None:
            start = datetime.combine(day, time.min, zone).astimezone(UTC)
            end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC)
        else:
            start = _local_to_utc(day, exception.start_local_time, zone)
            end = _local_to_utc(day, exception.end_local_time, zone)
            if start is None or end is None or start >= end:
                continue
        interval = Interval(start, end)
        (blocks if exception.exception_type == "unavailable" else additions).append(interval)
    base = merge(windows + additions)
    return subtract(base, blocks)


def generate_slots(
    start_date: date,
    end_date: date,
    timezone_name: str,
    rules: list[AvailabilityRule],
    exceptions: list[AvailabilityException],
    busy: list[Interval],
    duration_minutes: int,
    interval_minutes: int,
    buffer_before_minutes: int = 0,
    buffer_after_minutes: int = 0,
) -> list[datetime]:
    if end_date < start_date or (end_date - start_date).days > 90:
        raise ValueError("Date range must be between 0 and 90 days")
    if duration_minutes <= 0 or interval_minutes <= 0:
        raise ValueError("Duration and slot interval must be positive")
    candidates: list[datetime] = []
    zone = ZoneInfo(timezone_name)
    day = start_date
    duration = timedelta(minutes=duration_minutes)
    before = timedelta(minutes=buffer_before_minutes)
    after = timedelta(minutes=buffer_after_minutes)
    step = timedelta(minutes=interval_minutes)
    while day <= end_date:
        windows = actual_windows(day, timezone_name, rules, exceptions)
        free = subtract(windows, busy)
        for window in free:
            cursor = window.start + before
            while cursor + duration + after <= window.end:
                # UTC iteration can enter the second occurrence of a repeated local hour.
                if cursor.astimezone(zone).fold == 0:
                    candidates.append(cursor)
                cursor += step
        day += timedelta(days=1)
    return sorted(set(candidates))
