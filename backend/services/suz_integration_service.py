from __future__ import annotations
import asyncio
import json
import logging
import shutil
import ssl
from typing import Any
from urllib.parse import urlencode
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from settings import Settings, get_settings
from services.product_groups import normalize_suz_product_group, resolve_suz_template_id
logger = logging.getLogger(__name__)
class SuzIntegrationError(RuntimeError):
    def __init__(self, message: str, *, suggest_transport_diagnostics: bool = False) -> None:
        super().__init__(message)
        self.suggest_transport_diagnostics = suggest_transport_diagnostics
_UOT_CREDENTIAL_HINT = (
    " Обычно это несоответствие clientToken и omsId из URL: возьмите актуальный clientToken "
    "(SUZ_CLIENT_TOKEN) из ЛК СУЗ в том же контуре, что и SUZ_API_BASE_URL. "
    "Токен должен быть выпущен для этого OMS UUID и не истечь."
)
_SUZ_MARKER_RELATED_CODES = frozenset({1090, 1140, 1160, 1170, 1370})
def _normalize_suz_client_token(token: str) -> str:
    raw = (token or "").strip()
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return raw
def resolve_suz_api_token(settings: Settings | None = None) -> str:
    s = settings or get_settings()
    raw = (s.suz_client_token or s.suz_auth_token or "").strip()
    return _normalize_suz_client_token(raw)
async def resolve_suz_api_token_async(db: AsyncSession) -> str:
    from services.token_service import get_active_token
    token = await get_active_token(db)
    if not token:
        raise SuzIntegrationError(
            "Не задан clientToken СУЗ. Обновите токен в настройках."
        )
    return _normalize_suz_client_token(token)
def build_suz_v3_ping_url(base: str, oms_id: str) -> str:
    b = (base or "").strip().rstrip("/")
    oms = (oms_id or "").strip()
    return f"{b}/api/v3/ping?{urlencode({'omsId': oms})}"
def _build_suz_auth_headers(
    token: str,
    *,
    product_group: str | None = None,
    with_json_content_type: bool = True,
    x_signature: str | None = None,
) -> dict[str, str]:
    headers: dict[str, str] = {
        "Accept": "application/json",
        "clientToken": _normalize_suz_client_token(token),
    }
    if product_group:
        headers["X-Product-Group"] = product_group
    if with_json_content_type:
        headers["Content-Type"] = "application/json"
    if x_signature:
        sig = x_signature.replace("\r", "").replace("\n", "").strip()
        if sig:
            headers["X-Signature"] = sig
    return headers
def dumps_suz_request_body(body: dict[str, Any]) -> str:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))
def _iter_suz_flat_errors(parsed: dict[str, Any]) -> list[str]:
    acc: list[str] = []
    glob = parsed.get("globalErrors")
    if isinstance(glob, list):
        for item in glob:
            if isinstance(item, dict):
                txt = (
                    item.get("error")
                    or item.get("message")
                    or item.get("errorMessage")
                    or item.get("errorDescription")
                    or ""
                ).strip()
                code = item.get("errorCode")
                if txt:
                    acc.append(f"{txt} (код {code})" if code is not None else txt)
                elif code is not None:
                    acc.append(f"ошибка {code}")
            elif isinstance(item, str) and item.strip():
                acc.append(item.strip())
    errs = parsed.get("errors") or parsed.get("validationErrors") or parsed.get("fieldErrors")
    if isinstance(errs, list):
        for item in errs:
            if isinstance(item, dict):
                txt = (
                    item.get("fieldError")
                    or item.get("message")
                    or item.get("error")
                    or item.get("detail")
                    or item.get("errorMessage")
                    or ""
                ).strip()
                if txt:
                    acc.append(txt)
            elif isinstance(item, str) and item.strip():
                acc.append(item.strip())
    raw_msg = parsed.get("message") or parsed.get("errorDescription") or parsed.get("description")
    if isinstance(raw_msg, str) and raw_msg.strip():
        acc.append(raw_msg.strip())
    return acc
def _expects_uot_credential_notice(parsed: dict[str, Any]) -> bool:
    ec_raw = parsed.get("errorCode")
    try:
        ec_int = int(ec_raw) if ec_raw is not None and str(ec_raw).strip().isdigit() else None
    except (TypeError, ValueError):
        ec_int = None
    if ec_int in _SUZ_MARKER_RELATED_CODES or str(ec_raw) in {str(c) for c in _SUZ_MARKER_RELATED_CODES}:
        return True
    glo = parsed.get("globalErrors")
    if isinstance(glo, list):
        for item in glo:
            if isinstance(item, dict):
                iec = item.get("errorCode")
                try:
                    iec_int = int(iec) if iec is not None and str(iec).strip().isdigit() else None
                except (TypeError, ValueError):
                    iec_int = None
                if iec_int in _SUZ_MARKER_RELATED_CODES or str(iec) in {str(c) for c in _SUZ_MARKER_RELATED_CODES}:
                    return True
    msgs = _iter_suz_flat_errors(parsed)
    for m in msgs:
        low = m.lower()
        for code in _SUZ_MARKER_RELATED_CODES:
            if str(code) in m:
                return True
        if "маркер" in low and "безопасности" in low:
            return True
        if ("учётных данных" in low or "учетных данных" in low) and "уот" in low:
            return True
    return False
