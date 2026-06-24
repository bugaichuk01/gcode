"""Единый реестр типов-примитивов блоков этикетки (PDF-рендеринг)."""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Any, Callable

from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from labels.field_catalog import (
    FieldResolveContext,
    PrintContext,
    resolve_barcode_value,
    resolve_field,
    resolve_field_block_label,
    substitute_text,
)
from labels.font_registry import resolve_font
from labels.sign_registry import resolve_sign_path

logger = logging.getLogger(__name__)

# Дефолтная геометрия/свойства по типу (мм, кроме font_size в pt).
DEFAULT_GEOMETRY: dict[str, dict[str, Any]] = {
    "datamatrix": {"size": 30},
    "text": {"text": "Текст", "font_size": 6, "bold": False, "italic": False, "underline": False},
    "field": {"field_key": "name", "font_size": 6, "bold": False, "italic": False, "underline": False},
    "line": {"x2": 30, "y2": 5},
    "barcode_ean13": {"width": 38, "height": 15},
    "sign": {"width": 10, "height": 10, "sign_key": "eac"},
    "image": {"width": 15, "height": 15, "image_id": ""},
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
        Any,
        dict[str, bytes] | None,
        PrintContext | None,
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
    _product_card: Any = None,
    _image_cache: dict[str, bytes] | None = None,
    _print_context: PrintContext | None = None,
) -> None:
    el = merge_element_defaults(el)
    size_mm = float(el.get("size", 30))
    size = size_mm * mm
    x = float(el.get("x", 0)) * mm
    y = page_h - float(el.get("y", 0)) * mm - size
    if y < 0:
        y = 0
    draw_datamatrix_safe(c, code, x, y, size)



def _barcode_print_options(print_context: PrintContext | None) -> dict[str, Any]:
    ctx = print_context or PrintContext(label_index=0, label_number=1, total=1)
    return {
        "barcode_type": ctx.barcode_type,
        "barcode_column": ctx.barcode_column,
        "barcode_keep_leading_zero": ctx.barcode_keep_leading_zero,
        "barcode_from_extra": ctx.barcode_from_extra,
    }


def _resolve_barcode_for_render(
    code: str,
    gtin: str | None,
    ef: Any,
    product_card: Any,
    print_context: PrintContext | None,
) -> str | None:
    opts = _barcode_print_options(print_context)
    ctx = FieldResolveContext(
        code=code,
        gtin=gtin,
        extra_fields=ef,
        product_card=product_card,
        print_context=print_context,
    )
    return resolve_barcode_value(ctx, **opts)


def _pdf_barcode_ean13(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    gtin: str | None,
    ef: Any,
    page_h: float,
    product_card: Any = None,
    _image_cache: dict[str, bytes] | None = None,
    print_context: PrintContext | None = None,
) -> None:
    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode import eanbc
    from reportlab.graphics.shapes import Drawing

    el = merge_element_defaults(el)
    barcode_value = _resolve_barcode_for_render(code, gtin, ef, product_card, print_context)
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


def _pdf_barcode_code128(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    gtin: str | None,
    ef: Any,
    page_h: float,
    product_card: Any = None,
    _image_cache: dict[str, bytes] | None = None,
    print_context: PrintContext | None = None,
) -> None:
    from reportlab.graphics.barcode.code128 import Code128

    el = merge_element_defaults(el)
    barcode_value = _resolve_barcode_for_render(code, gtin, ef, product_card, print_context)
    if not barcode_value:
        return

    x_mm = float(el.get("x", 0))
    y_mm = float(el.get("y", 0))
    width_mm = float(el.get("width", 38))
    height_mm = float(el.get("height", 15))

    bar_height = height_mm * mm
    bar_width = width_mm * mm
    draw_y = page_h - y_mm * mm - bar_height

    try:
        barcode = Code128(barcode_value, barHeight=bar_height)
        barcode.validate()
        natural_width = float(barcode.width)
        if natural_width > 0:
            barcode.barWidth = max(bar_width / natural_width, 0.2 * mm)
        barcode.drawOn(c, x_mm * mm, draw_y)
    except Exception as e:
        logger.warning("Ошибка генерации Code128: %s", e)


