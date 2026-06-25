"""Сервис ввода в оборот «Производство РФ» (LP_INTRODUCE_GOODS)."""
from __future__ import annotations

import base64
import json
import logging
import re
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from models import ProductCard
from services.emission_order_service import resolve_product_card_by_gtin
from services.suz_integration_service import _suz_dispatch_httpx
from services.token_service import get_true_api_token
from settings import get_settings
from utils.marking_code import normalize_marking_code

logger = logging.getLogger(__name__)

_PRODUCTION_TYPE_OWN = "OWN_PRODUCTION"
_CERTIFICATE_TYPE_CONFORMITY = "CONFORMITY_CERTIFICATE"
_GTIN_RE = re.compile(r"^01(\d{14})")


def extract_gtin_from_code(code: str) -> str | None:
    m = _GTIN_RE.match((code or "").strip())
    return m.group(1) if m else None


def _attr_value_as_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        parts = [_attr_value_as_string(item) for item in value]
        return next((p for p in parts if p), "")
    return str(value).strip()


def _normalize_certificate_date(raw: str) -> str | None:
    text = raw.strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    digits = "".join(c for c in text if c.isdigit())
    if len(digits) == 8:
        try:
            return datetime.strptime(digits, "%d%m%Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def _attr_name_matches(name: str, *, kind: str) -> bool:
    normalized = name.lower()
    if kind == "number":
        return "номер" in normalized and any(
            token in normalized for token in ("сертификат", "декларац", "соответств")
        )
    if kind == "date":
        return "дата" in normalized and any(
            token in normalized for token in ("сертификат", "декларац", "соответств")
        )
    return False


def extract_certificate_document_data(card: ProductCard | None) -> list[dict[str, str]]:
    """Данные сертификата из НК-карточки (extra_attrs). Если нет — пустой список."""
    if card is None or not card.extra_attrs or not isinstance(card.extra_attrs, dict):
        return []

    attrs = card.extra_attrs.get("nk_attrs") or {}
    optional = card.extra_attrs.get("nk_optional_attrs") or {}
    names = card.extra_attrs.get("nk_attrs_names") or {}
    merged: dict[Any, Any] = {}
    if isinstance(attrs, dict):
        merged.update(attrs)
    if isinstance(optional, dict):
        merged.update(optional)

    cert_number: str | None = None
    cert_date: str | None = None

    for key, value in merged.items():
        attr_name = names.get(str(key), str(key)) if isinstance(names, dict) else str(key)
        if not isinstance(attr_name, str):
            continue
        val = _attr_value_as_string(value)
        if not val:
            continue
        if _attr_name_matches(attr_name, kind="number"):
            cert_number = val
        elif _attr_name_matches(attr_name, kind="date"):
            cert_date = _normalize_certificate_date(val)

    if cert_number and cert_date:
        return [
            {
                "certificate_type": _CERTIFICATE_TYPE_CONFORMITY,
                "certificate_number": cert_number,
                "certificate_date": cert_date,
            }
        ]
    return []


def resolve_tnved_code(
    card: ProductCard | None,
    *,
    fill_from_cards: bool,
    default_tnved: str | None,
) -> str:
    if fill_from_cards and card is not None:
        code = (card.tn_ved_code or card.tn_ved or "").strip()
        if code:
            return code
    return (default_tnved or "").strip()


async def _resolve_product_card(
    db: AsyncSession,
    gtin: str | None,
    org_id: Any | None,
) -> ProductCard | None:
    card = await resolve_product_card_by_gtin(db, gtin)
    if card is None:
        return None
    if org_id is not None and card.org_id is not None and card.org_id != org_id:
        return None
    return card


async def build_introduce_goods_products(
    marking_codes: list[str],
    db: AsyncSession,
    *,
    org_id: Any | None = None,
    default_tnved_code: str | None = None,
    fill_tnved_from_cards: bool = False,
    fill_certificate_from_cards: bool = False,
) -> list[dict[str, Any]]:
    products: list[dict[str, Any]] = []
    for raw_code in marking_codes:
        uit_code = normalize_marking_code(raw_code)
        gtin = extract_gtin_from_code(uit_code)
        card: ProductCard | None = None
        if gtin and (fill_tnved_from_cards or fill_certificate_from_cards):
            card = await _resolve_product_card(db, gtin, org_id)

        tnved_code = resolve_tnved_code(
            card,
            fill_from_cards=fill_tnved_from_cards,
            default_tnved=default_tnved_code,
        )
        certificate_document_data = (
            extract_certificate_document_data(card)
            if fill_certificate_from_cards
            else []
        )
        products.append(
            {
                "uit_code": uit_code,
                "tnved_code": tnved_code,
                "certificate_document_data": certificate_document_data,
            }
        )
    return products


def build_introduce_goods_body(
    *,
    participant_inn: str,
    producer_inn: str,
    owner_inn: str,
    products: list[dict[str, Any]],
    production_date: str | None = None,
    production_type: str = _PRODUCTION_TYPE_OWN,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "participant_inn": participant_inn,
        "producer_inn": producer_inn,
        "owner_inn": owner_inn,
        "production_type": production_type,
        "products": products,
    }
    if production_date:
        body["production_date"] = production_date
    return body


async def build_introduce_goods_document(
    marking_codes: list[str],
    db: AsyncSession,
    *,
    org_inn: str,
    production_date: str | None = None,
    default_tnved_code: str | None = None,
    fill_tnved_from_cards: bool = False,
    fill_certificate_from_cards: bool = False,
    org_id: Any | None = None,
) -> dict[str, Any]:
    inn = org_inn.strip()
    if not inn:
        raise ValueError("Не указан ИНН организации")

    products = await build_introduce_goods_products(
        marking_codes,
        db,
        org_id=org_id,
        default_tnved_code=default_tnved_code,
        fill_tnved_from_cards=fill_tnved_from_cards,
        fill_certificate_from_cards=fill_certificate_from_cards,
    )
    return build_introduce_goods_body(
        participant_inn=inn,
        producer_inn=inn,
        owner_inn=inn,
        products=products,
        production_date=production_date,
    )


def encode_introduce_goods_body(doc: dict[str, Any]) -> tuple[str, str]:
    doc_json = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    doc_b64 = base64.b64encode(doc_json.encode("utf-8")).decode("utf-8")
    return doc_json, doc_b64


async def send_introduce_goods(
    marking_codes: list[str],
    signature: str,
    product_group: str,
    db: AsyncSession,
    *,
    org_inn: str,
    production_date: str | None = None,
    default_tnved_code: str | None = None,
    fill_tnved_from_cards: bool = False,
    fill_certificate_from_cards: bool = False,
    org_id: Any | None = None,
) -> dict:
    """Отправить LP_INTRODUCE_GOODS через True API /lk/documents/create."""
    settings = get_settings()
    token = await get_true_api_token(db)
    base_url = (settings.true_api_base_url or "").rstrip("/")

    if not token:
        raise ValueError("Не настроен JWT токен True API")

    doc = await build_introduce_goods_document(
        marking_codes,
        db,
        org_inn=org_inn,
        production_date=production_date,
        default_tnved_code=default_tnved_code,
        fill_tnved_from_cards=fill_tnved_from_cards,
        fill_certificate_from_cards=fill_certificate_from_cards,
        org_id=org_id,
    )
    doc_json, doc_b64 = encode_introduce_goods_body(doc)

    request_body = {
        "document_format": "MANUAL",
        "type": "LP_INTRODUCE_GOODS",
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
    logger.info(
        "LP_INTRODUCE_GOODS: pg=%s, codes=%d, fill_tnved=%s, fill_cert=%s",
        product_group,
        len(marking_codes),
        fill_tnved_from_cards,
        fill_certificate_from_cards,
    )

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
        "LP_INTRODUCE_GOODS response: %d %s",
        response.status_code,
        response.text[:200],
    )

    if response.status_code in (200, 201, 202):
        return {"success": True, "response": response.json()}

    raise RuntimeError(f"Ошибка {response.status_code}: {response.text[:300]}")
