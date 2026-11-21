"""Allow rate-limited public client bookings with scoped idempotency."""

import sqlalchemy as sa

from alembic import op

revision = "0009_public_client_bookings"
down_revision = "0008_student_delete_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("appointments", "created_by", existing_type=sa.UUID(), nullable=True)
    op.create_index(
        "uq_appointments_public_idempotency_key",
        "appointments",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text("created_by IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_appointments_public_idempotency_key", table_name="appointments")
    op.alter_column("appointments", "created_by", existing_type=sa.UUID(), nullable=False)
