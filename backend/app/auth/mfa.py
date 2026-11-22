"""Two-step sign-in with authenticator-app codes (TOTP, RFC 6238) and recovery codes."""

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime

import pyotp
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

ISSUER = "Thirumal Chess Academy"
RECOVERY_CODE_COUNT = 10


def _fernet() -> Fernet:
    # A dedicated key derived from SECRET_KEY: the TOTP secret is useless without the server key.
    # Rotating SECRET_KEY therefore requires users to set up two-step sign-in again.
    key = hashlib.sha256(f"mfa-secret-encryption:{settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def new_secret() -> str:
    return pyotp.random_base32()


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)


def matching_time_step(secret: str, code: str, *, at: datetime | None = None) -> int | None:
    """Return the accepted 30-second time step for a code (±1 step for clock drift), else None."""
    cleaned = "".join(character for character in code if character.isdigit())
    if len(cleaned) != 6:
        return None
    totp = pyotp.TOTP(secret)
    now_step = totp.timecode(at or datetime.now(UTC))
    for step in (now_step, now_step - 1, now_step + 1):
        if hmac.compare_digest(totp.generate_otp(step), cleaned):
            return step
    return None


def _normalize_recovery_code(code: str) -> str:
    return "".join(character for character in code.lower() if character.isalnum())


def hash_recovery_code(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), _normalize_recovery_code(code).encode(), hashlib.sha256).hexdigest()


def new_recovery_codes() -> list[str]:
    """Ten single-use codes like "k7p2-9xq4-m3vd" (about 60 bits each)."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(alphabet) for _ in range(12))
        codes.append(f"{raw[:4]}-{raw[4:8]}-{raw[8:]}")
    return codes
