"""Password policy shared by registration, reset, change and the admin CLI.

Follows current NIST SP 800-63B guidance: a generous minimum length, a block-list of
commonly leaked passwords, no forced composition rules (users may use passphrases and
password managers) and no periodic expiry.
"""

from functools import lru_cache
from pathlib import Path

MIN_LENGTH = 12
MAX_LENGTH = 128


@lru_cache(maxsize=1)
def _common_passwords() -> frozenset[str]:
    path = Path(__file__).with_name("common_passwords.txt")
    lines = path.read_text(encoding="utf-8").splitlines()
    return frozenset(line.strip().lower() for line in lines if line.strip() and not line.startswith("#"))


def password_problem(password: str, *, email: str | None = None) -> str | None:
    """Return a plain-language reason the password is unsafe, or None when it is acceptable."""
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters. A short phrase of a few words is easy to remember."
    if len(password) > MAX_LENGTH:
        return f"Use at most {MAX_LENGTH} characters."
    normalized = password.strip().lower()
    if normalized in _common_passwords():
        return "This password is too common and appears in leaked password lists. Choose something more personal."
    if len(set(normalized)) < 5:
        return "Use a wider mix of characters; this password repeats too much."
    if email:
        local_part = email.split("@", 1)[0].strip().lower()
        if len(local_part) >= 4 and local_part in normalized:
            return "Do not include your email name in your password."
    return None


def require_strong_password(password: str, *, email: str | None = None) -> str:
    """Pydantic-friendly validator: raise ValueError with the reason, otherwise return the password."""
    problem = password_problem(password, email=email)
    if problem:
        raise ValueError(problem)
    return password