def _resolve_part_style(el: dict[str, Any], part: str | None) -> dict[str, Any]:
    """Эффективные стили части (label/value) с наследованием от корня элемента."""
    root = {
        "font_size": float(el.get("font_size", 6)),
        "bold": bool(el.get("bold")),
        "italic": bool(el.get("italic")),
        "underline": bool(el.get("underline")),
        "line_height": el.get("line_height"),
    }
    if not part:
        return root
    part_obj = el.get(part) or {}
    line_height = part_obj.get("line_height", root["line_height"])
    return {
        "font_size": float(part_obj.get("font_size", root["font_size"])),
        "bold": bool(part_obj.get("bold", root["bold"])),
        "italic": bool(part_obj.get("italic", root["italic"])),
        "underline": bool(part_obj.get("underline", root["underline"])),
        "line_height": line_height,
    }


def _uses_label_value_renderer(el: dict[str, Any]) -> bool:
    return "label" in el or "value" in el


def _should_show_label(el: dict[str, Any]) -> bool:
    label = el.get("label")
    if not label:
        return False
    return bool(label.get("show"))


def _value_force_wrap(el: dict[str, Any]) -> bool:
    if _uses_label_value_renderer(el):
        return bool((el.get("value") or {}).get("force_wrap"))
    return bool(el.get("wrap"))


def _layout_box(el: dict[str, Any], page_h: float) -> dict[str, Any]:
    """Общая геометрия текстового блока (отступы, ширина, выравнивание)."""
    x_mm = float(el.get("x", 0))
    y_mm = float(el.get("y", 0))
    pad_left = float(el.get("padding_left", 0)) * mm
    pad_right = float(el.get("padding_right", 0)) * mm
    pad_top = float(el.get("padding_top", 0)) * mm

    x = x_mm * mm
    first_baseline_y = page_h - (y_mm * mm + pad_top)

    max_width_mm = el.get("max_width")
    block_width_mm = el.get("width")
    raw_width_mm = float(max_width_mm or block_width_mm or 0)
    content_width = max(0.0, raw_width_mm * mm - pad_left - pad_right)

    text_align = el.get("text_align", "left")
    if text_align in ("center", "right") and raw_width_mm <= 0:
        text_align = "left"

    return {
        "x": x,
        "area_left": x + pad_left,
        "content_width": content_width,
        "raw_width_mm": raw_width_mm,
        "text_align": text_align,
        "first_baseline_y": first_baseline_y,
    }


def _leading_for_style(style: dict[str, Any]) -> float:
    font_size = style["font_size"]
    lh = style.get("line_height")
    if lh is not None and float(lh) > 0:
        return float(lh)
    return font_size * 1.2


def _wrap_text_first_line_narrower(
    text: str,
    font_name: str,
    font_size: float,
    first_line_width: float,
    subsequent_width: float,
) -> list[str]:
    """Перенос значения: первая строка уже (inline-подпись), остальные — полная ширина."""
    if not text:
        return []
    if first_line_width <= 0 and subsequent_width <= 0:
        return [text]

    words = text.split()
    if not words:
        return [text]

    lines: list[str] = []
    current = ""
    line_index = 0

    def max_w_for_line(idx: int) -> float:
        return first_line_width if idx == 0 else subsequent_width

    for word in words:
        max_w = max_w_for_line(line_index)
        if max_w <= 0:
            if current:
                lines.append(current)
                line_index += 1
                current = ""
            lines.append(word)
            line_index += 1
            continue

        candidate = f"{current} {word}".strip() if current else word
        if stringWidth(candidate, font_name, font_size) <= max_w:
            current = candidate
            continue

        if current:
            lines.append(current)
            line_index += 1
            current = word
        else:
            lines.append(_truncate_to_width(word, font_name, font_size, max_w))
            line_index += 1
            current = ""

        max_w = max_w_for_line(line_index)
        if current and max_w > 0 and stringWidth(current, font_name, font_size) > max_w:
            lines.append(_truncate_to_width(current, font_name, font_size, max_w))
            line_index += 1
            current = ""

    if current:
        lines.append(current)
    return lines


