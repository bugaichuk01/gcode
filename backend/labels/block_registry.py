"""Единый реестр типов-примитивов блоков этикетки (PDF-рендеринг)."""
from __future__ import annotations

import logging
from typing import Any, Callable

from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from labels.field_catalog import FieldResolveContext, resolve_field, substitute_text

logger = logging.getLogger(__name__)

# Дефолтная геометрия/свойства по типу (мм, кроме font_size в pt).
DEFAULT_GEOMETRY: dict[str, dict[str, Any]] = {
    "datamatrix": {"size": 30},
    "text": {"text": "Текст", "font_size": 6, "bold": False},
    "field": {"field_key": "name", "font_size": 6, "bold": False},
    "line": {"x2": 30, "y2": 5},
    "barcode_ean13": {"width": 38, "height": 15},
}

BLOCK_TYPES = frozenset(DEFAULT_GEOMETRY.keys())


def merge_element_defaults(el: dict[str, Any]) -> dict[str, Any]:
    """Дополняет элемент дефолтами из реестра для отсутствующих полей."""
    el_type = el.get("type")
    if el_type not in DEFAULT_GEOMETRY:
        return el
    merged = {**DEFAULT_GEOMETRY[el_type], **el}
    merged["type"] = el_type
    return merged


PdfRenderFn = Callable[
    [
        canvas.Canvas,
        dict[str, Any],
        str,
        str | None,
        Any,
        float,
        str,
        str,
        Any,
    ],
    None,
]


def draw_datamatrix_safe(
    c: canvas.Canvas,
    code: str,
    x: float,
    y: float,
    size: float,
) -> None:
    from reportlab.graphics.barcode.ecc200datamatrix import ECC200DataMatrix

    try:
        probe = ECC200DataMatrix(value=code, barWidth=1.0)
        probe.validate()
        probe.encode()
        cols = probe.col_modules
        rows = probe.row_modules

        if cols <= 0 or rows <= 0:
            raise ValueError(f"Неверные размеры матрицы: {cols}x{rows}")

        bar_size = size / max(cols, rows)

        dm = ECC200DataMatrix(value=code, barWidth=bar_size)
        dm.validate()
        dm.encode()
        dm.canv = c
        dm.x = 0
        dm.y = 0

        c.saveState()
        c.translate(x, y)
        dm.draw()
        c.restoreState()

    except Exception as e:
        c.saveState()
        c.setStrokeColorRGB(1, 0, 0)
        c.setLineWidth(0.5)
        c.rect(x, y, size, size)
        c.setFont("Helvetica", 3)
        c.setFillColorRGB(1, 0, 0)
        c.drawString(x + 1, y + size / 2, "DM ERR")
        c.restoreState()
        logger.warning("DataMatrix рендер не удался: %s, код: %s...", e, code[:20])


def _pdf_datamatrix(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    _gtin: str | None,
    _ef: Any,
    page_h: float,
    _font_normal: str,
    _font_bold: str,
    _product_card: Any = None,
) -> None:
    el = merge_element_defaults(el)
    size_mm = float(el.get("size", 30))
    size = size_mm * mm
    x = float(el.get("x", 0)) * mm
    y = page_h - float(el.get("y", 0)) * mm - size
    if y < 0:
        y = 0
    draw_datamatrix_safe(c, code, x, y, size)


def _gtin_to_ean13(gtin: str | None) -> str | None:
    import re

    if not gtin:
        return None
    digits = re.sub(r"\D", "", gtin)
    if len(digits) >= 13:
        return digits[:13]
    return None


