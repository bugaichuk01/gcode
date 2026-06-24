"""Тесты выравнивания, отступов, переноса и leading в PDF-рендере текста."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth

from labels.block_registry import draw_element_from_template, wrap_text
from labels.font_registry import register_fonts, resolve_font


@pytest.fixture(autouse=True)
def _ensure_fonts_registered():
    register_fonts()


def _draw(el: dict) -> MagicMock:
    c = MagicMock()
    draw_element_from_template(c, el, "", None, None, 100.0)
    return c


def test_wrap_text_splits_by_words():
    font = resolve_font()
    size = 6.0
    max_w = stringWidth("one two", font, size)
    lines = wrap_text("one two three four", font, size, max_w)
    assert len(lines) >= 2
    assert "one two" in lines[0] or lines[0] == "one"


def test_wrap_long_word_truncated():
    font = resolve_font()
    size = 6.0
    word = "Абвгдежзийклмнопрстуфхцчшщъыьэюя"
    max_w = stringWidth("Абв", font, size)
    lines = wrap_text(word, font, size, max_w)
    assert len(lines) == 1
    assert stringWidth(lines[0], font, size) <= max_w + 0.01


def test_legacy_single_line_truncation_unchanged():
    c = _draw(
        {
            "type": "text",
            "x": 1,
            "y": 2,
            "text": "Очень длинный текст без переноса",
            "font_size": 6,
            "max_width": 10,
        }
    )
    c.drawString.assert_called_once()
    c.drawCentredString.assert_not_called()
    c.drawRightString.assert_not_called()
    drawn = c.drawString.call_args[0][2]
    assert len(drawn) < len("Очень длинный текст без переноса")


def test_wrap_draws_multiple_lines():
    c = _draw(
        {
            "type": "text",
            "x": 1,
            "y": 2,
            "text": "первая вторая третья четвёртая",
            "font_size": 6,
            "max_width": 12,
            "wrap": True,
        }
    )
    assert c.drawString.call_count >= 2
    y_positions = [call_args[0][1] for call_args in c.drawString.call_args_list]
    assert y_positions[0] > y_positions[1]


def test_text_align_center():
    c = _draw(
        {
            "type": "text",
            "x": 1,
            "y": 2,
            "text": "Центр",
            "font_size": 6,
            "max_width": 20,
            "text_align": "center",
        }
    )
    c.drawCentredString.assert_called_once()
    c.drawString.assert_not_called()


def test_text_align_right():
    c = _draw(
        {
            "type": "text",
            "x": 1,
            "y": 2,
            "text": "Право",
            "font_size": 6,
            "max_width": 20,
            "text_align": "right",
        }
    )
    c.drawRightString.assert_called_once()


def test_align_without_width_falls_back_to_left():
    c = _draw(
        {
            "type": "text",
            "x": 1,
            "y": 2,
            "text": "Без ширины",
            "font_size": 6,
            "text_align": "center",
        }
    )
    c.drawString.assert_called_once()
    c.drawCentredString.assert_not_called()


def test_padding_left_shifts_draw_x():
    c = _draw(
        {
            "type": "text",
            "x": 1,
            "y": 2,
            "text": "Отступ",
            "font_size": 6,
            "padding_left": 5,
        }
    )
    x_no_pad = 1 * mm
    x_with_pad = 1 * mm + 5 * mm
    assert c.drawString.call_args[0][0] == pytest.approx(x_with_pad)
    assert c.drawString.call_args[0][0] > x_no_pad


def test_underline_per_wrapped_line():
    c = _draw(
        {
            "type": "text",
            "x": 1,
            "y": 2,
            "text": "строка один два три четыре",
            "font_size": 6,
            "max_width": 10,
            "wrap": True,
            "underline": True,
        }
    )
    assert c.line.call_count >= 2
    assert c.drawString.call_count >= 2