def _draw_styled_lines(
    c: canvas.Canvas,
    lines: list[str],
    start_y: float,
    layout: dict[str, Any],
    style: dict[str, Any],
    y_decreases: bool = True,
) -> float:
    """Рисует строки с заданным стилем; возвращает Y после последней строки."""
    font_name = resolve_font(bold=style["bold"], italic=style["italic"])
    font_size = style["font_size"]
    leading = _leading_for_style(style)
    c.setFont(font_name, font_size)

    y = start_y
    for i, line in enumerate(lines):
        line_y = y - i * leading if y_decreases else y + i * leading
        _draw_text_line(
            c,
            line,
            line_y,
            layout["area_left"],
            layout["content_width"] if layout["raw_width_mm"] > 0 else 0.0,
            layout["text_align"],
            font_name,
            font_size,
            style["underline"],
        )

    if not lines:
        return start_y
    last_index = len(lines) - 1
    return start_y - last_index * leading if y_decreases else start_y + last_index * leading


def _draw_label_value_text(
    c: canvas.Canvas,
    el: dict[str, Any],
    label_text: str | None,
    value_text: str,
    page_h: float,
) -> None:
    if not (label_text or value_text.strip()):
        return

    layout = _layout_box(el, page_h)
    label_style = _resolve_part_style(el, "label")
    value_style = _resolve_part_style(el, "value")
    value_font = resolve_font(bold=value_style["bold"], italic=value_style["italic"])
    value_size = value_style["font_size"]
    value_leading = _leading_for_style(value_style)

    # Смещение первой базовой линии под ReportLab (как в _draw_resolved_text).
    y = layout["first_baseline_y"] - value_size * 0.35 * mm

    if not label_text:
        do_wrap = _value_force_wrap(el)
        content_width = layout["content_width"]
        if do_wrap and content_width > 0:
            lines = wrap_text(value_text, value_font, value_size, content_width)
        else:
            line = value_text
            if content_width > 0:
                line = _truncate_to_width(line, value_font, value_size, content_width)
            elif el.get("max_width"):
                max_w = float(el["max_width"]) * mm
                line = _truncate_to_width(line, value_font, value_size, max_w)
            lines = [line]
        _draw_styled_lines(c, lines, y, layout, value_style)
        return

    label_obj = el.get("label") or {}
    separate_line = bool(label_obj.get("inline"))

    if separate_line:
        label_font = resolve_font(bold=label_style["bold"], italic=label_style["italic"])
        label_size = label_style["font_size"]
        label_leading = _leading_for_style(label_style)

        label_line = label_text
        if layout["content_width"] > 0:
            label_line = _truncate_to_width(
                label_line, label_font, label_size, layout["content_width"]
            )

        _draw_styled_lines(c, [label_line], y, layout, label_style)
        y -= label_leading

        do_wrap = _value_force_wrap(el)
        content_width = layout["content_width"]
        if do_wrap and content_width > 0:
            value_lines = wrap_text(value_text, value_font, value_size, content_width)
        else:
            line = value_text
            if content_width > 0:
                line = _truncate_to_width(line, value_font, value_size, content_width)
            value_lines = [line]
        _draw_styled_lines(c, value_lines, y, layout, value_style)
        return

    # Inline: подпись и значение в одну строку (значение переносится с учётом подписи).
    label_font = resolve_font(bold=label_style["bold"], italic=label_style["italic"])
    label_size = label_style["font_size"]
    prefix = f"{label_text} "
    prefix_width = stringWidth(prefix, label_font, label_size)

    content_width = layout["content_width"]
    do_wrap = _value_force_wrap(el)

    if do_wrap and content_width > 0:
        first_w = max(0.0, content_width - prefix_width)
        value_lines = _wrap_text_first_line_narrower(
            value_text,
            value_font,
            value_size,
            first_w,
            content_width,
        )
    else:
        value_line = value_text
        if content_width > 0:
            avail = max(0.0, content_width - prefix_width)
            if avail > 0:
                value_line = _truncate_to_width(value_line, value_font, value_size, avail)
        elif el.get("max_width"):
            max_w = float(el["max_width"]) * mm - prefix_width
            if max_w > 0:
                value_line = _truncate_to_width(value_line, value_font, value_size, max_w)
        value_lines = [value_line]

    for i, line in enumerate(value_lines):
        line_y = y - i * value_leading
        if i == 0 and prefix:
            label_y = line_y + (value_size - label_size) * 0.08
            c.setFont(label_font, label_size)
            c.drawString(layout["area_left"], label_y, prefix.rstrip())
            if label_style["underline"]:
                text_width = stringWidth(label_text, label_font, label_size)
                underline_y = label_y - label_size * 0.12
                c.setLineWidth(max(0.3, label_size * 0.06))
                c.line(layout["area_left"], underline_y, layout["area_left"] + text_width, underline_y)
            c.setFont(value_font, value_size)
            value_x = layout["area_left"] + prefix_width
            value_line = line
            avail = max(0.0, content_width - prefix_width) if content_width > 0 else 0.0
            align = layout["text_align"] if i == len(value_lines) - 1 else "left"
            _draw_text_line(
                c,
                value_line,
                line_y,
                value_x,
                avail,
                align if avail > 0 else "left",
                value_font,
                value_size,
                value_style["underline"],
            )
        else:
            c.setFont(value_font, value_size)
            _draw_text_line(
                c,
                line,
                line_y,
                layout["area_left"],
                content_width if layout["raw_width_mm"] > 0 else 0.0,
                layout["text_align"],
                value_font,
                value_size,
                value_style["underline"],
            )


