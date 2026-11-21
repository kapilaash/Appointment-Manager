"""Allow student deletion while retaining redacted booking history."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_student_delete_history"
down_revision: str | None = "0007_meeting_student"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Older versions anonymized a student row instead of removing it. Convert
    # those rows to the same detached, redacted history used by new deletions.
    op.drop_constraint("fk_appointments_student_id_students", "appointments", type_="foreignkey")
    op.alter_column("appointments", "student_id", existing_type=sa.Uuid(), nullable=True)
    op.execute(
        """
        DELETE FROM notification_events
        WHERE recipient IN (
            SELECT email FROM students WHERE email LIKE '%@privacy.invalid'
        )
        """
    )
    op.execute(
        """
        UPDATE outbox_events
        SET payload = payload - 'reason'
        WHERE processing_status IN ('pending', 'processing')
          AND event_type IN ('booking.cancelled', 'booking.rescheduled')
          AND aggregate_id IN (
              SELECT id FROM appointments
              WHERE student_id IN (
                  SELECT id FROM students WHERE email LIKE '%@privacy.invalid'
              )
          )
        """
    )
    op.execute(
        """
        UPDATE appointments
        SET student_id = NULL, notes = NULL,
            cancellation_reason = NULL, reschedule_reason = NULL
        WHERE student_id IN (
            SELECT id FROM students WHERE email LIKE '%@privacy.invalid'
        )
        """
    )
    op.execute("DELETE FROM students WHERE email LIKE '%@privacy.invalid'")
    op.create_foreign_key(
        "fk_appointments_student_id_students",
        "appointments",
        "students",
        ["student_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_column("students", "deleted_at")


def downgrade() -> None:
    # Deleted student details cannot be reconstructed. Restore the old column
    # and constraint shape only; preexisting redacted bookings keep a null id.
    from uuid import uuid4

    connection = op.get_bind()
    op.add_column("students", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint("fk_appointments_student_id_students", "appointments", type_="foreignkey")
    null_appointments = connection.execute(
        sa.text("SELECT id FROM appointments WHERE student_id IS NULL")
    ).scalars().all()
    for appointment_id in null_appointments:
        student_id = uuid4()
        connection.execute(
            sa.text(
                "INSERT INTO students (id, name, email, timezone) "
                "VALUES (:id, 'Deleted student', :email, 'UTC')"
            ),
            {"id": student_id, "email": f"deleted-{student_id.hex}@privacy.invalid"},
        )
        connection.execute(
            sa.text("UPDATE appointments SET student_id = :student_id WHERE id = :appointment_id"),
            {"student_id": student_id, "appointment_id": appointment_id},
        )
    op.alter_column("appointments", "student_id", existing_type=sa.Uuid(), nullable=False)
    op.create_foreign_key(
        "fk_appointments_student_id_students",
        "appointments",
        "students",
        ["student_id"],
        ["id"],
    )
