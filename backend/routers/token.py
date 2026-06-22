from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import Organization, User
from services.token_service import get_token_info, get_true_api_token, save_token
from settings import get_settings

router = APIRouter(prefix="/token", tags=["token"])


class TokenSaveRequest(BaseModel):
    token: str
    oms_connection_id: str | None = None
    expires_in_hours: float = 10.0
    true_api_token: str | None = None
    true_api_expires_in_hours: float = 10.0


class TokenInfoResponse(BaseModel):
    token: str | None
    expires_at: str | None
    expires_in_minutes: int | None
    is_expired: bool
    source: str
    oms_connection_id: str | None
    updated_at: str | None
    true_api_token_configured: bool | None = None
    true_api_token_preview: str | None = None


@router.post("/save")
async def save_suz_token(
    data: TokenSaveRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=data.expires_in_hours)
    true_api_expires_at = None
    if data.true_api_token:
        true_api_expires_at = datetime.now(timezone.utc) + timedelta(
            hours=data.true_api_expires_in_hours
        )
    record = await save_token(
        db,
        token=data.token,
        expires_at=expires_at,
        oms_connection_id=data.oms_connection_id,
        true_api_token=data.true_api_token,
        true_api_expires_at=true_api_expires_at,
        org_id=org.id if org else None,
    )
    return {
        "success": True,
        "expires_at": record.expires_at.isoformat() if record.expires_at else None,
        "true_api_token_saved": bool(data.true_api_token),
    }


@router.get("/info", response_model=TokenInfoResponse)
async def get_token_status(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> TokenInfoResponse:
    org_id = org.id if org else None
    info = await get_token_info(db, org_id=org_id)
    true_token = await get_true_api_token(db, org_id=org_id)
    info["true_api_token_configured"] = bool(true_token)
    info["true_api_token_preview"] = (
        true_token[:20] + "..." if true_token else None
    )
    return TokenInfoResponse(**{k: v for k, v in info.items() if k != "token_full"})


@router.get("/auth-key")
async def get_auth_key(
    _: User = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    base = settings.true_api_base_url
    if not base:
        raise HTTPException(status_code=500, detail="Не задан TRUE_API_BASE_URL в настройках")
    async with httpx.AsyncClient(verify=settings.suz_tls_verify, timeout=30) as client:
        res = await client.get(f"{base.rstrip('/')}/api/v3/true-api/auth/key")
    if res.status_code != 200:
        raise HTTPException(status_code=res.status_code, detail=res.text)
    return res.json()


class AuthSignInRequest(BaseModel):
    uuid: str
    data: str


@router.post("/auth-signin/{oms_connection}")
async def auth_signin(
    oms_connection: str,
    body: AuthSignInRequest,
    _: User = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    base = settings.true_api_base_url
    if not base:
        raise HTTPException(status_code=500, detail="Не задан TRUE_API_BASE_URL в настройках")
    async with httpx.AsyncClient(verify=settings.suz_tls_verify, timeout=30) as client:
        res = await client.post(
            f"{base.rstrip('/')}/api/v3/true-api/auth/simpleSignIn/{oms_connection}",
            json=body.model_dump(),
            headers={"Content-Type": "application/json"},
        )
    if res.status_code != 200:
        try:
            detail = res.json()
        except Exception:
            detail = res.text
        raise HTTPException(status_code=400, detail=detail)
    return res.json()


@router.post("/auth-signin-true-api")
async def auth_signin_true_api(
    body: AuthSignInRequest,
    _: User = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    base = settings.true_api_base_url
    if not base:
        raise HTTPException(status_code=500, detail="Не задан TRUE_API_BASE_URL в настройках")
    async with httpx.AsyncClient(verify=settings.suz_tls_verify, timeout=30) as client:
        res = await client.post(
            f"{base.rstrip('/')}/api/v3/true-api/auth/simpleSignIn",
            json=body.model_dump(),
            headers={"Content-Type": "application/json"},
        )
    if res.status_code != 200:
        try:
            detail = res.json()
        except Exception:
            detail = res.text
        raise HTTPException(status_code=res.status_code, detail=detail)
    return res.json()
