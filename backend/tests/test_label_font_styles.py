"""Тесты шрифтов DejaVu, кириллицы и стилей B/I/U в PDF-рендере этикеток."""
from __future__ import annotations

import io
import logging
from unittest.mock import MagicMock

import pytest
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from labels.block_registry import draw_element_from_template
from labels.font_registry import (
    fonts_registered,
    register_fonts,
    registered_font_count,
    resolve_font,
)


@pytest.fixture(autouse=True)
def _ensure_fonts_registered():
    register_fonts()


def _render_text_pdf(el: dict) -> bytes:
    buf = io.BytesIO()
    page_h = 40 * mm
    c = canvas.Canvas(buf, pagesize=(58 * mm, page_h))
    draw_element_from_template(c, el, "", None, None, page_h)
    c.save()
    return buf.getvalue()


def test_register_fonts_registers_all_four_variants(caplog):
    import labels.font_registry as fr

    fr._fonts_registered = False
    fr._registered_count = 0
    with caplog.at_level(logging.INFO):
        ok = register_fonts()
    assert ok is True
    assert fonts_registered() is True
    assert registered_font_count() == 4
    assert any("4 начертания" in r.message for r in caplog.records)


def test_resolve_font_matrix():
    assert resolve_font() == "DejaVu"
    assert resolve_font(bold=True) == "DejaVuBold"
    assert resolve_font(italic=True) == "DejaVuOblique"
    assert resolve_font(bold=True, italic=True) == "DejaVuBoldOblique"


def test_cyrillic_pdf_uses_dejavu_not_helvetica():
    text = "Состав: 100% хлопок"
    pdf = _render_text_pdf(
        {
            "type": "text",
            "x": 2,
            "y": 2,
            "text": text,
            "font_size": 8,
        }
    )
    assert b"DejaVu" in pdf
    assert b"ToUnicode" in pdf
    assert len(pdf) > 10_000

    import labels.font_registry as fr

    saved_registered = fr._fonts_registered
    saved_count = fr._registered_count
    try:
        fr._fonts_registered = False
        fr._registered_count = 0
        fallback_pdf = _render_text_pdf(
            {
                "type": "text",
                "x": 2,
                "y": 2,
                "text": text,
                "font_size": 8,
            }
        )
        assert len(pdf) > len(fallback_pdf) * 5
        assert b"DejaVu" not in fallback_pdf
    finally:
        fr._fonts_registered = saved_registered
        fr._registered_count = saved_count


def test_italic_uses_oblique_font():
    c = MagicMock()
    el = {
        "type": "text",
        "x": 1,
        "y": 2,
        "text": "Курсив",
        "font_size": 6,
        "italic": True,
    }
    draw_element_from_template(c, el, "", None, None, 100.0)
    c.setFont.assert_called_with("DejaVuOblique", 6.0)


def test_bold_italic_uses_bold_oblique_font():
    c = MagicMock()
    el = {
        "type": "text",
        "x": 1,
        "y": 2,
        "text": "Жирный курсив",
        "font_size": 6,
        "bold": True,
        "italic": True,
    }
    draw_element_from_template(c, el, "", None, None, 100.0)
    c.setFont.assert_called_with("DejaVuBoldOblique", 6.0)


def test_underline_draws_line_under_text():
    c = MagicMock()
    el = {
        "type": "text",
        "x": 1,
        "y": 2,
        "text": "Подчёркнутый",
        "font_size": 6,
        "underline": True,
    }
    draw_element_from_template(c, el, "", None, None, 100.0)
    c.drawString.assert_called_once()
    c.line.assert_called_once()
    line_args = c.line.call_args[0]
    assert line_args[2] > line_args[0]


def test_legacy_block_without_italic_underline_uses_normal():
    c = MagicMock()
    el = {"type": "text", "x": 1, "y": 2, "text": "Обычный", "font_size": 6}
    draw_element_from_template(c, el, "", None, None, 100.0)
    c.setFont.assert_called_with("DejaVu", 6.0)
    c.line.assert_not_called()


def test_bold_without_italic_uses_bold_font():
    c = MagicMock()
    el = {
        "type": "text",
        "x": 1,
        "y": 2,
        "text": "Жирный",
        "font_size": 6,
        "bold": True,
    }
    draw_element_from_template(c, el, "", None, None, 100.0)
    c.setFont.assert_called_with("DejaVuBold", 6.0)
