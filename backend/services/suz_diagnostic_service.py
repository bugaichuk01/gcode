from __future__ import annotations
import asyncio
import json
import logging
import re
import shutil
import socket
import ssl
from typing import Any
from urllib.parse import urlparse
from settings import get_settings
from services.suz_integration_service import _normalize_suz_client_token, build_suz_v3_ping_url
logger = logging.getLogger(__name__)
def _normalize_https_base(raw: str) -> str | None:
    s = (raw or "").strip()
    if not s:
        return None
    u = urlparse(s if "://" in s else f"https://{s}")
    if u.scheme.lower() != "https":
        return None
    if not u.netloc:
        return None
    return f"{u.scheme}://{u.netloc.rstrip('/')}"
def _host_port(base: str) -> tuple[str, int] | None:
    u = urlparse(base)
    if not u.hostname:
        return None
    port = u.port or 443
    return u.hostname.lower(), port
def _detect_config_mismatch() -> tuple[list[str], str | None]:
    hints: list[str] = []
    rec: str | None = None
    s = get_settings()
    nk_raw = (s.national_catalog_send_url or "").strip()
    nk = nk_raw.lower()
    sb = (s.suz_api_base_url or "").lower()
    if "api.nk.sandbox.crptech" in nk and ("mdlp.crpt.ru" in sb or "api.sb.mdlp" in sb):
        hints.append(
            "Национальный каталог sandbox у вас на api.nk.sandbox.crptech.ru, а СУЗ на домене mdlp.crpt.ru — "
            "это часто разные контуры или разное TLS-поведение. Для песочницы ГИС МТ параллельно указывают узел "
            "https://suz.sandbox.crptech.ru (см. методичку/CHZURLSUZ по вашему контуру)."
        )
        rec = "https://suz.sandbox.crptech.ru"
    nk_hostname = urlparse(nk_raw if "://" in nk_raw else f"https://{nk_raw}").hostname or ""
    nk_hostname = nk_hostname.lower()
    if nk_hostname.startswith("api.nk.") and "crptech" in nk_hostname and ".mdlp." in sb and not hints:
        hints.append(
            "Похоже, Нацкаталог и база СУЗ из разных «линейок» доменов; проверьте официальный OMS-базис для вашего контура."
        )
    return hints, rec
def _resolver_warnings(hostname: str) -> list[str]:
    o: list[str] = []
    if re.fullmatch(r"[\da-fA-F:]+", hostname) and ":" in hostname:
        o.append(f"Hostname похож на literal IPv6/IP — SAN в сертификате может не совпасть:{hostname}")
    return o
async def _tls_handshake_probe(host: str, port: int, *, handshake_timeout: float = 8.0) -> tuple[bool, str | None]:
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(
                host,
                port,
                ssl=ctx,
                server_hostname=host,
                ssl_handshake_timeout=handshake_timeout,
            ),
            timeout=handshake_timeout + 2,
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True, None
    except Exception as exc:  
        return False, f"{type(exc).__name__}: {exc}"
