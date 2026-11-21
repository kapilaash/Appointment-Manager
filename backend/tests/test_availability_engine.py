from datetime import UTC, date, datetime, time

from app.availability.engine import Interval, generate_slots, merge, subtract
from app.scheduling.models import AvailabilityException, AvailabilityRule


def rule(weekday: int, start: time, end: time) -> AvailabilityRule:
    return AvailabilityRule(day_of_week=weekday, start_local_time=start, end_local_time=end)


def test_slot_generation_respects_duration_and_interval() -> None:
    slots = generate_slots(
        date(2026, 5, 4), date(2026, 5, 4), "UTC",
        [rule(0, time(9), time(12))], [], [], 60, 30,
    )
    assert [slot.strftime("%H:%M") for slot in slots] == ["09:00", "09:30", "10:00", "10:30", "11:00"]


def test_busy_intervals_and_buffers_are_subtracted() -> None:
    busy = [Interval(datetime(2026, 5, 4, 10, tzinfo=UTC), datetime(2026, 5, 4, 11, tzinfo=UTC))]
    slots = generate_slots(
        date(2026, 5, 4), date(2026, 5, 4), "UTC",
        [rule(0, time(9), time(13))], [], busy, 60, 30, 15, 15,
    )
    assert [slot.strftime("%H:%M") for slot in slots] == ["11:15", "11:45"]


def test_full_day_exception_removes_recurring_hours() -> None:
    day = date(2026, 5, 4)
    exception = AvailabilityException(exception_date=day, exception_type="unavailable")
    slots = generate_slots(day, day, "UTC", [rule(0, time(9), time(12))], [exception], [], 60, 30)
    assert slots == []


def test_additional_availability_and_partial_block() -> None:
    day = date(2026, 5, 4)
    additions = AvailabilityException(exception_date=day, start_local_time=time(14), end_local_time=time(16), exception_type="additional_available")
    block = AvailabilityException(exception_date=day, start_local_time=time(10), end_local_time=time(11), exception_type="unavailable")
    slots = generate_slots(day, day, "UTC", [rule(0, time(9), time(12))], [additions, block], [], 60, 60)
    assert [slot.strftime("%H:%M") for slot in slots] == ["09:00", "11:00", "14:00", "15:00"]


def test_spring_dst_skips_nonexistent_local_start() -> None:
    day = date(2026, 3, 8)
    slots = generate_slots(day, day, "America/New_York", [rule(6, time(1), time(4))], [], [], 30, 30)
    local_hours = [(slot.astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).hour,
                    slot.astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).minute) for slot in slots]
    assert local_hours == [(1, 0), (1, 30), (3, 0), (3, 30)]


def test_fall_dst_ambiguous_time_uses_earlier_fold() -> None:
    day = date(2026, 11, 1)
    slots = generate_slots(day, day, "America/New_York", [rule(6, time(1), time(2))], [], [], 30, 30)
    assert len(slots) == 2
    assert slots[0] == datetime(2026, 11, 1, 5, 0, tzinfo=UTC)


def test_interval_merge_and_subtraction() -> None:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    merged = merge([Interval(start, start.replace(hour=2)), Interval(start.replace(hour=1), start.replace(hour=3))])
    assert merged == [Interval(start, start.replace(hour=3))]
    assert subtract(merged, [Interval(start.replace(hour=1), start.replace(hour=2))]) == [
        Interval(start, start.replace(hour=1)), Interval(start.replace(hour=2), start.replace(hour=3)),
    ]


def test_subtract_sweeps_busy_intervals_across_disjoint_windows() -> None:
    day = datetime(2026, 1, 1, tzinfo=UTC)
    windows = [Interval(day, day.replace(hour=2)), Interval(day.replace(hour=4), day.replace(hour=6))]
    busy = [Interval(day.replace(hour=1), day.replace(hour=5))]
    assert subtract(windows, busy) == [
        Interval(day, day.replace(hour=1)),
        Interval(day.replace(hour=5), day.replace(hour=6)),
    ]