def _truncate_to_width(text: str, font_name: str, font_size: float, max_width: float) -> str:
    """Обрезает строку с конца, пока не влезет в max_width (pt)."""
    while stringWidth(text, font_name, font_size) > max_width and len(text) > 1:
        text = text[:-1]
    return text


def wrap_text(text: str, font_name: str, font_size: float, max_width: float) -> list[str]:
    """Перенос по словам; слово шире max_width обрезается с конца (как раньше)."""
    if not text:
        return []
    if max_width <= 0:
        return [text]

    words = text.split()
    if not words:
        return [text]

    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip() if current else word
        if stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = word
        else:
            lines.append(_truncate_to_width(word, font_name, font_size, max_width))
            current = ""
        if current and stringWidth(current, font_name, font_size) > max_width:
            lines.append(_truncate_to_width(current, font_name, font_size, max_width))
            current = ""

    if current:
        lines.append(current)
    return lines


def _draw_text_line(
    c: canvas.Canvas,
    line: str,
    line_y: float,
    area_left: float,
    content_width: float,
    text_align: str,
    font_name: str,
    font_size: float,
    is_underline: bool,
) -> None:
    if text_align == "center" and content_width > 0:
        c.drawCentredString(area_left + content_width / 2, line_y, line)
        line_left = area_left + (content_width - stringWidth(line, font_name, font_size)) / 2
    elif text_align == "right" and content_width > 0:
        c.drawRightString(area_left + content_width, line_y, line)
        line_left = area_left + content_width - stringWidth(line, font_name, font_size)
    else:
        c.drawString(area_left, line_y, line)
        line_left = area_left

    if is_underline:
        text_width = stringWidth(line, font_name, font_size)
        underline_y = line_y - font_size * 0.12
        c.setLineWidth(max(0.3, font_size * 0.06))
        c.line(line_left, underline_y, line_left + text_width, underline_y)


