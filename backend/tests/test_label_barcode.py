"""Тесты баркод-блока: Code128, резолв источника, ведущий ноль."""
from __future__ import annotations

import io
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from reportlab.pdfgen import canvas

from labels.block_registry import draw_element_from_template
from labels.field_catalog import (
    FieldResolveContext,
    PrintContext,
    resolve_barcode_value,
)


def _make_canvas() -> tuple[canvas.Canvas, io.BytesIO]:
    buf = io.BytesIO()
    return canvas.Canvas(buf, pagesize=(200, 200)), buf


def test_resolve_barcode_gtin_default_ean13():
    ctx = FieldResolveContext(code="01" + "0" * 14, gtin="00464912345678", extra_fields=None)
    assert (
        resolve_barcode_value(
            ctx,
            barcode_type="ean13",
            barcode_column="gtin",
            barcode_keep_leading_zero=True,
        )
        == "0046491234567"
    )


def test_resolve_barcode_gtin_drop_leading_zero_for_ean13():
    ctx = FieldResolveContext(code="", gtin="00464912345678", extra_fields=None)
    assert (
        resolve_barcode_value(
            ctx,
            barcode_type="ean13",
            barcode_column="gtin",
            barcode_keep_leading_zero=False,
        )
        == "0464912345678"
    )


def test_resolve_barcode_from_extra_fields_column():
    ef = SimpleNamespace(barcode="4601234567890")
    ctx = FieldResolveContext(code="", gtin="02900004064948", extra_fields=ef)
    assert (
        resolve_barcode_value(
            ctx,
            barcode_type="ean13",
            barcode_column="barcode",
        )
        == "4601234567890"
    )


def test_resolve_barcode_from_catalog_extra_field_code128():
    ef = SimpleNamespace(extra={"product_code": "ABC-42"})
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef)
    assert (
        resolve_barcode_value(
            ctx,
            barcode_type="code128",
            barcode_column="user_product_code",
            barcode_from_extra=True,
        )
        == "ABC-42"
    )


def test_resolve_barcode_kitu_code_column():
    ctx = FieldResolveContext(
        code="460000000123456789",
        gtin=None,
        extra_fields=None,
        print_context=PrintContext(
            label_index=0,
            label_number=1,
            total=1,
            kitu_code="460000000123456789",
        ),
    )
    assert (
        resolve_barcode_value(
            ctx,
            barcode_type="code128",
            barcode_column="kitu_code",
        )
        == "460000000123456789"
    )


def test_resolve_barcode_empty_returns_none():
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=None)
    assert resolve_barcode_value(ctx) is None


def test_draw_barcode_ean13_skipped_when_no_value():
    c = MagicMock()
    el = {"type": "barcode_ean13", "x": 5, "y": 5, "width": 38, "height": 15}
    draw_element_from_template(c, el, "code", None, None, 200.0)
    c.saveState.assert_not_called()


def test_draw_barcode_code128_from_gtin_print_option():
    c, buf = _make_canvas()
    el = {"type": "barcode_ean13", "x": 5, "y": 5, "width": 38, "height": 15}
    print_ctx = PrintContext(
        label_index=0,
        label_number=1,
        total=1,
        barcode_type="code128",
        barcode_column="gtin",
    )
    with patch("reportlab.graphics.barcode.code128.Code128.drawOn") as mock_draw:
        draw_element_from_template(
            c,
            el,
            "01" + "0" * 14,
            "02900004064948",
            None,
            200.0,
            None,
            None,
            print_ctx,
        )
        c.save()
    mock_draw.assert_called_once()


def test_draw_barcode_ean13_unchanged_with_defaults():
    c, buf = _make_canvas()
    el = {"type": "barcode_ean13", "x": 5, "y": 5, "width": 38, "height": 15}
    with patch("reportlab.graphics.renderPDF.draw") as mock_render:
        draw_element_from_template(
            c,
            el,
            "01" + "0" * 14,
            "02900004064948",
            None,
            200.0,
        )
        c.save()
    mock_render.assert_called_once()
