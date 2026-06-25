"""PDF с системными штрихкодами СТАРТ/КОНЕЦ для режима агрегации после сборки."""
from __future__ import annotations

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.graphics.barcode.code128 import Code128
from reportlab.pdfgen import canvas

from aggregation_system_codes import SYSTEM_BARCODE_ITEMS
from labels.font_registry import register_fonts, resolve_font


def build_aggregation_system_barcodes_pdf() -> bytes:
    """Одна страница A4: два Code128 (СТАРТ и КОНЕЦ) с подписями."""
    register_fonts()
    buf = io.BytesIO()
    page_w, page_h = A4
    c = canvas.Canvas(buf, pagesize=A4)

    section_h = page_h / len(SYSTEM_BARCODE_ITEMS)
    label_font = resolve_font(bold=True)
    code_font = resolve_font()

    for index, (barcode_value, caption) in enumerate(SYSTEM_BARCODE_ITEMS):
        section_top = page_h - index * section_h
        section_center_y = section_top - section_h / 2

        c.setFont(label_font, 18)
        c.drawCentredString(page_w / 2, section_center_y + 18 * mm, caption)

        bar_height = 22 * mm
        barcode = Code128(barcode_value, barHeight=bar_height)
        barcode.validate()
        bar_width = min(float(barcode.width), page_w * 0.75)
        if float(barcode.width) > 0:
            barcode.barWidth = max(bar_width / float(barcode.width), 0.25 * mm)
        bar_x = (page_w - bar_width) / 2
        bar_y = section_center_y - 8 * mm
        barcode.drawOn(c, bar_x, bar_y)

        c.setFont(code_font, 10)
        c.drawCentredString(page_w / 2, bar_y - 6 * mm, barcode_value)

        if index < len(SYSTEM_BARCODE_ITEMS) - 1:
            c.setDash(4, 4)
            c.line(20 * mm, section_top - section_h, page_w - 20 * mm, section_top - section_h)
            c.setDash()

    c.save()
    return buf.getvalue()
