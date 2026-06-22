"""FastAPI зависимости для аутентификации."""
from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from models import Organization, User, UserRole, UserStatus
from services.auth_service import decode_token, get_user_by_id

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db_session),
) -> User:
    """Получить текущего авторизованного пользователя."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется авторизация",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=401, detail="Недействительный токен")

    user = await get_user_by_id(db, UUID(user_id_str))
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    if user.status == UserStatus.BLOCKED:
        raise HTTPException(status_code=403, detail="Аккаунт заблокирован")
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    return current_user


async def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Требовать роль admin."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Требуются права администратора",
        )
    return current_user


async def get_current_org(
    org_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Organization | None:
    """Получить текущую организацию пользователя."""
    if org_id:
        org = await db.get(Organization, UUID(org_id))
        if not org or org.user_id != current_user.id:
            raise HTTPException(403, "Нет доступа к этой организации")
        return org
    return await db.scalar(
        select(Organization)
        .where(Organization.user_id == current_user.id)
        .where(Organization.is_active == True)
        .limit(1)
    )
