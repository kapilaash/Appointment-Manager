from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.auth.dependencies import get_current_user
from app.auth.schemas import LoginRequest, MessageResponse, UserResponse
from app.auth.session_store import SessionStore
from app.core.config import settings
from app.core.security import verify_password
from app.db.session import get_db_session
from app.users.models import User

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=UserResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db_session)
):
    stmt = (
        select(User)
        .options(selectinload(User.instructor_profile))
        .where(User.email == payload.email.strip().lower())
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated"
        )

    session_id, csrf_token = await SessionStore.create_session(
        user_id=user.id,
        data={"email": user.email, "role": user.role.value}
    )

    # Set secure HttpOnly session cookie
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=session_id,
        max_age=settings.SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=(settings.ENVIRONMENT == "production"),
        samesite="lax",
        path="/"
    )

    # Set readable CSRF cookie for client header submission
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        max_age=settings.SESSION_MAX_AGE_SECONDS,
        httponly=False,
        secure=(settings.ENVIRONMENT == "production"),
        samesite="lax",
        path="/"
    )

    return user


@router.post("/logout", response_model=MessageResponse)
async def logout(
    response: Response,
    chess_session_id: str | None = Cookie(default=None, alias=settings.SESSION_COOKIE_NAME)
):
    if chess_session_id:
        await SessionStore.destroy_session(chess_session_id)

    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/")
    response.delete_cookie("csrf_token", path="/")
    return MessageResponse(message="Successfully logged out")


@router.get("/me", response_model=UserResponse)
async def get_my_profile(current_user: User = Depends(get_current_user)):
    return current_user
