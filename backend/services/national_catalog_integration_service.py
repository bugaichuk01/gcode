from __future__ import annotations
import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any
import httpx
from models import ProductCard, ProductCardType
from services.gtin_utils import normalize_gtin
from services.product_groups import (
    PRODUCT_GROUP_TO_GISMT,
    TECH_GTIN_ALLOWED_GROUPS,
    TNVED_TO_PRODUCT_GROUP,
    resolve_full_tnved,
)
from settings import get_settings
logger = logging.getLogger(__name__)


def _product_group_from_tnved(tn_ved: str) -> str:
    prefix = (tn_ved or "").strip()[:4]
    return TNVED_TO_PRODUCT_GROUP.get(prefix, "other")


def _resolve_effective_tnved(card: ProductCard) -> str | None:
    """10-значный код из карточки или короткий ТНВЭД с маппингом."""
    code = (card.tn_ved_code or "").strip()
    if code:
        return code
    tnved = (card.tn_ved or "").strip()
    if not tnved:
        return None
    return resolve_full_tnved(tnved)


def _is_tnved_code_attr_name(attr: dict[str, Any]) -> bool:
    name = (attr.get("attr_name") or "").strip().lower()
    return ("тнвэд" in name or "тн вэд" in name) and "группа" not in name


class NationalCatalogIntegrationError(RuntimeError):
    pass
@dataclass
class NationalCatalogSubmissionResult:
    remote_status: str
    feed_id: str | None
    feed_status: str | None
    feed_payload: dict[str, Any] | None
    assigned_gtin: str | None = None
