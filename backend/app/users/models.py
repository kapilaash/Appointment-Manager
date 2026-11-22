import enum
import uuid

from sqlalchemy import Boolean, CheckConstraint, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import conv

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    INSTRUCTOR = "instructor"


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            values_callable=lambda roles: [role.value for role in roles],
        ),
        default=UserRole.INSTRUCTOR,
        nullable=False,
    )
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Appearance theme saved to the account so it follows the user across devices (null = default).
    theme_preference: Mapped[str | None] = mapped_column(String(16))

    __table_args__ = (
        CheckConstraint(
            "theme_preference IS NULL OR theme_preference IN ('light', 'classic', 'dark', 'system')",
            name=conv("ck_users_theme_preference"),
        ),
    )

    instructor_profile: Mapped["Instructor"] = relationship("Instructor", back_populates="user", uselist=False, cascade="all, delete-orphan")


class Instructor(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "instructors"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(150), nullable=False)
    timezone: Mapped[str] = mapped_column(String(50), default="Asia/Kolkata", nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2))
    meeting_url: Mapped[str | None] = mapped_column(Text)
    is_available_for_booking: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="instructor_profile")
