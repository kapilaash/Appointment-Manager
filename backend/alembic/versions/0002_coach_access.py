"""Add single-use coach invitation and password reset tokens."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_coach_access"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_tokens",
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.CheckConstraint(
            "purpose in ('coach_invitation', 'coach_password_reset')",
            name=op.f("ck_account_tokens_account_token_purpose"),
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_account_tokens_token_hash")),
    )
    op.create_index("ix_account_tokens_id", "account_tokens", ["id"], unique=False)
    op.create_index("ix_account_tokens_email", "account_tokens", ["email"], unique=False)
    op.create_index("ix_account_tokens_user_id", "account_tokens", ["user_id"], unique=False)
    op.create_index(
        "ix_account_tokens_purpose_email",
        "account_tokens",
        ["purpose", "email"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_account_tokens_purpose_email", table_name="account_tokens")
    op.drop_index("ix_account_tokens_user_id", table_name="account_tokens")
    op.drop_index("ix_account_tokens_email", table_name="account_tokens")
    op.drop_index("ix_account_tokens_id", table_name="account_tokens")
    op.drop_table("account_tokens")
