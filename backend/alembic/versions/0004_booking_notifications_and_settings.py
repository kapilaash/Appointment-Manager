"""Persist notification delivery status and academy booking settings."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004_booking_notifications"
down_revision: str | None = "0003_scheduling"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    now = sa.text("now()")
    op.create_table(
        "notification_events",
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=60), nullable=False),
        sa.Column("event_key", sa.String(length=36), nullable=False),
        sa.Column("recipient", sa.String(length=320), nullable=False),
        sa.Column("delivery_status", sa.String(length=30), nullable=False, server_default="queued"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=500)),
        sa.Column("provider_reference", sa.String(length=240)),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_notification_events_appointment_id", "notification_events", ["appointment_id"])
    op.create_index(
        "uq_notification_event_recipient",
        "notification_events",
        ["appointment_id", "event_key", "recipient"],
        unique=True,
    )
    op.create_table(
        "academy_settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", sa.String(length=500), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("academy_settings")
    op.drop_index("uq_notification_event_recipient", table_name="notification_events")
    op.drop_index("ix_notification_events_appointment_id", table_name="notification_events")
    op.drop_table("notification_events")
