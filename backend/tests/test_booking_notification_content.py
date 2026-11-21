from app.workers.main import _booking_notification_body


def test_booking_email_includes_operational_details_without_internal_notes() -> None:
    body = _booking_notification_body(
        event_label="rescheduled",
        student_name="Student Name",
        parent_name="Parent Name",
        contact_email="parent@example.com",
        coach_name="Coach Name",
        student_local_time="Monday, November 23, 2026 at 4:00 PM EST – 5:00 PM EST",
        coach_local_time="Monday, November 23, 2026 at 4:00 PM EST – 5:00 PM EST",
        meeting_url="https://meet.example.com/room",
        reason="Family requested a later time",
        booking_reference="booking-123",
    )

    assert "Student: Student Name" in body
    assert "Contact: parent@example.com" in body
    assert "Meeting link: https://meet.example.com/room" in body
    assert "Reason: Family requested a later time" in body
    assert "Notes:" not in body
