"""Password reset for every role, two-step sign-in, and account security notifications."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012_account_security"
down_revision = "0011_user_theme_preference"
branch_labels = None
depends_on = None


# Migrations 0010/0011 passed already-prefixed names through the naming convention, which
# prefixed them again (e.g. ck_users_ck_users_theme_preference). Align them with the models.
DOUBLE_PREFIXED = {
    "users": [("ck_users_ck_users_theme_preference", "ck_users_theme_preference")],
    "change_requests": [
        ("ck_change_requests_ck_change_requests_type", "ck_change_requests_type"),
        ("ck_change_requests_ck_change_requests_status", "ck_change_requests_status"),
    ],
}


def upgrade() -> None:
    for table, renames in DOUBLE_PREFIXED.items():
        for old, new in renames:
            op.execute(f"ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new}")
    op.add_column("users", sa.Column("mfa_secret_encrypted", sa.Text()))
    op.add_column("users", sa.Column("mfa_enabled_at", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("mfa_recovery_code_hashes", postgresql.JSONB()))
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True)))

    op.drop_constraint(op.f("ck_account_tokens_account_token_purpose"), "account_tokens", type_="check")
    op.create_check_constraint(
        op.f("ck_account_tokens_account_token_purpose"),
        "account_tokens",
        "purpose in ('coach_invitation', 'coach_password_reset', 'password_reset')",
    )

    op.add_column("notification_events", sa.Column("user_id", postgresql.UUID(as_uuid=True)))
    op.create_foreign_key(
        "fk_notification_events_user_id_users", "notification_events", "users", ["user_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_notification_events_user_id", "notification_events", ["user_id"])
    op.drop_constraint(op.f("ck_notification_events_ck_notification_events_subject"), "notification_events", type_="check")
    op.create_check_constraint(
        op.f("ck_notification_events_subject"),
        "notification_events",
        "num_nonnulls(appointment_id, change_request_id, user_id) = 1",
    )


def downgrade() -> None:
    op.execute("DELETE FROM notification_events WHERE user_id IS NOT NULL")
    op.drop_constraint(op.f("ck_notification_events_subject"), "notification_events", type_="check")
    op.create_check_constraint(
        op.f("ck_notification_events_ck_notification_events_subject"),
        "notification_events",
        "(appointment_id IS NULL) <> (change_request_id IS NULL)",
    )
    op.drop_index("ix_notification_events_user_id", table_name="notification_events")
    op.drop_constraint("fk_notification_events_user_id_users", "notification_events", type_="foreignkey")
    op.drop_column("notification_events", "user_id")

    op.execute("DELETE FROM account_tokens WHERE purpose = 'password_reset'")
    op.drop_constraint(op.f("ck_account_tokens_account_token_purpose"), "account_tokens", type_="check")
    op.create_check_constraint(
        op.f("ck_account_tokens_account_token_purpose"), "account_tokens", "purpose in ('coach_invitation', 'coach_password_reset')"
    )

    op.drop_column("users", "password_changed_at")
    op.drop_column("users", "mfa_recovery_code_hashes")
    op.drop_column("users", "mfa_enabled_at")
    op.drop_column("users", "mfa_secret_encrypted")
    for table, renames in DOUBLE_PREFIXED.items():
        for old, new in renames:
            op.execute(f"ALTER TABLE {table} RENAME CONSTRAINT {new} TO {old}")
