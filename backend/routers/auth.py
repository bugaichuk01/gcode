"""Аутентификация — логин, регистрация, профиль."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_user
from models import User
from services.auth_service import (
    authenticate_user,
    create_access_token,
    get_password_hash,
    register_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    email: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: str


class UserMeResponse(BaseModel):
    id: str
    username: str
    email: str | None
    role: str
    status: str
    last_login_at: str | None
    created_at: str


@router.post("/login", response_model=TokenResponse)
async def login(
    data: LoginRequest,
    db: AsyncSession = Depends(get_db_session),
) -> TokenResponse:
    user = await authenticate_user(db, data.username, data.password)
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        username=user.username,
        role=str(user.role),
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    data: RegisterRequest,
    db: AsyncSession = Depends(get_db_session),
) -> TokenResponse:
    if len(data.password) < 6:
        raise HTTPException(400, "Пароль должен быть минимум 6 символов")
    user = await register_user(db, data.username, data.password, data.email)
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        username=user.username,
        role=str(user.role),
    )


@router.get("/me", response_model=UserMeResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
) -> UserMeResponse:
    return UserMeResponse(
        id=str(current_user.id),
        username=current_user.username,
        email=current_user.email,
        role=str(current_user.role),
        status=str(current_user.status),
        last_login_at=current_user.last_login_at.isoformat()
        if current_user.last_login_at
        else None,
        created_at=current_user.created_at.isoformat(),
    )


@router.put("/me/password")
async def change_password(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    from services.auth_service import verify_password

    if not verify_password(data.get("old_password", ""), current_user.hashed_password):
        raise HTTPException(400, "Неверный текущий пароль")
    new_password = data.get("new_password", "")
    if len(new_password) < 6:
        raise HTTPException(400, "Пароль должен быть минимум 6 символов")
    current_user.hashed_password = get_password_hash(new_password)
    await db.commit()
    return {"success": True}