def _format_suz_http_error_detail(*, http_code: int, url: str | None, body_text: str) -> str:
    tail = body_text.strip()[:2000]
    parsed: Any = None
    try:
        parsed = json.loads(body_text)
    except (json.JSONDecodeError, ValueError):
        parsed = None
    if isinstance(parsed, dict):
        lines = _iter_suz_flat_errors(parsed)
        if lines:
            head = "; ".join(lines)
            msg = f"СУЗ отклонила запрос ({http_code}). {head}"
            if _expects_uot_credential_notice(parsed):
                msg += _UOT_CREDENTIAL_HINT
            if url:
                msg += f" Запрос: {url}"
            return msg
    snippet = tail or "(пустое тело ответа)"
    base = (
        f"СУЗ отклонила запрос ({http_code}): {snippet}"
        if url is None
        else f"СУЗ вернула HTTP {http_code} для {url}: {snippet}"
    )
    low = snippet.lower()
    if (
        "учётных данных" in low
        or "учетных данных" in low
        or ("маркер" in low and "безопасности" in low)
    ):
        base += _UOT_CREDENTIAL_HINT
    return base
def _apply_legacy_tls_hacks(ctx: ssl.SSLContext) -> None:
    if hasattr(ssl, "OP_LEGACY_SERVER_CONNECT"):
        try:
            ctx.options |= ssl.OP_LEGACY_SERVER_CONNECT
        except ssl.SSLError:
            pass
def suz_sandbox_ssl_context() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    _apply_legacy_tls_hacks(ctx)
    return ctx
def _ctx_verified(cipher: str | None, tls12_only: bool) -> ssl.SSLContext | None:
    try:
        ctx = ssl.create_default_context()
        if tls12_only:
            ctx.minimum_version = ssl.TLSVersion.TLSv1_2
            ctx.maximum_version = ssl.TLSVersion.TLSv1_2
        if cipher:
            ctx.set_ciphers(cipher)
        return ctx
    except ssl.SSLError:
        return None
def _ctx_unverified(cipher: str | None, tls12_only: bool) -> ssl.SSLContext | None:
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        _apply_legacy_tls_hacks(ctx)
        if tls12_only:
            ctx.minimum_version = ssl.TLSVersion.TLSv1_2
            ctx.maximum_version = ssl.TLSVersion.TLSv1_2
        if cipher:
            ctx.set_ciphers(cipher)
        return ctx
    except ssl.SSLError:
        return None
def _ctx_insecure_versioned(
    tls_min: ssl.TLSVersion | None,
    tls_max: ssl.TLSVersion | None,
    cipher: str | None,
) -> ssl.SSLContext | None:
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        _apply_legacy_tls_hacks(ctx)
        if tls_min is not None:
            ctx.minimum_version = tls_min
        if tls_max is not None:
            ctx.maximum_version = tls_max
        if cipher:
            ctx.set_ciphers(cipher)
        return ctx
    except ssl.SSLError:
        return None
def _suz_verify_candidates(settings: Settings) -> list[bool | ssl.SSLContext]:
    ciphers: list[str | None] = [
        None,
        "DEFAULT:@SECLEVEL=0",
        "DEFAULT:@SECLEVEL=1",
        "ALL:@SECLEVEL=0",
    ]
    tls12_modes = (False, True)
    acc: list[bool | ssl.SSLContext] = []
    if settings.suz_tls_verify:
        acc.append(True)
        if settings.suz_ssl_compat:
            for tls12 in tls12_modes:
                for ci in ciphers:
                    if ci is None and not tls12:
                        continue
                    ctx = _ctx_verified(ci, tls12)
                    if ctx is not None:
                        acc.append(ctx)
    else:
        acc.append(False)
        for tls12 in tls12_modes:
            for ci in ciphers:
                ctx = _ctx_unverified(ci, tls12)
                if ctx is not None:
                    acc.append(ctx)
    return acc if acc else [True]
def _suz_httpx_verify_options(settings: Settings) -> list[bool | ssl.SSLContext]:
    if not settings.suz_tls_verify:
        opts: list[bool | ssl.SSLContext] = [suz_sandbox_ssl_context(), False]
        for tls12 in (False, True):
            for ci in ("DEFAULT:@SECLEVEL=0", "ALL:@SECLEVEL=0", None):
                ctx = _ctx_unverified(ci, tls12)
                if ctx is not None:
                    opts.append(ctx)
        rngs: tuple[tuple[ssl.TLSVersion | None, ssl.TLSVersion | None], ...] = (
            (ssl.TLSVersion.TLSv1_2, ssl.TLSVersion.TLSv1_3),
            (ssl.TLSVersion.TLSv1_3, ssl.TLSVersion.TLSv1_3),
            (ssl.TLSVersion.TLSv1_2, ssl.TLSVersion.TLSv1_2),
        )
        for mn, mx in rngs:
            for ci in ("DEFAULT:@SECLEVEL=0", None):
                x = _ctx_insecure_versioned(mn, mx, ci)
                if x is not None:
                    opts.append(x)
        return opts
    return _suz_verify_candidates(settings)
def _curl_tls_flag_variants() -> tuple[tuple[str, ...], ...]:
    return (
        (),
        ("--tlsv1.3",),
        ("--tlsv1.2", "--tls-max", "1.2"),
    )
async def _curl_get_json(
    full_url: str,
    token: str,
    timeout_sec: int,
    tls_extra: tuple[str, ...] = (),
) -> tuple[int, dict[str, Any] | list[Any] | None, str]:
    if not shutil.which("curl"):
        raise OSError("curl not found")
    args = [
        "curl",
        "-sS",
        "--http1.1",
        *tls_extra,
        "-k",
        "-H",
        f"clientToken: {_normalize_suz_client_token(token)}",
        "-H",
        "Accept: application/json",
        "-H",
        "Content-Type: application/json",
        "-w",
        "\\n%{http_code}",
        "--max-time",
        str(timeout_sec),
        full_url,
    ]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    raw_out, raw_err = await proc.communicate()
    err_t = raw_err.decode(errors="replace").strip()
    out_t = raw_out.decode(errors="replace")
    if proc.returncode != 0:
        raise OSError(err_t or out_t[:500] or f"curl exit {proc.returncode}")
    if "\n" not in out_t:
        raise OSError(out_t[:800])
    body, _sep, code_s = out_t.rpartition("\n")
    try:
        code = int(code_s.strip())
    except ValueError as exc:
        raise OSError(out_t[:800]) from exc
    try:
        parsed: dict[str, Any] | list[Any] | None = json.loads(body) if body.strip() else None
    except json.JSONDecodeError:
        parsed = None
    return code, parsed, body[:2000]
