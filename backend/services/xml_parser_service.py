from __future__ import annotations
import re
from typing import Any
from lxml import etree
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import OzonMapping
def _localname(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag
def _norm_gtin(raw: str) -> str:
    digits = re.sub(r"\D", "", (raw or "").strip())
    if not digits:
        return ""
    if len(digits) < 8:
        return ""
    return digits[:14]
def _child_text_map(el: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    for child in el:
        if not isinstance(child.tag, str):
            continue
        key = _localname(child.tag).strip().lower()
        parts: list[str] = []
        if child.text and child.text.strip():
            parts.append(child.text.strip())
        for sub in child:
            if sub.tail and sub.tail.strip():
                parts.append(sub.tail.strip())
        if parts:
            out[key] = " ".join(parts)
    return out
def _pick(m: dict[str, str], *keys: str) -> str | None:
    for k in keys:
        v = m.get(k)
        if v:
            return v
    return None
def _pick_price_vat(m: dict[str, str]) -> str | None:
    direct = _pick(
        m,
        "price_vat",
        "pricewithvat",
        "pricevat",
        "ценандс",
        "ценанндс",
        "цена_ндс",
        "ценасндс",
        "price_nds",
    )
    if direct:
        return direct
    price = _pick(m, "price", "цена", "retailprice", "retail_price")
    vat = _pick(m, "vat", "nds", "ндс", "vatrate", "vat_rate")
    if price and vat:
        return f"{price} / {vat}"
    if price:
        return price
    return None
def _extract_products_from_xml(xml_bytes: bytes) -> list[dict[str, str | None]]:
    parser = etree.XMLParser(resolve_entities=False, recover=True)
    try:
        root = etree.fromstring(xml_bytes, parser=parser)
    except etree.XMLSyntaxError:
        raise ValueError("Некорректный XML") from None
    seen: set[tuple[str, str, str]] = set()
    rows: list[dict[str, str | None]] = []
    for el in root.iter():
        m = _child_text_map(el)
        if not m:
            continue
        gtin_raw = _pick(
            m,
            "gtin",
            "gtin14",
            "ean",
            "ean13",
            "barcode",
            "штрихкод",
            "баркод",
            "киз",
        )
        if not gtin_raw:
            continue
        gtin = _norm_gtin(gtin_raw)
        if not gtin:
            continue
        article = (
            _pick(
                m,
                "article",
                "sku",
                "vendorcode",
                "offer_id",
                "offerid",
                "артикул",
                "код",
            )
            or ""
        ).strip()
        name = (
            _pick(
                m,
                "name",
                "title",
                "productname",
                "наименование",
                "название",
                "описание",
            )
            or ""
        ).strip()
        if not article and not name:
            continue
        if not article:
            article = gtin
        if not name:
            name = article
        key = (gtin, article, name)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "article": article,
                "name": name,
                "price_vat": _pick_price_vat(m),
                "gtin": gtin,
            }
        )
    return rows
async def parse_ozon_xml_file(
    session: AsyncSession,
    xml_bytes: bytes,
) -> list[dict[str, str | None]]:
    raw_rows = _extract_products_from_xml(xml_bytes)
    if not raw_rows:
        return []
    gtins = {r["gtin"] for r in raw_rows if r.get("gtin")}
    mapping: dict[str, str] = {}
    if gtins:
        result = await session.scalars(
            select(OzonMapping).where(OzonMapping.gtin.in_(gtins))
        )
        for om in result.all():
            mapping[om.gtin] = om.ozon_id
    out: list[dict[str, str | None]] = []
    for r in raw_rows:
        g = r.get("gtin") or ""
        oid = mapping.get(g)
        row = {**r, "ozon_id": oid}
        out.append(row)
    return out
