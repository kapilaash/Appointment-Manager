"""Coach change requests that need administrator approval."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0010_change_requests"
down_revision = "0009_public_client_bookings"
branch_labels = None
depends_on = None

REQUEST_TYPES = (
    "request_type in ('weekly_availability', 'exception_add', 'exception_remove', "
    "'timezone_change', 'appointment_cancel', 'appointment_reschedule')"
)
REQUEST_STATUSES = "status in ('pending', 'approved', 'rejected', 'withdrawn', 'superseded')"


def upgrade() -> None:
    now = sa.text("now()")
    op.create_table(
        "change_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("instructor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True)),
        sa.Column("request_type", sa.String(length=40), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True)),
        sa.Column("exception_id", postgresql.UUID(as_uuid=True)),
        sa.Column("coach_note", sa.String(length=1000)),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True)),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("review_note", sa.String(length=1000)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.ForeignKeyConstraint(["instructor_id"], ["instructors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="SET NULL"),
        sa.CheckConstraint(REQUEST_TYPES, name="ck_change_requests_type"),
        sa.CheckConstraint(REQUEST_STATUSES, name="ck_change_requests_status"),
    )
    op.create_index("ix_change_requests_id", "change_requests", ["id"])
    op.create_index("ix_change_requests_instructor_id", "change_requests", ["instructor_id"])
    op.create_index(
        "ix_change_requests_status_created", "change_requests", ["status", "created_at"]
    )
    pending_indexes = {
        "uq_change_requests_pending_weekly": (
            "instructor_id",
            "status = 'pending' AND request_type = 'weekly_availability'",
        ),
        "uq_change_requests_pending_timezone": (
            "instructor_id",
            "status = 'pending' AND request_type = 'timezone_change'",
        ),
        "uq_change_requests_pending_appointment": (
            "appointment_id",
            "status = 'pending' AND appointment_id IS NOT NULL",
        ),
        "uq_change_requests_pending_exception_remove": (
            "exception_id",
            "status = 'pending' AND request_type = 'exception_remove'",
        ),
    }
    for name, (column, where) in pending_indexes.items():
        op.create_index(
            name, "change_requests", [column], unique=True, postgresql_where=sa.text(where)
        )

    op.alter_column(
        "notification_events",
        "appointment_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.add_column(
        "notification_events", sa.Column("change_request_id", postgresql.UUID(as_uuid=True))
    )
    op.create_foreign_key(
        "fk_notification_events_change_request_id_change_requests",
        "notification_events",
        "change_requests",
        ["change_request_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_notification_events_change_request_id", "notification_events", ["change_request_id"]
    )
    op.create_check_constraint(
        "ck_notification_events_subject",
        "notification_events",
        "(appointment_id IS NULL) <> (change_request_id IS NULL)",
    )
    # event_key is the outbox event id, so it is already unique per message batch.
    op.drop_index("uq_notification_event_recipient", table_name="notification_events")
    op.create_index(
        "uq_notification_event_recipient",
        "notification_events",
        ["event_key", "recipient"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_notification_event_recipient", table_name="notification_events")
    op.execute("DELETE FROM notification_events WHERE change_request_id IS NOT NULL")
    op.create_index(
        "uq_notification_event_recipient",
        "notification_events",
        ["appointment_id", "event_key", "recipient"],
        unique=True,
    )
    op.drop_constraint("ck_notification_events_subject", "notification_events", type_="check")
    op.drop_index("ix_notification_events_change_request_id", table_name="notification_events")
    op.drop_constraint(
        "fk_notification_events_change_request_id_change_requests",
        "notification_events",
        type_="foreignkey",
    )
    op.drop_column("notification_events", "change_request_id")
    op.alter_column(
        "notification_events",
        "appointment_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.drop_table("change_requests")