def _draw_resolved_text(
    c: canvas.Canvas,
    el: dict[str, Any],
    text: str,
    page_h: float,
) -> None:
    """Рендер однострочного/многострочного текста (legacy, без label/value)."""
    if not text.strip():
        return

    font_size = float(el.get("font_size", 6))
    is_bold = bool(el.get("bold"))
    is_italic = bool(el.get("italic"))
    is_underline = bool(el.get("underline"))
    font_name = resolve_font(bold=is_bold, italic=is_italic)
    c.setFont(font_name, font_size)

    layout = _layout_box(el, page_h)
    first_baseline_y = layout["first_baseline_y"] - font_size * 0.35 * mm

    content_width = layout["content_width"]
    text_align = layout["text_align"]
    area_left = layout["area_left"]
    raw_width_mm = layout["raw_width_mm"]

    do_wrap = bool(el.get("wrap"))
    leading = float(el.get("line_height", font_size * 1.2))

    if do_wrap and content_width > 0:
        lines = wrap_text(text, font_name, font_size, content_width)
    else:
        line = text
        if content_width > 0:
            line = _truncate_to_width(line, font_name, font_size, content_width)
        elif el.get("max_width"):
            max_w = float(el["max_width"]) * mm
            line = _truncate_to_width(line, font_name, font_size, max_w)
        lines = [line]

    for i, line in enumerate(lines):
        line_y = first_baseline_y - i * leading
        _draw_text_line(
            c,
            line,
            line_y,
            area_left,
            content_width if raw_width_mm > 0 else 0.0,
            text_align,
            font_name,
            font_size,
            is_underline,
        )


def _pdf_text(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    gtin: str | None,
    ef: Any,
    page_h: float,
    product_card: Any = None,
    _image_cache: dict[str, bytes] | None = None,
    _print_context: PrintContext | None = None,
) -> None:
    el = merge_element_defaults(el)
    ctx = FieldResolveContext(
        code=code,
        gtin=gtin,
        extra_fields=ef,
        product_card=product_card,
        print_context=_print_context,
    )
    value_text = substitute_text(el.get("text", ""), ctx)
    if _uses_label_value_renderer(el):
        label_text = None
        if _should_show_label(el):
            label_text = str((el.get("label") or {}).get("text", ""))
        _draw_label_value_text(c, el, label_text, value_text, page_h)
    else:
        _draw_resolved_text(c, el, value_text, page_h)


def _pdf_field(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    gtin: str | None,
    ef: Any,
    page_h: float,
    product_card: Any = None,
    _image_cache: dict[str, bytes] | None = None,
    _print_context: PrintContext | None = None,
) -> None:
    el = merge_element_defaults(el)
    ctx = FieldResolveContext(
        code=code,
        gtin=gtin,
        extra_fields=ef,
        product_card=product_card,
        print_context=_print_context,
    )
    field_key = str(el.get("field_key", ""))
    value_text = resolve_field(field_key, ctx)
    if _uses_label_value_renderer(el):
        label_text = None
        if _should_show_label(el):
            dynamic_label = resolve_field_block_label(field_key, ctx)
            if dynamic_label is not None:
                label_text = dynamic_label
            else:
                label_text = str((el.get("label") or {}).get("text", ""))
        _draw_label_value_text(c, el, label_text, value_text, page_h)
    else:
        _draw_resolved_text(c, el, value_text, page_h)


def _pdf_line(
    c: canvas.Canvas,
    el: dict[str, Any],
    _code: str,
    _gtin: str | None,
    _ef: Any,
    page_h: float,
    _product_card: Any = None,
    _image_cache: dict[str, bytes] | None = None,
    _print_context: PrintContext | None = None,
) -> None:
    el = merge_element_defaults(el)
    x1 = float(el.get("x1", el.get("x", 0))) * mm
    y1 = page_h - float(el.get("y1", el.get("y", 0))) * mm
    x2 = float(el.get("x2", 0)) * mm
    y2 = page_h - float(el.get("y2", el.get("y", 0))) * mm
    c.setLineWidth(0.5)
    c.line(x1, y1, x2, y2)