def _serialize_response(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
        return payload if isinstance(payload, dict) else {"payload": payload}
    except ValueError:
        return {"raw_text": response.text, "headers": dict(response.headers)}
def _extract_base_url(send_url: str) -> str:
    marker = "/v3/"
    idx = send_url.find(marker)
    return send_url[:idx] if idx > 0 else send_url.rstrip("/")
def _active_cat_ids_from_categories(categories: list[dict[str, Any]]) -> list[int]:
    seen: set[int] = set()
    out: list[int] = []
    for c in categories:
        if not isinstance(c, dict) or c.get("category_active") is not True:
            continue
        raw = c.get("cat_id")
        cid: int | None
        if isinstance(raw, int):
            cid = raw
        elif isinstance(raw, str) and raw.isdigit():
            cid = int(raw)
        else:
            cid = None
        if cid is not None and cid not in seen:
            seen.add(cid)
            out.append(cid)
    return out
async def _fetch_required_attrs(
    client: httpx.AsyncClient,
    send_url: str,
    auth_params: dict[str, str],
    headers: dict[str, str],
    tnved: str,
    cat_id: int | None,
    active_cat_ids: list[int],
) -> tuple[list[dict[str, Any]], int | None]:
    base_url = f"{_extract_base_url(send_url)}/v3/attributes"
    attempts: list[dict[str, Any]] = []
    if cat_id:
        attempts.append({"attr_type": "m", "cat_id": cat_id})
    else:
        for cid in active_cat_ids:
            attempts.append({"attr_type": "m", "cat_id": cid})
    attempts.append({"attr_type": "m", "tnved": tnved})
    errors: list[str] = []
    for query in attempts:
        response = await client.get(base_url, params={**auth_params, **query}, headers=headers)
        if response.status_code != 200:
            errors.append(
                "Не удалось получить обязательные атрибуты НК "
                f"[status={response.status_code}, url={response.request.url}]: {_serialize_response(response)}"
            )
            continue
        payload = _serialize_response(response)
        result = payload.get("result")
        if isinstance(result, list):
            resolved: int | None = None
            cid_raw = query.get("cat_id")
            if isinstance(cid_raw, int):
                resolved = cid_raw
            elif isinstance(cid_raw, str) and cid_raw.isdigit():
                resolved = int(cid_raw)
            return result, resolved
        errors.append(
            "НК вернул неожиданный формат ответа по атрибутам "
            f"[url={response.request.url}]: {payload}"
        )
    details = " | ".join(errors) if errors else "Не удалось получить обязательные атрибуты НК"
    raise NationalCatalogIntegrationError(details)
async def _fetch_optional_attrs(
    client: httpx.AsyncClient,
    send_url: str,
    auth_params: dict[str, str],
    headers: dict[str, str],
    tnved: str,
    cat_id: int | None,
    active_cat_ids: list[int],
) -> list[dict[str, Any]]:
    base_url = f"{_extract_base_url(send_url)}/v3/attributes"
    cat_attempts: list[int | None] = []
    if cat_id:
        cat_attempts.append(cat_id)
    else:
        cat_attempts.extend(active_cat_ids)
    cat_attempts.append(None)
    for attr_type in ("o", "r"):
        for cid in cat_attempts:
            query: dict[str, Any] = {"attr_type": attr_type}
            if cid is not None:
                query["cat_id"] = cid
            else:
                query["tnved"] = tnved
            response = await client.get(base_url, params={**auth_params, **query}, headers=headers)
            if response.status_code != 200:
                continue
            payload = _serialize_response(response)
            result = payload.get("result")
            if isinstance(result, list) and result:
                return result
    return []
async def _is_tnved_active_in_nk(
    client: httpx.AsyncClient,
    base_url: str,
    auth_params: dict[str, str],
    tnved: str,
    headers: dict[str, str] | None = None,
) -> bool:
    """Проверить что ТНВЭД активен в НК."""
    full_tnved = resolve_full_tnved(tnved)
    try:
        r = await client.get(
            f"{base_url}/v3/categories",
            params={**auth_params, "tnved": full_tnved},
            headers=headers or {},
            timeout=10,
        )
        if r.status_code != 200:
            return False
        data = r.json()
        result = data.get("result") or (data if isinstance(data, list) else [])
        return len(result) > 0
    except Exception:
        return False


async def _fetch_categories_by_tnved(
    client: httpx.AsyncClient,
    send_url: str,
    auth_params: dict[str, str],
    headers: dict[str, str],
    tnved: str,
) -> list[dict[str, Any]]:
    """
    Получить категории НК по ТНВЭД коду.
    Fallback: если ТНВЭД не найден → искать по gismt_code.
    """
    base_url = f"{_extract_base_url(send_url)}/v3/categories"
    full_tnved = resolve_full_tnved(tnved)
    tnved_candidates: list[str] = []
    for candidate in (full_tnved, tnved, tnved[:4] if len(tnved) >= 4 else None):
        if candidate and candidate not in tnved_candidates:
            tnved_candidates.append(candidate)

    response: httpx.Response | None = None
    for candidate in tnved_candidates:
        response = await client.get(
            base_url,
            params={**auth_params, "tnved": candidate},
            headers=headers,
            timeout=15,
        )
        if response.status_code == 200:
            payload = _serialize_response(response)
            result = payload.get("result")
            if isinstance(result, list) and result:
                return result
            if isinstance(payload, list) and payload:
                return payload

    product_group = TNVED_TO_PRODUCT_GROUP.get(tnved[:4]) or TNVED_TO_PRODUCT_GROUP.get(tnved)
    if product_group:
        gismt_code = PRODUCT_GROUP_TO_GISMT.get(product_group)
        if gismt_code:
            all_resp = await client.get(
                base_url,
                params=auth_params,
                headers=headers,
                timeout=15,
            )
            if all_resp.status_code == 200:
                payload = _serialize_response(all_resp)
                all_cats = payload.get("result")
                if not isinstance(all_cats, list):
                    all_cats = payload if isinstance(payload, list) else []
                filtered = [
                    cat
                    for cat in all_cats
                    if isinstance(cat, dict)
                    and cat.get("category_active")
                    and gismt_code in (cat.get("gismt_codes") or [])
                ]
                if filtered:
                    logger.info(
                        "ТНВЭД %s не найден напрямую, "
                        "использованы %d категорий через gismt_code=%d (%s)",
                        tnved,
                        len(filtered),
                        gismt_code,
                        product_group,
                    )
                    return filtered

    if response is not None:
        raise NationalCatalogIntegrationError(
            "Не удалось получить категории НК по ТН ВЭД "
            f"[status={response.status_code}, url={response.request.url}]: "
            f"{_serialize_response(response)}"
        )
    raise NationalCatalogIntegrationError("Не удалось получить категории НК по ТН ВЭД")
def _validate_category_access(categories: list[dict[str, Any]], tnved: str, cat_id: int | None) -> None:
    if not categories:
        raise NationalCatalogIntegrationError(
            f"По ТН ВЭД {tnved} не найдено категорий НК для текущего участника."
        )
    active_categories = [
        c for c in categories if isinstance(c, dict) and (c.get("category_active") is True)
    ]
    if not active_categories:
        raise NationalCatalogIntegrationError(
            "Для данного ТН ВЭД в НК нет активных категорий для текущего участника. "
            "Проверьте подключенные товарные группы в Едином ЛК ГИС МТ."
        )
    if cat_id is None:
        return
    if not any(isinstance(c, dict) and c.get("cat_id") == cat_id for c in active_categories):
        available = [c.get("cat_id") for c in active_categories if isinstance(c, dict)]
        raise NationalCatalogIntegrationError(
            f"Категория {cat_id} недоступна для ТН ВЭД {tnved} у текущего участника. "
            f"Доступные категории: {available}"
        )
def _resolve_remote_status(payload: dict[str, Any]) -> str:
    result = payload.get("result")
    if isinstance(result, dict) and result.get("feed_id"):
        return "sent"
    raw_status = str(payload.get("status") or "").strip().lower()
    if raw_status in {"published", "sent"}:
        return raw_status
    return "sent"
def _extract_feed_id(payload: dict[str, Any]) -> str | None:
    result = payload.get("result")
    if isinstance(result, dict):
        feed_id = result.get("feed_id")
        if feed_id is not None:
            return str(feed_id)
    return None
def _pick_attr_value_type(attr: dict[str, Any], fallback: str = "") -> str:
    value_types = attr.get("attr_value_type")
    if isinstance(value_types, list):
        for item in value_types:
            if isinstance(item, str) and item.strip() and item.strip() != "---":
                return item.strip()
    return fallback
def _parse_attr_value(raw_value: Any) -> dict[str, Any] | list[dict[str, Any]]:
    """
    Разобрать значение атрибута.

    Форматы:
    - "1000||мл"     → {"attr_value": "1000", "attr_value_type": "мл"}
    - "красный"      → {"attr_value": "красный"}
    - "1000"         → {"attr_value": "1000"}
    - ["a", "b"]     → [{"attr_value": "a"}, {"attr_value": "b"}]
    """
    if isinstance(raw_value, list):
        return [_parse_attr_value(v) for v in raw_value]  # type: ignore[misc]

    raw_str = str(raw_value).strip()

    if "||" in raw_str:
        parts = raw_str.split("||", 1)
        value_part = parts[0].strip()
        unit_part = parts[1].strip() if len(parts) > 1 else ""
        result: dict[str, Any] = {"attr_value": value_part}
        if unit_part:
            result["attr_value_type"] = unit_part
        return result

    return {"attr_value": raw_str}


def _append_parsed_attrs(
    attrs: list[dict[str, Any]],
    attr_id: int,
    value: Any,
    *,
    attr: dict[str, Any] | None = None,
) -> None:
    parsed = _parse_attr_value(value)
    entries: list[dict[str, Any]]
    if isinstance(parsed, list):
        entries = parsed
    else:
        entries = [parsed]
    for entry in entries:
        item: dict[str, Any] = {"attr_id": attr_id, **entry}
        if "attr_value_type" not in item and attr is not None:
            value_type = _pick_attr_value_type(attr, "")
            if value_type:
                item["attr_value_type"] = value_type
        attrs.append(item)
        if attr_id == 15448:
            logger.info(
                "NK attr 15448 parsed: attr_value=%r, attr_value_type=%r",
                item.get("attr_value"),
                item.get("attr_value_type"),
            )


def _parse_nk_attr_values(raw: Any) -> dict[int, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[int, str] = {}
    for key, value in raw.items():
        if not str(key).isdigit() or value is None:
            continue
        if isinstance(value, list):
            text = "; ".join(str(v).strip() for v in value if str(v).strip())
        else:
            text = str(value).strip()
        if text:
            out[int(key)] = text
    return out
def _user_nk_attrs(card: ProductCard) -> dict[int, str]:
    if not card.extra_attrs or not isinstance(card.extra_attrs, dict):
        return {}
    return _parse_nk_attr_values(card.extra_attrs.get("nk_attrs"))
def _user_nk_optional_attrs(card: ProductCard) -> dict[int, str]:
    if not card.extra_attrs or not isinstance(card.extra_attrs, dict):
        return {}
    return _parse_nk_attr_values(card.extra_attrs.get("nk_optional_attrs"))
def _append_user_attr(
    attrs: list[dict[str, Any]],
    attr: dict[str, Any],
    attr_id: int,
    value: str,
) -> None:
    _append_parsed_attrs(attrs, attr_id, value, attr=attr)


def _extract_preset_allowed(attr: dict[str, Any]) -> set[str]:
    preset = attr.get("attr_preset") or attr.get("values") or []
    if not isinstance(preset, list):
        return set()
    allowed: set[str] = set()
    for item in preset:
        if isinstance(item, dict):
            raw = item.get("value") or item.get("attr_value") or item
        else:
            raw = item
        if raw is not None and str(raw).strip():
            allowed.add(str(raw).strip().lower())
    return allowed


def _append_attr_with_preset_check(
    attrs: list[dict[str, Any]],
    attr: dict[str, Any],
    attr_id: int,
    value: Any,
) -> bool:
    """Добавить атрибут, если значение допустимо по preset. False = пропущен."""
    if value is None or (isinstance(value, str) and not str(value).strip()):
        return False
    allowed = _extract_preset_allowed(attr)
    preset_only = attr.get("attr_preset_only") is True
    normalized = str(value).strip().lower()
    if allowed:
        if normalized not in allowed:
            logger.debug(
                "Атрибут %d (%s): значение %r не в preset (%d значений) — пропускаем",
                attr_id,
                attr.get("attr_name", ""),
                value,
                len(allowed),
            )
            return False
    elif preset_only:
        logger.debug(
            "Атрибут %d (%s): attr_preset_only без допустимых значений — пропускаем",
            attr_id,
            attr.get("attr_name", ""),
        )
        return False
    _append_parsed_attrs(attrs, attr_id, value, attr=attr)
    return True


def _build_required_attrs(card: ProductCard, required_attrs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[int]]:
    attrs: list[dict[str, Any]] = []
    unresolved: list[int] = []
    user_attrs = _user_nk_attrs(card)
    for attr in required_attrs:
        if not isinstance(attr, dict):
            continue
        raw_id = attr.get("attr_id")
        if not str(raw_id).isdigit():
            continue
        attr_id = int(raw_id)
        presets = attr.get("attr_preset") if isinstance(attr.get("attr_preset"), list) else []
        if attr_id in user_attrs:
            _append_attr_with_preset_check(attrs, attr, attr_id, user_attrs[attr_id])
            continue
        if attr_id == 2478:
            _append_attr_with_preset_check(attrs, attr, attr_id, card.name)
        elif attr_id == 2504:
            brand_value = (card.brand or "").strip() or "NO_BRAND"
            _append_attr_with_preset_check(attrs, attr, attr_id, brand_value)
        elif attr_id == 13933 or _is_tnved_code_attr_name(attr):
            preset_tnved = next((p for p in presets if isinstance(p, str) and p.isdigit() and len(p) == 10), "")
            value = (card.tn_ved_code or "").strip() or preset_tnved or resolve_full_tnved(card.tn_ved or "")
            if len(value) == 10:
                _append_attr_with_preset_check(attrs, attr, attr_id, value)
            else:
                unresolved.append(attr_id)
        elif attr_id == 2716:
            if _append_attr_with_preset_check(attrs, attr, attr_id, "50"):
                for item in reversed(attrs):
                    if item.get("attr_id") == attr_id and "attr_value_type" not in item:
                        item["attr_value_type"] = _pick_attr_value_type(attr, "мл")
                        break
        elif attr_id == 1034:
            value = "ДУХИ" if "ДУХИ" in presets else (presets[0] if presets else "")
            if value:
                _append_attr_with_preset_check(attrs, attr, attr_id, value)
            else:
                unresolved.append(attr_id)
        elif attr_id == 2710:
            preferred = "ФЛАКОН"
            value = preferred if preferred in presets else (presets[0] if presets else "")
            if value:
                _append_attr_with_preset_check(attrs, attr, attr_id, value)
            else:
                unresolved.append(attr_id)
        elif attr_id == 2713:
            preferred = "СТЕКЛО"
            value = preferred if preferred in presets else (presets[0] if presets else "")
            if value:
                _append_attr_with_preset_check(attrs, attr, attr_id, value)
            else:
                unresolved.append(attr_id)
        elif attr_id == 13836:
            value = presets[0] if presets else ""
            if value:
                _append_attr_with_preset_check(attrs, attr, attr_id, value)
            else:
                unresolved.append(attr_id)
        elif attr_id == 2630:
            _append_attr_with_preset_check(attrs, attr, attr_id, "RU")
        elif (attr.get("attr_name") or "").strip().lower() == "группа тнвэд":
            _append_attr_with_preset_check(attrs, attr, attr_id, resolve_full_tnved(card.tn_ved or ""))
        else:
            if attr.get("attr_preset_only"):
                logger.debug(
                    "Атрибут %d (%s): preset_only, значение не определено — пропускаем",
                    attr_id,
                    attr.get("attr_name", ""),
                )
                continue
            unresolved.append(attr_id)
    return attrs, sorted(set(unresolved))
def _build_set_gtins(card: ProductCard) -> list[dict[str, Any]] | None:
    """
    Сформировать set_gtins для НК как МАССИВ ОБЪЕКТОВ.
    Формат: [{"gtin": "04600000000001", "quantity": 1}, ...]
    """
    items = card.set_items
    if not items or not isinstance(items, list):
        return None
    result: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        gtin = normalize_gtin(str(item.get("gtin", "")))
        qty = item.get("quantity", 1)
        if gtin:
            result.append({"gtin": gtin, "quantity": int(qty)})
    return result if result else None


def _extract_assigned_gtin(feed_payload: dict[str, Any]) -> str | None:
    """
    Извлечь GTIN присвоенный НК (для тех.карточек).
    GTIN приходит в feed-status после обработки.
    """
    if not isinstance(feed_payload, dict):
        return None
    result = feed_payload.get("result", {})
    if not isinstance(result, dict):
        return None
    error_details = result.get("error_details", {})
    if isinstance(error_details, dict):
        for item in error_details.get("items", []):
            if not isinstance(item, dict):
                continue
            gtin = item.get("gtin")
            if gtin and str(gtin).strip():
                return normalize_gtin(str(gtin))
    gtin = result.get("gtin")
    if gtin:
        return normalize_gtin(str(gtin))
    for good in result.get("goods", []):
        if isinstance(good, dict) and good.get("gtin"):
            return normalize_gtin(str(good["gtin"]))
    for item in result.get("item", []):
        if isinstance(item, dict) and item.get("gtin"):
            return normalize_gtin(str(item["gtin"]))
    return None


def _extract_feed_errors(feed_payload: dict[str, Any] | None) -> list[str]:
    """Извлечь читаемые ошибки из feed-status."""
    if not isinstance(feed_payload, dict):
        return []
    result = feed_payload.get("result", {})
    if not isinstance(result, dict):
        return []
    error_details = result.get("error_details", {})
    if not isinstance(error_details, dict):
        return []
    messages: list[str] = []
    for item in error_details.get("items", []):
        if not isinstance(item, dict):
            continue
        for err in item.get("errors", []):
            if not isinstance(err, dict):
                continue
            code = err.get("code")
            text = err.get("text", "")
            messages.append(f"[{code}] {text}")
    common = error_details.get("commonError")
    if isinstance(common, dict):
        messages.append(f"[{common.get('code')}] {common.get('text')}")
    return messages


def _format_feed_rejection_message(errors: list[str], card: ProductCard) -> str:
    card_type = card.type.value if hasattr(card.type, "value") else str(card.type)
    is_bundle = card_type == ProductCardType.BUNDLE.value
    for err in errors:
        if "[113]" in err and is_bundle:
            return (
                "Национальный каталог отклонил набор: один или несколько GTIN из состава "
                "не найдены в базе НК. Сначала создайте и отправьте карточки вложений."
            )
    return "Национальный каталог отклонил карточку: " + "; ".join(errors)


def _build_entry_variants(
    card: ProductCard,
    cat_id: int | None,
    required_attrs: list[dict[str, Any]],
    *,
    tnved_active: bool = True,
    effective_tnved: str | None = None,
) -> list[dict[str, Any]]:
    required_built_attrs, _ = _build_required_attrs(card, required_attrs)
    built_ids = {a["attr_id"] for a in required_built_attrs}
    for attr_id, value in _user_nk_optional_attrs(card).items():
        if attr_id not in built_ids:
            _append_parsed_attrs(required_built_attrs, attr_id, value)
    brand_value = (card.brand or "").strip() or "NO_BRAND"
    base_payload: dict[str, Any] = {
        "good_name": card.name,
        "brand": brand_value,
        "good_attrs": required_built_attrs,
    }
    if tnved_active:
        base_payload["tnved"] = effective_tnved or card.tn_ved
    variants: list[dict[str, Any]] = []
    gtin = normalize_gtin(card.gtin)
    logger.warning(
        "DEBUG gtin before NK: card.gtin=%r normalized=%r len=%d",
        card.gtin,
        gtin,
        len(gtin) if gtin else 0,
    )
    card_type = card.type.value if hasattr(card.type, "value") else str(card.type)
    is_tech_card = card_type == ProductCardType.TECH_CARD.value
    is_bundle = card_type == ProductCardType.BUNDLE.value
    product_group = _product_group_from_tnved(card.tn_ved)
    if is_bundle:
        set_gtins = _build_set_gtins(card)
        if not set_gtins:
            raise NationalCatalogIntegrationError(
                "Для набора не указан состав (вложенные GTIN с количеством)."
            )
        bundle_payload: dict[str, Any] = {
            **base_payload,
            "gtin": gtin,
            "is_set": 1,
            "set_gtins": set_gtins,
            "identified_by": [
                {
                    "value": gtin,
                    "type": "gtin",
                    "multiplier": 1,
                    "level": "trade-unit",
                    "unit": "шт",
                }
            ],
        }
        if "tnved" not in bundle_payload:
            bundle_payload["tnved"] = effective_tnved or card.tn_ved
        variants.append(bundle_payload)
    elif gtin and not is_tech_card:
        gtin_payload = {
            **base_payload,
            "gtin": gtin,
            "identified_by": [
                {
                    "value": gtin,
                    "type": "gtin",
                    "multiplier": 1,
                    "level": "trade-unit",
                    "unit": "шт",
                }
            ],
        }
        if cat_id:
            variants.append({**gtin_payload, "categories": [cat_id]})
            variants.append({**gtin_payload, "categories": [{"cat_id": cat_id}]})
            variants.append({**gtin_payload, "categories": [{"id": cat_id}]})
        variants.append(gtin_payload)
    elif is_tech_card:
        if product_group not in TECH_GTIN_ALLOWED_GROUPS:
            raise NationalCatalogIntegrationError(
                f"Создание технических карточек в товарной группе "
                f"с ТНВЭД:{card.tn_ved} не допускается. "
                f"Исключите параметр is_tech_gtin или выберите тип «Единица товара»."
            )
        tech_payload = {**base_payload, "is_tech_gtin": 1}
        if cat_id:
            variants.append({**tech_payload, "categories": [cat_id]})
            variants.append({**tech_payload, "categories": [{"cat_id": cat_id}]})
            variants.append({**tech_payload, "categories": [{"id": cat_id}]})
        variants.append(tech_payload)
    else:
        raise NationalCatalogIntegrationError(
            "Для типа «Единица товара», «Комплект» или «Набор» необходимо указать GTIN."
        )
    if not tnved_active and cat_id:
        for variant in variants:
            if variant.get("is_set") or variant.get("is_kit"):
                continue
            if "categories" not in variant:
                variant["categories"] = [{"id": cat_id}]
    return variants
def _build_request_bodies(entry: dict[str, Any]) -> list[Any]:
    return [
        entry,
        [entry],
        {"entries": [entry]},
    ]
async def fetch_product_from_nk(
    gtin: str | None,
    good_id: str | None,
    settings_send_url: str,
    auth_params: dict[str, str],
    headers: dict[str, str],
    timeout_seconds: float,
) -> dict[str, Any] | None:
    """
    Получить актуальные данные карточки из НК (feed-product / product).
    Используется кнопкой «Нашли ошибку» для синхронизации.
    """
    base_url = _extract_base_url(settings_send_url)
    params = dict(auth_params)
    if gtin:
        params["gtin"] = gtin
    elif good_id:
        params["good_id"] = good_id
    else:
        return None

    for endpoint in ("/v3/product", "/v3/feed-product", "/v3/internal-product"):
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds, verify=False) as client:
                r = await client.get(f"{base_url}{endpoint}", params=params, headers=headers)
                if r.status_code == 200:
                    data = r.json()
                    result = data.get("result")
                    if result:
                        return result if isinstance(result, dict) else {"items": result}
        except Exception:
            continue
    return None


async def fetch_feed_status(
    *,
    feed_id: str,
    settings_send_url: str,
    auth_params: dict[str, str],
    headers: dict[str, str],
    supplier_key: str | None,
    timeout_seconds: float,
) -> tuple[str | None, dict[str, Any] | None]:
    params: dict[str, Any] = {**auth_params, "feed_id": feed_id, "verbose": "true"}
    if supplier_key:
        params["supplier_key"] = supplier_key
    status_url = f"{_extract_base_url(settings_send_url)}/v3/feed-status"
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.get(status_url, params=params, headers=headers)
    if response.status_code != 200:
        return None, _serialize_response(response)
    payload = _serialize_response(response)
    result = payload.get("result")
    if isinstance(result, dict):
        raw_status = result.get("status")
        return str(raw_status) if raw_status is not None else None, payload
    return None, payload
async def send_product_card(card: ProductCard, cat_id: int | None = None) -> NationalCatalogSubmissionResult:
    settings = get_settings()
    if not settings.national_catalog_send_url:
        raise NationalCatalogIntegrationError(
            "Не настроен URL интеграции Национального каталога (NATIONAL_CATALOG_SEND_URL)"
        )
    params: dict[str, str] = {}
    if settings.national_catalog_api_key:
        params["apikey"] = settings.national_catalog_api_key
    headers: dict[str, str] = {"Content-Type": "application/json; charset=utf-8"}
    if not params and settings.national_catalog_auth_token:
        headers["Authorization"] = f"Bearer {settings.national_catalog_auth_token}"
    if not params and "Authorization" not in headers:
        raise NationalCatalogIntegrationError(
            "Не задана авторизация НК: укажите NATIONAL_CATALOG_API_KEY или NATIONAL_CATALOG_AUTH_TOKEN"
        )
    feed_params = dict(params)
    if settings.national_catalog_supplier_key:
        feed_params["supplier_key"] = settings.national_catalog_supplier_key
    last_error: Exception | None = None
    response: httpx.Response | None = None
    async with httpx.AsyncClient(timeout=settings.national_catalog_timeout_seconds) as client:
        effective_tnved = _resolve_effective_tnved(card)
        categories = await _fetch_categories_by_tnved(
            client=client,
            send_url=settings.national_catalog_send_url,
            auth_params=params,
            headers=headers,
            tnved=effective_tnved or card.tn_ved,
        )
        _validate_category_access(categories, card.tn_ved, cat_id)
        active_cat_ids = _active_cat_ids_from_categories(
            [c for c in categories if isinstance(c, dict)]
        )
        required_attrs, attrs_resolved_cat_id = await _fetch_required_attrs(
            client=client,
            send_url=settings.national_catalog_send_url,
            auth_params=params,
            headers=headers,
            tnved=effective_tnved or card.tn_ved,
            cat_id=cat_id,
            active_cat_ids=active_cat_ids,
        )
        effective_cat_id = cat_id if cat_id is not None else attrs_resolved_cat_id
        _, unresolved_required = _build_required_attrs(card, required_attrs)
        if unresolved_required:
            raise NationalCatalogIntegrationError(
                "Не хватает обязательных атрибутов НК для этой категории/ТН ВЭД. "
                f"Требуются attr_id={unresolved_required}. "
                "Добавьте заполнение этих атрибутов в интеграцию."
            )
        base_url = _extract_base_url(settings.national_catalog_send_url)
        if card.tn_ved_code and card.tn_ved_code.strip():
            logger.info(
                "Используется 10-значный ТНВЭД из карточки: %s (группа %s)",
                card.tn_ved_code.strip(),
                card.tn_ved,
            )
        elif card.tn_ved and effective_tnved and effective_tnved != card.tn_ved:
            logger.info(
                "ТНВЭД %s → полный код %s",
                card.tn_ved,
                effective_tnved,
            )
        tnved_active = await _is_tnved_active_in_nk(
            client, base_url, params, effective_tnved or card.tn_ved, headers=headers
        )
        if tnved_active and card.tn_ved and effective_tnved and effective_tnved != card.tn_ved and not (card.tn_ved_code or "").strip():
            logger.info(
                "ТНВЭД %s → полный код %s, активен в НК",
                card.tn_ved,
                effective_tnved,
            )
        if not tnved_active:
            logger.info(
                "ТНВЭД %s неактивен в НК — tnved не будет передан в payload, "
                "категория определяется через cat_id=%s",
                effective_tnved or card.tn_ved,
                effective_cat_id,
            )
        entry_variants = _build_entry_variants(
            card,
            effective_cat_id,
            required_attrs,
            tnved_active=tnved_active,
            effective_tnved=effective_tnved,
        )
        for attempt in range(1, settings.national_catalog_retry_attempts + 1):
            total_variants = len(entry_variants) * 3
            variant_idx = 0
            for entry in entry_variants:
                for request_body in _build_request_bodies(entry):
                    variant_idx += 1
                    try:
                        logger.info(
                            "send_product_card: POST в НК — url=%s, params=%s, body=%s",
                            settings.national_catalog_send_url,
                            json.dumps(feed_params, ensure_ascii=False, default=str),
                            json.dumps(request_body, ensure_ascii=False, default=str),
                        )
                        response = await client.post(
                            settings.national_catalog_send_url,
                            params=feed_params,
                            json=request_body,
                            headers=headers,
                        )
                        logger.info(
                            "send_product_card: ответ НК — status=%s, body=%s",
                            response.status_code,
                            json.dumps(_serialize_response(response), ensure_ascii=False, default=str),
                        )
                        if response.status_code in {200, 201, 202}:
                            break
                        response_payload = _serialize_response(response)
                        last_error = NationalCatalogIntegrationError(
                            "Национальный каталог отклонил карточку "
                            f"[attempt={attempt}, variant={variant_idx}/{total_variants}, "
                            f"status={response.status_code}, url={response.request.url}]: "
                            f"{response_payload}; sent_payload={request_body}"
                        )
                    except httpx.HTTPError as exc:
                        last_error = NationalCatalogIntegrationError(
                            "Ошибка запроса в Национальный каталог "
                            f"[attempt={attempt}, variant={variant_idx}/{total_variants}]: {exc}"
                        )
                    if response is not None and response.status_code in {200, 201, 202}:
                        break
                if response is not None and response.status_code in {200, 201, 202}:
                    break
            if response is not None and response.status_code in {200, 201, 202}:
                break
            if attempt < settings.national_catalog_retry_attempts:
                await asyncio.sleep(settings.national_catalog_retry_delay_seconds)
    if response is None or response.status_code not in {200, 201, 202}:
        raise NationalCatalogIntegrationError(str(last_error) if last_error else "Не удалось отправить карточку")
    response_payload = _serialize_response(response)
    feed_id = _extract_feed_id(response_payload)
    remote_status = _resolve_remote_status(response_payload)
    if not feed_id:
        assigned_gtin = _extract_assigned_gtin(response_payload)
        return NationalCatalogSubmissionResult(
            remote_status=remote_status,
            feed_id=None,
            feed_status=None,
            feed_payload=response_payload,
            assigned_gtin=assigned_gtin,
        )
    feed_status, feed_payload = await fetch_feed_status(
        feed_id=feed_id,
        settings_send_url=settings.national_catalog_send_url,
        auth_params=params,
        headers=headers,
        supplier_key=settings.national_catalog_supplier_key,
        timeout_seconds=settings.national_catalog_timeout_seconds,
    )
    if feed_status and feed_status.strip().lower() == "rejected":
        feed_errors = _extract_feed_errors(feed_payload)
        if feed_errors:
            raise NationalCatalogIntegrationError(
                _format_feed_rejection_message(feed_errors, card)
            )
    assigned_gtin = _extract_assigned_gtin(feed_payload) if feed_payload else None
    return NationalCatalogSubmissionResult(
        remote_status=remote_status,
        feed_id=feed_id,
        feed_status=feed_status,
        feed_payload=feed_payload,
        assigned_gtin=assigned_gtin,
    )
