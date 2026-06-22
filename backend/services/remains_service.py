"""Сервис ввода в оборот остатков (LP_INTRODUCE_OST)."""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from services.suz_integration_service import _suz_dispatch_httpx
from services.token_service import get_true_api_token
from settings import get_settings

logger = logging.getLogger(__name__)


def build_introduce_ost_document(
    marking_codes: list[str],
    product_group: str = "perfumery",
) -> dict:
    """Документ LP_INTRODUCE_OST — ввод в оборот остатков."""
    _ = product_group
    return {
        "introduction_type": "REMAINS",
        "introduction_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        "cises": marking_codes,
    }


def encode_introduce_ost_body(
    marking_codes: list[str],
    product_group: str = "perfumery",
) -> tuple[str, str]:
    doc = build_introduce_ost_document(marking_codes, product_group)
    doc_json = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    doc_b64 = base64.b64encode(doc_json.encode("utf-8")).decode("utf-8")
    return doc_json, doc_b64


async def send_introduce_ost(
    marking_codes: list[str],
    signature: str,
    product_group: str,
    db: AsyncSession,
) -> dict:
    """Отправить документ ввода в оборот остатков."""
    settings = get_settings()
    token = await get_true_api_token(db)
    base_url = (settings.true_api_base_url or "").rstrip("/")

    if not token:
        raise ValueError("Не настроен JWT токен True API")

    doc_json, doc_b64 = encode_introduce_ost_body(marking_codes, product_group)

    request_body = {
        "document_format": "MANUAL",
        "type": "LP_INTRODUCE_OST",
        "product_document": doc_b64,
        "signature": signature.replace("\r", "").replace("\n", "").strip(),
    }

    url = f"{base_url}/api/v3/true-api/lk/documents/create"
    params = {"pg": product_group}
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    body_str = json.dumps(request_body, ensure_ascii=False)
    logger.info("LP_INTRODUCE_OST: pg=%s, codes=%d", product_group, len(marking_codes))

    response, err = await _suz_dispatch_httpx(
        method="POST",
        url=url,
        headers=headers,
        params=params,
        content=body_str.encode("utf-8"),
    )

    if response is None:
        raise RuntimeError(f"Ошибка: {err}")

    logger.info(
        "LP_INTRODUCE_OST response: %d %s",
        response.status_code,
        response.text[:200],
    )

    if response.status_code in (200, 201, 202):
        return {"success": True, "response": response.json()}

    raise RuntimeError(
        f"Ошибка {response.status_code}: {response.text[:300]}"
    )
