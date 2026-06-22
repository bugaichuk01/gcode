from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import async_session_maker
from models import OperationLogStatus, OperationLogType, SuzToken
from services.journal_service import log_operation
from settings import get_settings
logger = logging.getLogger(__name__)
_cached_token: str | None = None
_cached_expires_at: datetime | None = None
async def get_active_token(
    db: AsyncSession,
    org_id=None,
) -> str | None:
    global _cached_token, _cached_expires_at
    now = datetime.now(timezone.utc)
    if _cached_token and _cached_expires_at and _cached_expires_at > now:
        return _cached_token
    q = select(SuzToken).order_by(SuzToken.updated_at.desc()).limit(1)
    if org_id:
        q = select(SuzToken).where(SuzToken.org_id == org_id).order_by(
            SuzToken.updated_at.desc()
        ).limit(1)
    result = await db.scalar(q)
    if result and result.token:
        if result.expires_at is None or result.expires_at > now:
            _cached_token = result.token
            _cached_expires_at = result.expires_at
            return result.token
    settings = get_settings()
    return settings.suz_client_token or settings.suz_auth_token
async def save_token(
    db: AsyncSession,
    token: str,
    expires_at: datetime | None = None,
    oms_connection_id: str | None = None,
    true_api_token: str | None = None,
    true_api_expires_at: datetime | None = None,
    org_id=None,
) -> SuzToken:
    global _cached_token, _cached_expires_at
    q = select(SuzToken).order_by(SuzToken.updated_at.desc()).limit(1)
    if org_id:
        q = select(SuzToken).where(SuzToken.org_id == org_id).order_by(
            SuzToken.updated_at.desc()
        ).limit(1)
    existing = await db.scalar(q)
    if existing:
        existing.token = token
        existing.expires_at = expires_at
        if oms_connection_id:
            existing.oms_connection_id = oms_connection_id
        if true_api_token:
            existing.true_api_token = true_api_token
            existing.true_api_expires_at = true_api_expires_at
        record = existing
    else:
        record = SuzToken(
            token=token,
            expires_at=expires_at,
            oms_connection_id=oms_connection_id,
            true_api_token=true_api_token,
            true_api_expires_at=true_api_expires_at,
            org_id=org_id,
        )
        db.add(record)
    await db.commit()
    await db.refresh(record)
    _cached_token = token
    _cached_expires_at = expires_at
    await log_operation(
        db,
        operation_type=OperationLogType.TOKEN_UPDATED,
        status=OperationLogStatus.SUCCESS,
        description="Токены СУЗ и True API обновлены",
    )
    return record
async def get_true_api_token(db: AsyncSession, org_id=None) -> str | None:
    now = datetime.now(timezone.utc)
    q = select(SuzToken).order_by(SuzToken.updated_at.desc()).limit(1)
    if org_id:
        q = select(SuzToken).where(SuzToken.org_id == org_id).order_by(
            SuzToken.updated_at.desc()
        ).limit(1)
    result = await db.scalar(q)
    if result and result.true_api_token:
        if result.true_api_expires_at is None or result.true_api_expires_at > now:
            return result.true_api_token
    settings = get_settings()
    return settings.true_api_token
async def get_token_info(db: AsyncSession, org_id=None) -> dict:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    q = select(SuzToken).order_by(SuzToken.updated_at.desc()).limit(1)
    if org_id:
        q = select(SuzToken).where(SuzToken.org_id == org_id).order_by(
            SuzToken.updated_at.desc()
        ).limit(1)
    result = await db.scalar(q)
    if result and result.token:
        expires_at = result.expires_at
        is_expired = bool(expires_at and expires_at <= now)
        expires_in_minutes = None
        if expires_at:
            delta = expires_at - now
            expires_in_minutes = int(delta.total_seconds() / 60)
        return {
            "token": result.token[:8] + "...",
            "token_full": result.token,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "expires_in_minutes": expires_in_minutes,
            "is_expired": is_expired,
            "source": "database",
            "oms_connection_id": result.oms_connection_id,
            "updated_at": result.updated_at.isoformat(),
        }
    env_token = settings.suz_client_token or settings.suz_auth_token
    return {
        "token": (env_token[:8] + "...") if env_token else None,
        "token_full": env_token,
        "expires_at": None,
        "expires_in_minutes": None,
        "is_expired": False,
        "source": "env",
        "oms_connection_id": settings.suz_connection_id,
        "updated_at": None,
    }
async def refresh_token_background() -> None:
    while True:
        try:
            await asyncio.sleep(1800)
            async with async_session_maker() as db:
                info = await get_token_info(db)
                expires_in = info.get("expires_in_minutes")
                if expires_in is not None and expires_in < 60:
                    logger.warning(
                        "Токен СУЗ истекает через %d минут! "
                        "Обновите токен в разделе Настройки ЧЗ.",
                        expires_in,
                    )
                elif expires_in is not None:
                    logger.info("Токен СУЗ действителен ещё %d минут.", expires_in)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Ошибка в фоновой задаче токена: %s", e)
