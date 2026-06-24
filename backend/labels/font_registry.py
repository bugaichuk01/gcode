"""Регистрация DejaVu-шрифтов для PDF-рендера этикеток."""
from __future__ import annotations

import logging
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

logger = logging.getLogger(__name__)

_FONTS_DIR = Path(__file__).resolve().parent / "fonts"
_SYSTEM_FONTS_DIR = Path("/usr/share/fonts/truetype/dejavu")

_FONT_VARIANTS: tuple[tuple[str, str], ...] = (
    ("DejaVu", "DejaVuSans.ttf"),
    ("DejaVuBold", "DejaVuSans-Bold.ttf"),
    ("DejaVuOblique", "DejaVuSans-Oblique.ttf"),
    ("DejaVuBoldOblique", "DejaVuSans-BoldOblique.ttf"),
)

_fonts_registered = False
_registered_count = 0


def _find_font_path(filename: str) -> Path | None:
    bundled = _FONTS_DIR / filename
    if bundled.is_file() and bundled.stat().st_size > 0:
        return bundled
    system = _SYSTEM_FONTS_DIR / filename
    if system.is_file():
        return system
    return None


def register_fonts() -> bool:
    """Регистрирует 4 начертания DejaVu. Возвращает True, если все 4 доступны."""
    global _fonts_registered, _registered_count
    if _fonts_registered:
        return True

    _registered_count = 0
    for font_name, filename in _FONT_VARIANTS:
        path = _find_font_path(filename)
        if path is None:
            logger.error(
                "Файл шрифта %s не найден (ожидался в %s или %s)",
                filename,
                _FONTS_DIR,
                _SYSTEM_FONTS_DIR,
            )
            continue
        try:
            pdfmetrics.registerFont(TTFont(font_name, str(path)))
            _registered_count += 1
            logger.debug("Зарегистрирован шрифт %s из %s", font_name, path)
        except Exception as exc:
            logger.error(
                "Не удалось зарегистрировать шрифт %s (%s): %s",
                font_name,
                path,
                exc,
            )

    if _registered_count == len(_FONT_VARIANTS):
        _fonts_registered = True
        logger.info("DejaVu: зарегистрированы 4 начертания для PDF-этикеток")
    elif _registered_count > 0:
        logger.warning(
            "DejaVu: зарегистрировано только %d/%d начертаний",
            _registered_count,
            len(_FONT_VARIANTS),
        )
    else:
        logger.error(
            "DejaVu-шрифты недоступны — кириллица в PDF будет отображаться некорректно"
        )
    return _fonts_registered


def fonts_registered() -> bool:
    return _fonts_registered


def registered_font_count() -> int:
    return _registered_count


def resolve_font(bold: bool = False, italic: bool = False) -> str:
    """Возвращает имя шрифта по матрице bold/italic."""
    if not _fonts_registered:
        logger.warning(
            "DejaVu не зарегистрирован — fallback на Helvetica "
            "(кириллица может отображаться некорректно)"
        )
        if bold and italic:
            return "Helvetica-BoldOblique"
        if bold:
            return "Helvetica-Bold"
        if italic:
            return "Helvetica-Oblique"
        return "Helvetica"

    if bold and italic:
        return "DejaVuBoldOblique"
    if bold:
        return "DejaVuBold"
    if italic:
        return "DejaVuOblique"
    return "DejaVu"
