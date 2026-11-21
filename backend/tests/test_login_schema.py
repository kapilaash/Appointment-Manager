import pytest
from pydantic import ValidationError

from app.auth.schemas import LoginRequest


def test_login_accepts_a_valid_email() -> None:
    request = LoginRequest(email="admin@example.com", password="not-a-real-password")
    assert request.email == "admin@example.com"


def test_login_rejects_a_malformed_email() -> None:
    with pytest.raises(ValidationError):
        LoginRequest(email="bad..name@example.com", password="not-a-real-password")
