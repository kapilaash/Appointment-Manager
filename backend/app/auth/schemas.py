import uuid
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.users.models import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class CoachInvitationTokenIn(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class CoachPasswordResetRequestIn(BaseModel):
    email: EmailStr


class CoachInvitationOut(BaseModel):
    email: EmailStr
    expires_at: datetime


class CoachRegistrationIn(CoachInvitationTokenIn):
    full_name: str = Field(min_length=1, max_length=150)
    display_name: str = Field(min_length=1, max_length=150)
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    timezone: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=12, max_length=128)

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


class CoachPasswordResetIn(CoachInvitationTokenIn):
    password: str = Field(min_length=12, max_length=128)


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
    instructor_profile: InstructorProfileResponse | None = None


class PreferencesIn(BaseModel):
    theme: ThemePreference


class MessageResponse(BaseModel):
    message: str
