import uuid
from typing import Optional
from pydantic import BaseModel, EmailStr
from app.users.models import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class InstructorProfileResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    timezone: str
    is_available_for_booking: bool


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    instructor_profile: Optional[InstructorProfileResponse] = None


class MessageResponse(BaseModel):
    message: str