async def _curl_post_json(
    full_url: str,
    token: str,
    json_body: dict[str, Any] | None = None,
    timeout_sec: int = 30,
    tls_extra: tuple[str, ...] = (),
    *,
    body_bytes: bytes | None = None,
    x_signature: str | None = None,
) -> tuple[int, dict[str, Any] | list[Any] | None, str]:
    if not shutil.which("curl"):
        raise OSError("curl not found")
    if body_bytes is None:
        body_bytes = dumps_suz_request_body(json_body or {}).encode("utf-8")
    args = [
        "curl",
        "-sS",
        "--http1.1",
        *tls_extra,
        "-k",
        "-X",
        "POST",
        "-H",
        f"clientToken: {_normalize_suz_client_token(token)}",
        "-H",
        "Accept: application/json",
        "-H",
        "Content-Type: application/json; charset=utf-8",
    ]
    if x_signature:
        sig = x_signature.replace("\r", "").replace("\n", "").strip()
        if sig:
            args.extend(["-H", f"X-Signature: {sig}"])
    args.extend(
        [
            "--data-binary",
            "@-",
            "-w",
            "\\n%{http_code}",
            "--max-time",
            str(timeout_sec),
            full_url,
        ]
    )
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    raw_out, raw_err = await proc.communicate(input=body_bytes)
    err_t = raw_err.decode(errors="replace").strip()
    out_t = raw_out.decode(errors="replace")
    if proc.returncode != 0:
        raise OSError(err_t or out_t[:500] or f"curl exit {proc.returncode}")
    if "\n" not in out_t:
        raise OSError(out_t[:800])
    body, _sep, code_s = out_t.rpartition("\n")
    try:
        code = int(code_s.strip())
    except ValueError as exc:
        raise OSError(out_t[:800]) from exc
    try:
        parsed_post: dict[str, Any] | list[Any] | None = json.loads(body) if body.strip() else None
    except json.JSONDecodeError:
        parsed_post = None
    return code, parsed_post, body[:2000]
def _first_str(d: dict[str, Any], *keys: str) -> str | None:
    for k in keys:
        v = d.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return None
def _first_int(d: dict[str, Any], *keys: str) -> int | None:
    for k in keys:
        v = d.get(k)
        if v is None:
            continue
        if isinstance(v, bool):
            continue
        if isinstance(v, int):
            return v
        if isinstance(v, float) and v == int(v):
            return int(v)
        s = str(v).strip()
        if s.isdigit():
            return int(s)
    return None
