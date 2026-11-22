"""Save each user's appearance theme on their account so it follows them across devices."""

import sqlalchemy as sa

from alembic import op

revision = "0011_user_theme_preference"
down_revision = "0010_change_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("theme_preference", sa.String(length=16)))
    op.create_check_constraint(
        "ck_users_theme_preference",
        "users",
        "theme_preference IS NULL OR theme_preference IN ('light', 'classic', 'dark', 'system')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_theme_preference", "users", type_="check")
    op.drop_column("users", "theme_preference")
