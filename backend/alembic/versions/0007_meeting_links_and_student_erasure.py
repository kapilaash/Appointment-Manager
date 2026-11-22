"""Store coach meeting links and record student data erasure."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_meeting_student"
down_revision: str | None = "0006_country_codes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("instructors", sa.Column("meeting_url", sa.Text(), nullable=True))
    op.add_column("students", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE students SET deleted_at = now() WHERE email LIKE '%@privacy.invalid'")


def downgrade() -> None:
    op.drop_column("students", "deleted_at")
    op.drop_column("instructors", "meeting_url")