async def _curl_probe_json(
    *,
    url: str,
    token_placeholder: str = "diag-probe-invalid-token",
    timeout_sec: int = 10,
    tls_extra: tuple[str, ...] = (),
) -> dict[str, Any]:
    if not shutil.which("curl"):
        return {"error": "curl not installed in image"}
    if not url.strip():
        return {"error": "empty url"}
    proc = await asyncio.create_subprocess_exec(
        "curl",
        "-sS",
        "--http1.1",
        *tls_extra,
        "-k",
        "-H",
        f"clientToken: {_normalize_suz_client_token(token_placeholder)}",
        "-H",
        "Accept: application/json",
        "-w",
        "\n%{http_code}",
        "--max-time",
        str(timeout_sec),
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out_b, err_b = await proc.communicate()
    raw = out_b.decode(errors="replace")
    err_raw = err_b.decode(errors="replace").strip()
    payload: dict[str, Any] = {
        "curl_os_exit_code": proc.returncode,
        "stderr_tail": err_raw[-800:] if err_raw else "",
    }
    if proc.returncode != 0:
        payload["transport_error"] = err_raw or raw[:600]
        return payload
    lines = raw.rstrip("\n").split("\n")
    if lines and lines[-1].isdigit():
        payload["http_code"] = int(lines[-1])
        body_blob = "\n".join(lines[:-1])
    else:
        body_blob = raw
    if body_blob.strip():
        try:
            j = json.loads(body_blob)
            if isinstance(j, dict):
                payload["body_json_keys_sample"] = list(j.keys())[:16]
            elif isinstance(j, list):
                payload["body_json_array_len"] = len(j)
        except json.JSONDecodeError:
            payload["body_text_prefix"] = body_blob.strip()[:400]
    return payload
async def diagnose_suz_oms_endpoint() -> dict[str, Any]:
    settings = get_settings()
    hints, recommendation = _detect_config_mismatch()
    oms = (settings.suz_oms_id or "").strip() or "00000000-0000-0000-0000-000000000000"
    probes: list[dict[str, Any]] = []
    seen_bases: set[str] = set()
    bases_to_try: list[tuple[str, str]] = []
    main = _normalize_https_base(settings.suz_api_base_url or "")
    if main:
        bases_to_try.append(("configured", main))
    alt = recommendation
    sandbox_gis = _normalize_https_base("https://suz.sandbox.crptech.ru")
    if sandbox_gis and sandbox_gis not in {main or ""}:
        bases_to_try.append(("alternate_sandbox_suz_crptech", sandbox_gis))
    elif alt:
        normalized_alt = _normalize_https_base(alt)
        if normalized_alt and normalized_alt not in seen_bases and normalized_alt != main:
            bases_to_try.append(("recommended_hint", normalized_alt))
    for label, base in bases_to_try:
        if base in seen_bases:
            continue
        seen_bases.add(base)
        hp = _host_port(base)
        ips: list[str] = []
        dns_err: str | None = None
        if hp:
            host, port = hp
            try:
                def _resolve():
                    return socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
                infos = await asyncio.to_thread(_resolve)
                ips = sorted({x[4][0] for x in infos})
            except OSError as exc:
                dns_err = str(exc)
            tls_ok, tls_err = await _tls_handshake_probe(host, port)
            resolver_notes = _resolver_warnings(host)
            ping_path = build_suz_v3_ping_url(base, oms)
            curl_profiles: dict[str, Any] = {}
            for p_name, tls_flags in (
                ("default_tls", ()),
                ("tlsv13", ("--tlsv1.3",)),
                ("tls12_max", ("--tlsv1.2", "--tls-max", "1.2")),
            ):
                try:
                    curl_profiles[p_name] = await _curl_probe_json(
                        url=ping_path,
                        timeout_sec=min(15, max(8, int(settings.suz_timeout_seconds))),
                        tls_extra=tls_flags,
                    )
                except Exception as inner:  
                    curl_profiles[p_name] = {"error": str(inner)}
            probes.append(
                {
                    "label": label,
                    "base_url": base,
                    "oms_probe_url_masked": ping_path.replace(oms, "<omsId>"),
                    "host": hp[0] if hp else None,
                    "port": hp[1] if hp else None,
                    "dns_ips": ips,
                    "dns_error": dns_err,
                    "python_tls_handshake_ok": tls_ok if hp else False,
                    "python_tls_handshake_error": tls_err if hp else "no hostname",
                    "resolver_notes": resolver_notes,
                    "curl_profiles": curl_profiles,
                }
            )
    verdict_lines: list[str] = []
    configured_probe = next((p for p in probes if p.get("label") == "configured"), None)
    configured_tls_ok = bool(configured_probe and configured_probe.get("python_tls_handshake_ok"))
    if not configured_tls_ok:
        verdict_lines.append(
            "К настроенному SUZ_API_BASE_URL TLS из процесса Python не установился. "
            "Если второй пробник (alternate) даёт успешный TLS — ошибка, скорее всего, в неподходящем хосте/контуре (домен, порт), а не в коде приложения."
        )
    alternate_ok = False
    for p in probes:
        if p.get("label") != "configured" and p.get("python_tls_handshake_ok"):
            alternate_ok = True
            verdict_lines.append(
                f"Альтернативная база {p.get('base_url')} в этом образе смогла пройти TLS-handshake Python — стоит сменить SUZ_API_BASE_URL в .env на адрес вашего официального контура."
            )
            break
    if not alternate_ok and not configured_tls_ok:
        verdict_lines.append(
            "И настроенный, и альтернативный хост показали ошибку handshake — возможен режим только ГОСТ-TLS "
            "(нужна СКЗИ/шлюз за пределами приложения) или ограничения среды (прокси, DNS, блок по сети)."
        )
    nk_n = (settings.national_catalog_send_url or "").lower()
    suggested_base = recommendation
    if suggested_base is None and "api.nk.sandbox.crptech" in nk_n and probes:
        cand = next((p for p in probes if "suz.sandbox.crptech.ru" in (p.get("base_url") or "")), None)
        if cand and cand.get("python_tls_handshake_ok"):
            suggested_base = cand["base_url"]
    return {
        "heuristic_hints": hints,
        "suggested_base_url_when_nk_crptech_sandbox": suggested_base or recommendation,
        "probes": probes,
        "verdict": "\n".join(verdict_lines) if verdict_lines else "TLS-handshake успешен на настроенном URL — при ошибках см. коды HTTP/API.",
        "docs_pointer": (
            "https://docs.crpt.ru/gismt/%D0%A0%D0%B0%D0%B7%D0%B4%D0%B5%D0%BB_%D0%B4%D0%BB%D1%8F_%"
            "1%D1%80%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D1%87%D0%B8%D0%BA%D0%BE%D0%B2/"
        ),
    }