def _pdf_barcode_ean13(
    c: canvas.Canvas,
    el: dict[str, Any],
    _code: str,
    gtin: str | None,
    _ef: Any,
    page_h: float,
    _font_normal: str,
    _font_bold: str,
    _product_card: Any = None,
) -> None:
    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode import eanbc
    from reportlab.graphics.shapes import Drawing

    el = merge_element_defaults(el)
    barcode_value = _gtin_to_ean13(gtin)
    if not barcode_value:
        return

    x_mm = float(el.get("x", 0))
    y_mm = float(el.get("y", 0))
    width_mm = float(el.get("width", 38))
    height_mm = float(el.get("height", 15))

    bar_height = height_mm * mm
    bar_width = width_mm * mm
    text_gap = 5 * mm
    draw_y = page_h - y_mm * mm - bar_height - text_gap

    try:
        barcode = eanbc.Ean13BarcodeWidget(barcode_value)
        barcode.barHeight = bar_height
        barcode.barWidth = max(bar_width / 95.0, 0.2 * mm)

        drawing = Drawing(bar_width, bar_height + text_gap)
        drawing.add(barcode)
        renderPDF.draw(drawing, c, x_mm * mm, draw_y)
    except Exception as e:
        logger.warning("Ошибка генерации EAN-13: %s", e)


def _draw_resolved_text(
    c: canvas.Canvas,
    el: dict[str, Any],
    text: str,
    page_h: float,
    font_normal: str,
    font_bold: str,
) -> None:
    if not text.strip():
        return
    font_size = float(el.get("font_size", 6))
    is_bold = bool(el.get("bold"))
    font_name = font_bold if is_bold else font_normal
    c.setFont(font_name, font_size)
    x = float(el.get("x", 0)) * mm
    y = page_h - float(el.get("y", 0)) * mm - font_size * 0.35 * mm
    max_width = el.get("max_width")
    if max_width:
        max_w = float(max_width) * mm
        while stringWidth(text, font_name, font_size) > max_w and len(text) > 1:
            text = text[:-1]
    c.drawString(x, y, text)


def _pdf_text(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    gtin: str | None,
    ef: Any,
    page_h: float,
    font_normal: str,
    font_bold: str,
    product_card: Any = None,
) -> None:
    el = merge_element_defaults(el)
    ctx = FieldResolveContext(
        code=code,
        gtin=gtin,
        extra_fields=ef,
        product_card=product_card,
    )
    text = substitute_text(el.get("text", ""), ctx)
    _draw_resolved_text(c, el, text, page_h, font_normal, font_bold)


def _pdf_field(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    gtin: str | None,
    ef: Any,
    page_h: float,
    font_normal: str,
    font_bold: str,
    product_card: Any = None,
) -> None:
    el = merge_element_defaults(el)
    ctx = FieldResolveContext(
        code=code,
        gtin=gtin,
        extra_fields=ef,
        product_card=product_card,
    )
    field_key = str(el.get("field_key", ""))
    text = resolve_field(field_key, ctx)
    _draw_resolved_text(c, el, text, page_h, font_normal, font_bold)


def _pdf_line(
    c: canvas.Canvas,
    el: dict[str, Any],
    _code: str,
    _gtin: str | None,
    _ef: Any,
    page_h: float,
    _font_normal: str,
    _font_bold: str,
    _product_card: Any = None,
) -> None:
    el = merge_element_defaults(el)
    x1 = float(el.get("x1", el.get("x", 0))) * mm
    y1 = page_h - float(el.get("y1", el.get("y", 0))) * mm
    x2 = float(el.get("x2", 0)) * mm
    y2 = page_h - float(el.get("y2", el.get("y", 0))) * mm
    c.setLineWidth(0.5)
    c.line(x1, y1, x2, y2)


PDF_RENDERERS: dict[str, PdfRenderFn] = {
    "datamatrix": _pdf_datamatrix,
    "barcode_ean13": _pdf_barcode_ean13,
    "text": _pdf_text,
    "field": _pdf_field,
    "line": _pdf_line,
}


def draw_element_from_template(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    gtin: str | None,
    ef: Any,
    page_h: float,
    font_normal: str,
    font_bold: str,
    product_card: Any = None,
) -> None:
    """Отрисовывает один элемент шаблона через реестр."""
    el_type = el.get("type")
    renderer = PDF_RENDERERS.get(el_type)
    if renderer is None:
        logger.warning("Неизвестный тип блока этикетки, пропуск: %r", el_type)
        return
    renderer(c, el, code, gtin, ef, page_h, font_normal, font_bold, product_card)
