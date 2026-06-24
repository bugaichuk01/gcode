"""Тесты контекста печати и поля «Номер этикетки»."""
from __future__ import annotations

import io

from reportlab.pdfgen import canvas

from labels.block_registry import draw_element_from_template
from labels.field_catalog import FieldResolveContext, PrintContext, resolve_field


def _make_canvas() -> tuple[canvas.Canvas, io.BytesIO]:
    buf = io.BytesIO()
    return canvas.Canvas(buf, pagesize=(200, 200)), buf


def test_resolve_field_label_number_from_print_context():
    ctx = FieldResolveContext(
        code="",
        gtin=None,
        extra_fields=None,
        print_context=PrintContext(label_index=4, label_number=105, total=10),
    )
    assert resolve_field("label_number", ctx) == "105"


def test_resolve_field_label_number_empty_without_context():
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=None)
    assert resolve_field("label_number", ctx) == ""


def test_draw_field_label_number_in_pdf():
    c, _ = _make_canvas()
    el = {
        "type": "field",
        "field_key": "label_number",
        "x": 5,
        "y": 5,
        "font_size": 10,
    }
    print_ctx = PrintContext(label_index=2, label_number=103, total=5)
    draw_element_from_template(c, el, "code", None, None, 200.0, None, None, print_ctx)
    c.save()