def _normalize_gtin(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = "".join(c for c in str(raw) if c.isdigit())
    if not digits:
        return None
    if len(digits) > 14:
        digits = digits[-14:]
    return digits.zfill(14) if len(digits) <= 14 else digits[:14]
def _as_order_dicts(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("orderInfos", "orders", "result", "data", "items", "content"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return [x for x in inner if isinstance(x, dict)]
        if payload.keys() >= {"orderId", "gtin"} or payload.keys() >= {"order_id", "gtin"}:
            return [payload]
    return []
def _extract_marking_codes_from_suz_order_raw(raw: dict[str, Any]) -> list[str]:
    acc: list[str] = []
    for key in (
        "cises",
        "cisList",
        "cisCodes",
        "codes",
        "packages",
        "markingCodes",
        "identificationCodes",
        "kmList",
        "serials",
    ):
        v = raw.get(key)
        if v is None:
            continue
        if isinstance(v, str) and v.strip():
            return [v.strip()]
        if isinstance(v, list):
            for item in v:
                if isinstance(item, str) and item.strip():
                    acc.append(item.strip())
                elif isinstance(item, dict):
                    c = _first_str(
                        item,
                        "cis",
                        "cisId",
                        "code",
                        "value",
                        "identificationCode",
                        "cisValue",
                        "markingCode",
                        "requestedCis",
                    )
                    if c:
                        acc.append(c.strip())
            if acc:
                break
    return list(dict.fromkeys(acc))
def _determine_status(order_data: dict[str, Any]) -> str:
    order_status = (
        _first_str(order_data, "orderStatus", "order_status", "status", "state", "orderState") or ""
    ).upper()
    buffers_raw = order_data.get("buffers")
    buffers: list[dict[str, Any]] = (
        [b for b in buffers_raw if isinstance(b, dict)] if isinstance(buffers_raw, list) else []
    )
    if order_status in ("CREATED", "PENDING", "APPROVED"):
        return "pending"
    if order_status == "DECLINED":
        return "rejected"
    if order_status == "CLOSED":
        return "closed"
    if order_status == "READY":
        if not buffers:
            return "pending"
        buffer_status = (
            _first_str(buffers[0], "bufferStatus", "buffer_status", "status", "state") or ""
        ).upper()
        if buffer_status == "ACTIVE":
            return "available"
        if buffer_status == "PENDING":
            return "pending"
        if buffer_status == "EXHAUSTED":
            return "exhausted"
        if buffer_status == "REJECTED":
            return "rejected"
        if buffer_status == "CLOSED":
            return "closed"
        return "pending"
    return "pending"
def _parse_remote_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    order_id = _first_str(raw, "orderId", "order_id", "id", "orderID", "emissionOrderId")
    if not order_id:
        return None
    gtin = _normalize_gtin(_first_str(raw, "gtin", "GTIN", "productCode", "product_code", "barcode"))
    if not gtin and isinstance(raw.get("buffers"), list):
        for buf in raw["buffers"]:
            if isinstance(buf, dict):
                gtin = _normalize_gtin(_first_str(buf, "gtin", "GTIN", "productCode", "product_code"))
                if gtin:
                    break
    qty = _first_int(raw, "quantity", "qty", "orderQuantity", "order_quantity", "requestedQuantity")
    if qty is None and isinstance(raw.get("buffers"), list):
        for buf in raw["buffers"]:
            if isinstance(buf, dict):
                qty = _first_int(
                    buf,
                    "totalCodes",
                    "total_codes",
                    "availableCodes",
                    "available_codes",
                    "quantity",
                    "qty",
                )
                if qty is not None:
                    break
    status_raw = _first_str(raw, "orderStatus", "order_status", "status", "state", "orderState")
    emission_status = _determine_status(raw)
    marking_codes = _extract_marking_codes_from_suz_order_raw(raw)
    return {
        "order_id": order_id,
        "gtin": gtin,
        "quantity": max(1, qty or 1),
        "status_raw": status_raw or "",
        "emission_status": emission_status,
        "marking_codes": marking_codes,
    }
def map_suz_status_to_emission(status_raw: str | dict[str, Any]) -> str:
    if isinstance(status_raw, dict):
        return _determine_status(status_raw)
    return _determine_status({"orderStatus": status_raw})
def _rows_from_payload(payload: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw in _as_order_dicts(payload):
        parsed = _parse_remote_row(raw)
        if parsed:
            rows.append(parsed)
    return rows
async def _suz_dispatch_httpx(
    *,
    method: str,
    url: str,
    headers: dict[str, str],
    params: dict[str, str] | None,
    json_body: dict[str, Any] | None = None,
    content: bytes | None = None,
) -> tuple[httpx.Response | None, BaseException | None]:
    settings = get_settings()
    opts = _suz_httpx_verify_options(settings)
    last_err: BaseException | None = None
    m = method.upper()
    for idx, verify in enumerate(opts):
        try:
            async with httpx.AsyncClient(
                timeout=settings.suz_timeout_seconds,
                verify=verify,
                trust_env=False,
            ) as client:
                if m == "GET":
                    response = await client.get(url, headers=headers, params=params)
                elif m == "PUT":
                    response = await client.put(url, headers=headers, params=params, json=json_body)
                elif m == "DELETE":
                    response = await client.delete(url, headers=headers, params=params)
                elif content is not None:
                    response = await client.post(url, headers=headers, params=params, content=content)
                else:
                    response = await client.post(url, headers=headers, params=params, json=json_body)
            logger.debug(
                "SUZ httpx %s ok attempt %s verify_type=%s",
                method,
                idx + 1,
                type(verify).__name__,
            )
            return response, None
        except httpx.RequestError as exc:
            last_err = exc
            logger.debug("SUZ httpx %s fail attempt %s: %s", method, idx + 1, exc)
            continue
    return None, last_err
_PERFUMERY_GROUP_ALIASES = frozenset({"perfum", "perfumery", "perfume"})
_RELEASE_METHOD_LOCAL = ("PRODUCED_IN_RF", "IMPORT", "REMARK", "REMAINS", "COMMISSION")
_RELEASE_METHOD_GLOBAL = ("IMPORT", "REMARK", "REMAINS", "COMMISSION")
def resolve_suz_api_product_group(product_group: str | None) -> str:
    g = normalize_suz_product_group(product_group)
    if not g:
        raise ValueError(
            "Не задана товарная группа. Укажите product_group или настройте SUZ_PRODUCT_GROUP в .env"
        )
    if g in _PERFUMERY_GROUP_ALIASES:
        return "perfumery"
    return g
def release_method_options_for_gtin(gtin14: str) -> tuple[str, list[str]]:
    if gtin14.startswith("029"):
        return "REMARK", ["REMARK"]
    if gtin14.startswith("046") or gtin14.startswith("004"):
        return "REMARK", list(_RELEASE_METHOD_LOCAL)
    return "IMPORT", list(_RELEASE_METHOD_GLOBAL)
_FORM_RELEASE_METHOD_ALIASES: dict[str, str] = {
    "PRODUCTION": "PRODUCED_IN_RF",
    "REAPPLY": "REMAINS",
}


def _normalize_release_method_type(raw: str | None, *, default: str, allowed: list[str]) -> str:
    rmt = (raw or "").strip().upper()
    rmt = _FORM_RELEASE_METHOD_ALIASES.get(rmt, rmt)
    if rmt not in allowed:
        return default
    return rmt


def build_suz_create_order_body(
    settings: Settings,
    *,
    product_group: str,
    gtin14: str,
    quantity: int,
    production_order_id: str | None = None,
    release_method_type: str | None = None,
    producer: str | None = None,
) -> dict[str, Any]:
    _ = production_order_id
    api_group = resolve_suz_api_product_group(product_group)
    default_rmt, allowed = release_method_options_for_gtin(gtin14)
    fallback = (
        _normalize_release_method_type(
            settings.suz_order_release_method_type,
            default=default_rmt,
            allowed=allowed,
        )
        if settings.suz_order_release_method_type
        else default_rmt
    )
    rmt = _normalize_release_method_type(
        release_method_type or fallback,
        default=default_rmt,
        allowed=allowed,
    )
    serial_number_type = (settings.suz_serial_number_type or "OPERATOR").strip() or "OPERATOR"
    template_id = resolve_suz_template_id(
        api_group,
        fallback=int(settings.suz_marking_template_id),
    )
    logger.info(
        "SUZ order: product_group=%s → templateId=%d",
        api_group,
        template_id,
    )
    line: dict[str, Any] = {
        "gtin": gtin14,
        "quantity": int(quantity),
        "serialNumberType": serial_number_type,
        "templateId": template_id,
        "cisType": settings.suz_product_cis_type,
    }
    contact_person = (settings.suz_order_contact_person or "").strip()
    create_method_type = (settings.suz_order_create_method_type or "SELF_MADE").strip() or "SELF_MADE"
    attributes: dict[str, Any] = {
        "releaseMethodType": rmt,
        "createMethodType": create_method_type,
    }
    if contact_person:
        attributes["contactPerson"] = contact_person
    prod_inn = (producer or "").strip()
    if rmt == "REMARK" and prod_inn:
        line["attributes"] = {"producer": prod_inn}
    elif prod_inn:
        attributes["producer"] = prod_inn
    return {
        "productGroup": api_group,
        "products": [line],
        "attributes": attributes,
    }
def suz_order_create_path(base: str) -> str:
    return f"{(base or '').strip().rstrip('/')}/api/v3/order"
def suz_orders_list_path(base: str) -> str:
    return f"{(base or '').strip().rstrip('/')}/api/v3/order/list"
def _resolve_suz_connection_with_token(
    oms_id: str | None = None,
    token_override: str | None = None,
) -> tuple[str, str, str]:
    settings = get_settings()
    base = (settings.suz_api_base_url or "").strip().rstrip("/")
    if token_override:
        token = _normalize_suz_client_token(token_override)
    else:
        token = resolve_suz_api_token(settings)
    oms_resolved = (oms_id or settings.suz_oms_id or "").strip()
    if not base:
        raise SuzIntegrationError(
            "Не задан SUZ_API_BASE_URL (базовый URL СУЗ / шлюза OMS из инструкции к вашему контуру)."
        )
    if not token:
        raise SuzIntegrationError(
            "Не задан clientToken СУЗ. Обновите токен в настройках."
        )
    if not oms_resolved:
        raise SuzIntegrationError(
            "Не задан omsId: укажите SUZ_OMS_ID или добавьте устройство с OMS ID в настройках."
        )
    return base, token, oms_resolved
async def _resolve_suz_connection_async(
    oms_id: str | None = None,
    db: AsyncSession | None = None,
    token_override: str | None = None,
) -> tuple[str, str, str]:
    if token_override:
        return _resolve_suz_connection_with_token(oms_id, token_override)
    if db is not None:
        from services.token_service import get_active_token
        token_raw = await get_active_token(db)
        return _resolve_suz_connection_with_token(oms_id, token_raw)
    return _resolve_suz_connection_with_token(oms_id, None)
async def fetch_suz_orders_raw(
    *,
    oms_id: str | None = None,
    token_override: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    settings = get_settings()
    base, token, oms_resolved = _resolve_suz_connection_with_token(oms_id, token_override)
    path = suz_orders_list_path(base)
    params = {"omsId": oms_resolved}
    full_url = f"{path}?{urlencode(params)}"
    headers = _build_suz_auth_headers(token)
    logger.debug("fetch_suz_orders_raw: GET %s params=%s", path, params)
    verify_opts = _suz_httpx_verify_options(settings)
    response, last_err = await _suz_dispatch_httpx(
        method="GET",
        url=path,
        headers=headers,
        params=params,
    )
    if response is not None:
        logger.debug(
            "fetch_suz_orders_raw: статус=%s тело=%s",
            response.status_code,
            response.text[:500],
        )
    elif last_err is not None:
        logger.debug("fetch_suz_orders_raw: httpx не ответил, last_err=%s", last_err)
    if response is None and settings.suz_curl_fallback:
        tmax = max(1, int(settings.suz_timeout_seconds))
        for curl_tls in _curl_tls_flag_variants():
            try:
                code, payload, raw_pref = await _curl_get_json(full_url, token, tmax, tls_extra=curl_tls)
                if code != 200:
                    curl_body = ""
                    if isinstance(payload, dict) or isinstance(payload, list):
                        curl_body = json.dumps(payload, ensure_ascii=False)
                    else:
                        curl_body = raw_pref
                    raise SuzIntegrationError(
                        _format_suz_http_error_detail(http_code=code, url=full_url, body_text=curl_body)
                    )
                if payload is None:
                    raise SuzIntegrationError(f"СУЗ (curl) не-JSON: {raw_pref[:800]}")
                rows = _rows_from_payload(payload)
                return rows, full_url
            except OSError as exc:
                last_err = exc
                label = "default TLS" if not curl_tls else " ".join(curl_tls)
                logger.warning("SUZ curl fallback (%s) failed: %s", label, exc)
    if response is None:
        msg = (
            f"Не удалось установить TLS с СУЗ после {len(verify_opts)} вариантов httpx"
            + (" и curl." if settings.suz_curl_fallback else ".")
            + f" Последняя ошибка: {last_err}. "
            "Убедитесь, что SUZ_SSL_COMPAT=true в .env. "
            "Если контур требует ГОСТ-TLS (КриптоПро), запросы из стандартного контейнера могут быть невозможны — используйте шлюз на стороне организации или машину с сертифицированным СКЗИ."
        )
        raise SuzIntegrationError(msg, suggest_transport_diagnostics=True) from last_err
    if response.status_code != 200:
        raise SuzIntegrationError(
            _format_suz_http_error_detail(
                http_code=response.status_code,
                url=str(response.request.url),
                body_text=response.text,
            )
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise SuzIntegrationError(f"СУЗ вернула не-JSON: {response.text[:500]}") from exc
    return _rows_from_payload(payload), str(response.request.url)
async def submit_suz_emission_order(
    *,
    oms_id: str | None,
    body_string: str,
    x_signature: str,
    json_body: dict[str, Any] | None = None,
    token_override: str | None = None,
) -> tuple[str, dict[str, Any]]:
    settings = get_settings()
    base, token, oms_resolved = _resolve_suz_connection_with_token(oms_id, token_override)
    sig = (x_signature or "").replace("\r", "").replace("\n", "").strip()
    if not sig:
        raise SuzIntegrationError(
            "Для создания заказа в СУЗ v3 нужна откреплённая подпись тела запроса (заголовок X-Signature). "
            "Подпишите JSON в браузере через КриптоПро ЭЦП Browser plug-in."
        )
    path = suz_order_create_path(base)
    params = {"omsId": oms_resolved}
    raw_body = (body_string or "").strip()
    if not raw_body:
        if json_body is None:
            raise SuzIntegrationError("Пустое тело запроса к СУЗ.")
        raw_body = dumps_suz_request_body(json_body)
    body_bytes = raw_body.encode("utf-8")
    try:
        order_body = json.loads(raw_body)
        logger.debug("SUZ order body: %s", json.dumps(order_body, ensure_ascii=False))
    except json.JSONDecodeError:
        logger.debug("SUZ order body (raw, not JSON): %s", raw_body[:4000])
    headers = _build_suz_auth_headers(token, x_signature=sig)
    verify_opts = _suz_httpx_verify_options(settings)
    response, last_err = await _suz_dispatch_httpx(
        method="POST",
        url=path,
        headers=headers,
        params=params,
        content=body_bytes,
    )
    full_url_post = f"{path}?{urlencode(params)}"
    if response is None and settings.suz_curl_fallback:
        tmax = max(1, int(settings.suz_timeout_seconds))
        for curl_tls in _curl_tls_flag_variants():
            try:
                code, parsed, raw_pref = await _curl_post_json(
                    full_url_post,
                    token,
                    timeout_sec=tmax,
                    tls_extra=curl_tls,
                    body_bytes=body_bytes,
                    x_signature=sig,
                )
                if code not in (200, 201):
                    curl_body = ""
                    if isinstance(parsed, dict) or isinstance(parsed, list):
                        curl_body = json.dumps(parsed, ensure_ascii=False)
                    else:
                        curl_body = raw_pref
                    raise SuzIntegrationError(
                        _format_suz_http_error_detail(http_code=code, url=full_url_post, body_text=curl_body)
                    )
                if not isinstance(parsed, dict):
                    raise SuzIntegrationError(f"СУЗ (curl POST) не-JSON объект: {raw_pref[:800]}")
                remote_oid_c = _first_str(parsed, "orderId", "order_id", "orderID")
                if not remote_oid_c:
                    raise SuzIntegrationError(f"Ответ СУЗ (curl) без orderId: {raw_pref[:2000]}")
                return remote_oid_c, parsed
            except OSError as exc:
                last_err = exc
                lbl = "default TLS" if not curl_tls else " ".join(curl_tls)
                logger.warning("SUZ curl POST (%s) failed: %s", lbl, exc)
    if response is None:
        msg = (
            f"Не удалось установить TLS при POST в СУЗ после {len(verify_opts)} вариантов httpx"
            + (" и curl POST." if settings.suz_curl_fallback else ".")
            + f" Последняя ошибка: {last_err}. "
            "Проверьте SUZ_API_BASE_URL (часть стендов — отдельный хост TLS), SUZ_TLS_VERIFY=false и "
            "SUZ_CURL_FALLBACK=true. Если ошибка сохраняется, контур может требовать ГОСТ-TLS без обхода."
        )
        raise SuzIntegrationError(msg, suggest_transport_diagnostics=True) from last_err
    if response.status_code not in (200, 201):
        raise SuzIntegrationError(
            _format_suz_http_error_detail(
                http_code=response.status_code,
                url=str(response.request.url),
                body_text=response.text,
            )
        )
    try:
        payload_any = response.json()
    except ValueError as exc:
        raise SuzIntegrationError(f"СУЗ вернула не-JSON: {response.text[:500]}") from exc
    if not isinstance(payload_any, dict):
        raise SuzIntegrationError(f"СУЗ вернула не объект JSON: {str(payload_any)[:500]}")
    remote_oid = _first_str(payload_any, "orderId", "order_id", "orderID")
    if not remote_oid:
        raise SuzIntegrationError(f"Ответ СУЗ не содержит orderId: {response.text[:2000]}")
    return remote_oid, payload_any
def _resolve_suz_connection(oms_id: str | None = None) -> tuple[str, str, str]:
    return _resolve_suz_connection_with_token(oms_id, None)
async def _suz_get_json(
    path: str,
    *,
    params: dict[str, str],
    oms_id: str | None = None,
    token_override: str | None = None,
) -> dict[str, Any] | list[Any]:
    settings = get_settings()
    base, token, oms_resolved = _resolve_suz_connection_with_token(oms_id, token_override)
    _ = oms_resolved
    full_path = path if path.startswith("http") else f"{base}{path}"
    headers = _build_suz_auth_headers(token, with_json_content_type=False)
    full_url = f"{full_path}?{urlencode(params)}"
    response, last_err = await _suz_dispatch_httpx(
        method="GET",
        url=full_path,
        headers=headers,
        params=params,
    )
    if response is None and settings.suz_curl_fallback:
        tmax = max(1, int(settings.suz_timeout_seconds))
        for curl_tls in _curl_tls_flag_variants():
            try:
                code, payload, raw_pref = await _curl_get_json(full_url, token, tmax, tls_extra=curl_tls)
                if code != 200:
                    body = json.dumps(payload, ensure_ascii=False) if payload is not None else raw_pref
                    raise SuzIntegrationError(
                        _format_suz_http_error_detail(http_code=code, url=full_url, body_text=body)
                    )
                if payload is None:
                    raise SuzIntegrationError(f"СУЗ (curl) не-JSON: {raw_pref[:800]}")
                return payload
            except OSError as exc:
                last_err = exc
                continue
    if response is None:
        raise SuzIntegrationError(
            f"Не удалось выполнить GET к СУЗ: {last_err}",
            suggest_transport_diagnostics=True,
        ) from last_err
    if response.status_code != 200:
        raise SuzIntegrationError(
            _format_suz_http_error_detail(
                http_code=response.status_code,
                url=str(response.request.url),
                body_text=response.text,
            )
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise SuzIntegrationError(f"СУЗ вернула не-JSON: {response.text[:500]}") from exc
    if not isinstance(payload, (dict, list)):
        raise SuzIntegrationError(f"СУЗ вернула неожиданный JSON: {str(payload)[:500]}")
    return payload
async def fetch_suz_order_status(
    *,
    order_id: str,
    oms_id: str | None = None,
    token_override: str | None = None,
) -> dict[str, Any]:
    _, _, oms_resolved = _resolve_suz_connection_with_token(oms_id, token_override)
    path = f"/api/v3/order/{order_id.strip()}/status"
    payload = await _suz_get_json(
        path,
        params={"omsId": oms_resolved},
        oms_id=oms_id,
        token_override=token_override,
    )
    return payload if isinstance(payload, dict) else {"data": payload}
async def fetch_suz_order_codes(
    *,
    order_id: str,
    gtin: str,
    quantity: int,
    oms_id: str | None = None,
    last_block_id: int = 0,
    token_override: str | None = None,
) -> list[str]:
    _, _, oms_resolved = _resolve_suz_connection_with_token(oms_id, token_override)
    gtin14 = _normalize_gtin(gtin)
    if not gtin14:
        raise SuzIntegrationError("Некорректный GTIN для запроса кодов.")
    path = "/api/v3/codes"
    params = {
        "omsId": oms_resolved,
        "orderId": order_id.strip(),
        "gtin": gtin14,
        "quantity": str(max(1, int(quantity))),
        "lastBlockId": str(int(last_block_id)),
    }
    payload = await _suz_get_json(
        path,
        params=params,
        oms_id=oms_id,
        token_override=token_override,
    )
    if isinstance(payload, list):
        codes = [str(x).strip() for x in payload if str(x).strip()]
        return codes
    if isinstance(payload, dict):
        for key in ("codes", "cisList", "cises", "items", "result"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return [str(x).strip() for x in inner if str(x).strip()]
    return []
def build_suz_close_order_body(order_id: str) -> dict[str, Any]:
    return {"orderId": order_id.strip()}
async def close_suz_order(
    *,
    oms_id: str | None = None,
    body_string: str,
    x_signature: str,
    json_body: dict[str, Any] | None = None,
    token_override: str | None = None,
) -> dict:
    settings = get_settings()
    base, token, oms_resolved = _resolve_suz_connection_with_token(oms_id, token_override)
    sig = (x_signature or "").replace("\r", "").replace("\n", "").strip()
    if not sig:
        raise SuzIntegrationError(
            "Для закрытия заказа в СУЗ v3 нужна откреплённая подпись тела запроса (заголовок X-Signature). "
            "Подпишите JSON в браузере через КриптоПро ЭЦП Browser plug-in."
        )
    path = f"{base}/api/v3/order/close"
    params = {"omsId": oms_resolved}
    raw_body = (body_string or "").strip()
    if not raw_body:
        if json_body is None:
            raise SuzIntegrationError("Пустое тело запроса к СУЗ.")
        raw_body = dumps_suz_request_body(json_body)
    body_bytes = raw_body.encode("utf-8")
    headers = _build_suz_auth_headers(token, x_signature=sig)
    response, last_err = await _suz_dispatch_httpx(
        method="POST",
        url=path,
        headers=headers,
        params=params,
        content=body_bytes,
    )
    full_url_post = f"{path}?{urlencode(params)}"
    if response is None and settings.suz_curl_fallback:
        tmax = max(1, int(settings.suz_timeout_seconds))
        for curl_tls in _curl_tls_flag_variants():
            try:
                code, parsed, raw_pref = await _curl_post_json(
                    full_url_post,
                    token,
                    timeout_sec=tmax,
                    tls_extra=curl_tls,
                    body_bytes=body_bytes,
                    x_signature=sig,
                )
                if code not in (200, 201, 204):
                    curl_body = ""
                    if isinstance(parsed, dict) or isinstance(parsed, list):
                        curl_body = json.dumps(parsed, ensure_ascii=False)
                    else:
                        curl_body = raw_pref
                    raise SuzIntegrationError(
                        _format_suz_http_error_detail(http_code=code, url=full_url_post, body_text=curl_body)
                    )
                if isinstance(parsed, dict):
                    return parsed
                return {}
            except OSError as exc:
                last_err = exc
                lbl = "default TLS" if not curl_tls else " ".join(curl_tls)
                logger.warning("SUZ curl POST close (%s) failed: %s", lbl, exc)
    if response is None:
        raise SuzIntegrationError(
            f"Не удалось выполнить POST закрытия заказа в СУЗ: {last_err}",
            suggest_transport_diagnostics=True,
        ) from last_err
    if response.status_code not in (200, 201, 204):
        raise SuzIntegrationError(
            _format_suz_http_error_detail(
                http_code=response.status_code,
                url=str(response.request.url),
                body_text=response.text,
            )
        )
    if not response.content:
        return {}
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}
def _resolve_true_api_base_url(settings: Settings | None = None) -> str:
    s = settings or get_settings()
    true_api_base = (s.true_api_base_url or "").strip().rstrip("/")
    if not true_api_base:
        raise SuzIntegrationError("Не задан TRUE_API_BASE_URL в настройках")
    return true_api_base
async def check_cis_status(
    cis: str,
    client_token: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    token = _normalize_suz_client_token(
        client_token or resolve_suz_api_token(settings)
    )
    true_api_base = _resolve_true_api_base_url(settings)
    url = f"{true_api_base}/api/v3/true-api/cises/info"
    headers = {
        "clientToken": token,
        "Accept": "application/json",
    }
    params = {"cis": cis}
    response, err = await _suz_dispatch_httpx(
        method="GET",
        url=url,
        headers=headers,
        params=params,
    )
    if response is None:
        return {"error": str(err), "cis": cis, "status": "unknown"}
    if response.status_code == 200:
        data = response.json()
        if isinstance(data, list) and data:
            data = data[0]
        if not isinstance(data, dict):
            data = {}
        return {
            "cis": cis,
            "status": data.get("status", "unknown"),
            "owner_inn": data.get("ownerInn"),
            "owner_name": data.get("ownerName"),
            "gtin": data.get("gtin"),
            "produced_date": data.get("producedDate"),
            "raw": data,
        }
    return {
        "cis": cis,
        "status": "error",
        "error": response.text[:200],
    }
def _get_short_cis(code: str) -> str:
    gs = "\x1d"
    if gs in code:
        return code.split(gs)[0]
    idx = code.find("91FFD0")
    if idx > 0:
        return code[:idx]
    return code
async def check_cis_statuses_batch(
    cises: list[str],
    db: AsyncSession | None = None,
    *args,
    **kwargs,
) -> list[dict[str, Any]]:
    import json as json_lib
    settings = get_settings()
    if db is not None:
        from services.token_service import get_true_api_token
        token = await get_true_api_token(db)
    else:
        token = settings.true_api_token
    base_url = (settings.true_api_base_url or "").strip().rstrip("/")
    if not base_url:
        return [{"cis": c, "status": "error", "error": "TRUE_API_BASE_URL не настроен"} for c in cises]
    if not token:
        return [{"cis": c, "status": "error", "error": "TRUE_API_TOKEN не настроен"} for c in cises]
    url = f"{base_url.rstrip('/')}/api/v3/true-api/cises/info"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = json_lib.dumps(cises, ensure_ascii=True)
    logger.info(
        "True API request: url=%s, codes_count=%d, first_code_repr=%s",
        url,
        len(cises),
        repr(cises[0])[:80] if cises else "",
    )
    logger.info("Body preview: %s", body[:200])
    response, err = await _suz_dispatch_httpx(
        method="POST",
        url=url,
        headers=headers,
        params=None,
        content=body.encode("utf-8"),
    )
    if response is None:
        return [{"cis": c, "status": "error", "error": str(err)} for c in cises]
    logger.info(
        "True API response: status=%d, body=%s",
        response.status_code,
        response.text[:300],
    )
    results: list[dict[str, Any]] = []
    try:
        data = response.json()
        if response.status_code != 200:
            if isinstance(data, dict) and not data.get("results") and not data.get("data"):
                err_text = str(
                    data.get("error_message")
                    or data.get("errorMessage")
                    or data.get("message")
                    or response.text[:300]
                )
                return [{"cis": c, "status": "error", "error": err_text} for c in cises]
        if isinstance(data, dict):
            data = data.get("results") or data.get("data") or [data]
        if isinstance(data, list):
            for i, item in enumerate(data):
                if not isinstance(item, dict):
                    continue
                cis = item.get("cisInfo", {}).get("cis", "") or (cises[i] if i < len(cises) else "")
                error_msg = item.get("errorMessage")
                error_code = item.get("errorCode")
                if str(error_code) == "404" or error_msg == "КМ/КИ не найден":
                    status = "not_found"
                elif error_msg:
                    status = "error"
                else:
                    cis_info = item.get("cisInfo", {})
                    status = cis_info.get("status", "unknown")
                results.append({
                    "cis": cis,
                    "status": status,
                    "owner_inn": item.get("cisInfo", {}).get("ownerInn"),
                    "owner_name": item.get("cisInfo", {}).get("ownerName"),
                    "gtin": item.get("cisInfo", {}).get("gtin"),
                    "error": error_msg,
                })
            if results:
                all_not_found = all(r.get("status") == "not_found" for r in results)
                if all_not_found:
                    short_cises = [_get_short_cis(c) for c in cises]
                    if short_cises != cises:
                        body2 = json_lib.dumps(short_cises, ensure_ascii=True)
                        logger.info(
                            "True API fallback (short codes): codes_count=%d, first_short_repr=%s",
                            len(short_cises),
                            repr(short_cises[0])[:80] if short_cises else "",
                        )
                        response2, err2 = await _suz_dispatch_httpx(
                            method="POST",
                            url=url,
                            headers=headers,
                            params=None,
                            content=body2.encode("utf-8"),
                        )
                        if response2 and response2.status_code == 200:
                            try:
                                data2 = response2.json()
                                if isinstance(data2, list):
                                    results2: list[dict[str, Any]] = []
                                    for i, item in enumerate(data2):
                                        if not isinstance(item, dict):
                                            continue
                                        orig_cis = cises[i] if i < len(cises) else ""
                                        error_msg2 = item.get("errorMessage")
                                        error_code2 = item.get("errorCode")
                                        if str(error_code2) == "404" or error_msg2 == "КМ/КИ не найден":
                                            status2 = "not_found"
                                        elif error_msg2:
                                            status2 = "error"
                                        else:
                                            cis_info2 = item.get("cisInfo", {})
                                            status2 = cis_info2.get("status", "unknown")
                                        results2.append({
                                            "cis": orig_cis,
                                            "status": status2,
                                            "owner_inn": item.get("cisInfo", {}).get("ownerInn"),
                                            "owner_name": item.get("cisInfo", {}).get("ownerName"),
                                            "gtin": item.get("cisInfo", {}).get("gtin"),
                                            "error": error_msg2,
                                        })
                                    if results2:
                                        logger.info(
                                            "True API fallback response: %d codes, found=%d",
                                            len(results2),
                                            sum(1 for r in results2 if r.get("status") != "not_found"),
                                        )
                                        return results2
                            except Exception:
                                pass
                return results
        if response.status_code != 200:
            err_text = response.text[:300]
            if isinstance(data, dict):
                err_text = str(
                    data.get("error_message")
                    or data.get("errorMessage")
                    or data.get("message")
                    or err_text
                )
            return [{"cis": c, "status": "error", "error": err_text} for c in cises]
    except Exception as e:
        return [{"cis": c, "status": "error", "error": str(e)} for c in cises]
    return results
