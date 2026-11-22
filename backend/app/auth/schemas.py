import uuid
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.auth.passwords import require_strong_password
from app.users.models import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class CoachInvitationTokenIn(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class PasswordResetRequestIn(BaseModel):
    email: EmailStr


class MfaLoginIn(BaseModel):
    mfa_token: str = Field(min_length=20, max_length=200)
    code: str = Field(
        min_length=6, max_length=32, description="Authenticator code or a recovery code"
    )


class MfaChallengeOut(BaseModel):
    mfa_required: Literal[True] = True
    mfa_token: str


class CoachInvitationOut(BaseModel):
    email: EmailStr
    expires_at: datetime


class CoachRegistrationIn(CoachInvitationTokenIn):
    full_name: str = Field(min_length=1, max_length=150)
    display_name: str = Field(min_length=1, max_length=150)
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    timezone: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        return require_strong_password(value)

    @field_validator("full_name", "display_name")
    @classmethod
    def trim_names(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank")
        return value

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Use a valid IANA time zone") from exc
        return value


class PasswordResetIn(CoachInvitationTokenIn):
    password: str = Field(min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        return require_strong_password(value)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        return require_strong_password(value)


class MfaCodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=32)


class MfaDisableIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(
        min_length=6, max_length=32, description="Authenticator code or a recovery code"
    )


class PasswordConfirmIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class MfaSetupOut(BaseModel):
    secret: str
    otpauth_uri: str


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


ThemePreference = Literal["light", "classic", "dark", "system"]


class InstructorProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    timezone: str
    country_code: str | None = None
    is_available_for_booking: bool


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    theme_preference: ThemePreference | None = None
    mfa_enabled: bool = False
    instructor_profile: InstructorProfileResponse | None = None


class PreferencesIn(BaseModel):
    theme: ThemePreference


class MessageResponse(BaseModel):
    message: str
