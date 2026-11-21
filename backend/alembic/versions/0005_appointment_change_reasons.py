"""Persist cancellation and rescheduling reasons on appointments."""

import sqlalchemy as sa

from alembic import op

revision = "0005_appointment_reasons"
down_revision = "0004_booking_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("appointments", sa.Column("cancellation_reason", sa.String(length=1000)))
    op.add_column("appointments", sa.Column("reschedule_reason", sa.String(length=1000)))


def downgrade() -> None:
    op.drop_column("appointments", "reschedule_reason")
    op.drop_column("appointments", "cancellation_reason")
