"""Store coach and student country codes for location-aware time zones."""

import sqlalchemy as sa

from alembic import op

revision = "0006_country_codes"
down_revision = "0005_appointment_reasons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("instructors", sa.Column("country_code", sa.String(length=2), nullable=True))
    op.add_column("students", sa.Column("country_code", sa.String(length=2), nullable=True))


def downgrade() -> None:
    op.drop_column("students", "country_code")
    op.drop_column("instructors", "country_code")
