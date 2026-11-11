import uuid
from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.auth.session_store import SessionStore
from app.core.config import settings
from app.db.session import get_db_session
from app.users.models import User, UserRole


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    chess_session_id: str | None = Cookie(default=None, alias=settings.SESSION_COOKIE_NAME),
    x_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> User:
    if not chess_session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    session_data = await SessionStore.get_session(chess_session_id)
    if not session_data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")

    # Verify CSRF for state-mutating requests
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if not x_csrf_token or not await SessionStore.validate_csrf(chess_session_id, x_csrf_token):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")

    user_id = uuid.UUID(session_data["user_id"])
    stmt = (
        select(User)
        .options(selectinload(User.instructor_profile))
        .where(User.id == user_id)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        await SessionStore.destroy_session(chess_session_id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive or removed")

    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator permissions required")
    return current_user


async def require_instructor_or_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in (UserRole.ADMIN, UserRole.INSTRUCTOR):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return current_user
