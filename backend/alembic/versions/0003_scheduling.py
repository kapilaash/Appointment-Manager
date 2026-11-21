"""Add coach availability, students, appointments, and durable booking events."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003_scheduling"
down_revision = "0002_coach_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "btree_gist"')
    now = sa.text("now()")
    op.create_table(
        "availability_rules",
        sa.Column("instructor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("instructors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("start_local_time", sa.Time(), nullable=False),
        sa.Column("end_local_time", sa.Time(), nullable=False),
        sa.Column("effective_from", sa.Date()), sa.Column("effective_until", sa.Date()),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.CheckConstraint("day_of_week between 0 and 6", name="ck_availability_weekday"),
        sa.CheckConstraint("start_local_time < end_local_time", name="ck_availability_interval"),
    )
    op.create_index("ix_availability_rules_instructor_id", "availability_rules", ["instructor_id"])

    op.create_table(
        "availability_exceptions",
        sa.Column("instructor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("instructors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("exception_date", sa.Date(), nullable=False),
        sa.Column("start_local_time", sa.Time()), sa.Column("end_local_time", sa.Time()),
        sa.Column("exception_type", sa.String(30), nullable=False), sa.Column("reason", sa.String(240)),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.CheckConstraint("exception_type in ('unavailable', 'additional_available')", name="ck_availability_exception_type"),
        sa.CheckConstraint("(start_local_time is null) = (end_local_time is null)", name="ck_availability_exception_bounds"),
        sa.CheckConstraint("start_local_time is null or start_local_time < end_local_time", name="ck_availability_exception_order"),
    )
    op.create_index("ix_availability_exceptions_instructor_id", "availability_exceptions", ["instructor_id"])
    op.create_index("ix_availability_exceptions_exception_date", "availability_exceptions", ["exception_date"])

    op.create_table(
        "students",
        sa.Column("name", sa.String(160), nullable=False), sa.Column("parent_name", sa.String(160)),
        sa.Column("email", sa.String(320), nullable=False), sa.Column("phone", sa.String(40)),
        sa.Column("timezone", sa.String(80), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
    )
    op.create_index("ix_students_email", "students", ["email"])

    op.create_table(
        "appointments",
        sa.Column("instructor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("instructors.id"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("students.id"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False), sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("occupied_from", sa.DateTime(timezone=True), nullable=False), sa.Column("occupied_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="confirmed"),
        sa.Column("meeting_url", sa.Text()), sa.Column("notes", sa.Text()), sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.CheckConstraint("starts_at < ends_at", name="ck_appointment_order"),
        sa.CheckConstraint("occupied_from <= starts_at and ends_at <= occupied_until", name="ck_appointment_occupied_bounds"),
        sa.CheckConstraint("status in ('confirmed', 'cancelled', 'completed')", name="ck_appointment_status"),
        sa.UniqueConstraint("created_by", "idempotency_key", name="uq_appointments_idempotency_key"),
    )
    op.create_index("ix_appointments_instructor_starts", "appointments", ["instructor_id", "starts_at"])
    op.execute("""ALTER TABLE appointments ADD CONSTRAINT ex_appointments_instructor_occupied
        EXCLUDE USING gist (instructor_id WITH =, tstzrange(occupied_from, occupied_until, '[)') WITH &&)
        WHERE (status IN ('confirmed'))""")

    op.create_table(
        "outbox_events",
        sa.Column("event_type", sa.String(80), nullable=False), sa.Column("aggregate_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False), sa.Column("processing_status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processing_started_at", sa.DateTime(timezone=True)), sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
    )
    op.create_index("ix_outbox_events_aggregate_id", "outbox_events", ["aggregate_id"])
    op.create_index("ix_outbox_events_processing_status", "outbox_events", ["processing_status"])


def downgrade() -> None:
    op.drop_table("outbox_events")
    op.drop_constraint("ex_appointments_instructor_occupied", "appointments", type_="exclude")
    op.drop_table("appointments")
    op.drop_table("students")
    op.drop_table("availability_exceptions")
    op.drop_table("availability_rules")