def _pdf_sign(
    c: canvas.Canvas,
    el: dict[str, Any],
    _code: str,
    _gtin: str | None,
    _ef: Any,
    page_h: float,
    _product_card: Any = None,
    _image_cache: dict[str, bytes] | None = None,
    _print_context: PrintContext | None = None,
) -> None:
    from reportlab.lib.utils import ImageReader

    el = merge_element_defaults(el)
    sign_key = el.get("sign_key")
    if not sign_key:
        logger.warning("Блок sign без sign_key, пропуск")
        return

    png_path = resolve_sign_path(str(sign_key))
    if png_path is None:
        logger.warning("Неизвестный sign_key %r, пропуск", sign_key)
        return

    w_mm = float(el.get("width", 10))
    h_mm = float(el.get("height", 10))
    x_mm = float(el.get("x", 0))
    y_mm = float(el.get("y", 0))
    w = w_mm * mm
    h = h_mm * mm
    x = x_mm * mm
    y = page_h - y_mm * mm - h

    c.drawImage(
        ImageReader(str(png_path)),
        x,
        y,
        w,
        h,
        preserveAspectRatio=True,
        mask="auto",
    )


def _pdf_image(
    c: canvas.Canvas,
    el: dict[str, Any],
    _code: str,
    _gtin: str | None,
    _ef: Any,
    page_h: float,
    _product_card: Any = None,
    image_cache: dict[str, bytes] | None = None,
    _print_context: PrintContext | None = None,
) -> None:
    from reportlab.lib.utils import ImageReader

    el = merge_element_defaults(el)
    image_id = str(el.get("image_id") or "").strip()
    if not image_id:
        logger.warning("Блок image без image_id, пропуск")
        return

    data = (image_cache or {}).get(image_id)
    if not data:
        logger.warning("Изображение %s не найдено в кэше, пропуск", image_id)
        return

    w_mm = float(el.get("width", 15))
    h_mm = float(el.get("height", 15))
    x_mm = float(el.get("x", 0))
    y_mm = float(el.get("y", 0))
    w = w_mm * mm
    h = h_mm * mm
    x = x_mm * mm
    y = page_h - y_mm * mm - h

    try:
        c.drawImage(
            ImageReader(BytesIO(data)),
            x,
            y,
            w,
            h,
            preserveAspectRatio=True,
            mask="auto",
        )
    except Exception as e:
        logger.warning("Ошибка рендера image %s: %s", image_id, e)


PDF_RENDERERS: dict[str, PdfRenderFn] = {
    "datamatrix": _pdf_datamatrix,
    "barcode_ean13": _pdf_barcode_ean13,
    "barcode_code128": _pdf_barcode_code128,
    "text": _pdf_text,
    "field": _pdf_field,
    "line": _pdf_line,
    "sign": _pdf_sign,
    "image": _pdf_image,
}


def draw_element_from_template(
    c: canvas.Canvas,
    el: dict[str, Any],
    code: str,
    gtin: str | None,
    ef: Any,
    page_h: float,
    product_card: Any = None,
    image_cache: dict[str, bytes] | None = None,
    print_context: PrintContext | None = None,
) -> None:
    """Отрисовывает один элемент шаблона через реестр."""
    el_type = el.get("type")
    if el_type == "barcode_ean13":
        barcode_type = _barcode_print_options(print_context)["barcode_type"]
        if barcode_type == "code128":
            el_type = "barcode_code128"
    renderer = PDF_RENDERERS.get(el_type)
    if renderer is None:
        logger.warning("Неизвестный тип блока этикетки, пропуск: %r", el_type)
        return
    renderer(c, el, code, gtin, ef, page_h, product_card, image_cache, print_context)
