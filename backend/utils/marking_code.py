"""Разбор и валидация кодов маркировки (КМ) — GS1 AI 01/21/91/92."""

from __future__ import annotations

import re

GS_SEPARATOR = "\x1d"

# Fallback, если структурный разбор не выявил криптохвост (единый порог для всего проекта).
MARKING_CODE_MIN_LENGTH_WITH_CRYPTO_TAIL = 50

CRYPTO_TAIL_PRINT_ERROR = (
    "Короткие коды без криптохвоста печатать нельзя. "
    "Загрузите исходные файлы с длинными кодами."
)

_FULL_KM_PATTERN = re.compile(
    r"^(01\d{14})"
    r"(21.+?)"
    r"(91[A-F0-9]{4})"
    r"(92.+)$",
    re.IGNORECASE,
)


def _find_crypto_segment_indices(code: str) -> tuple[int, int] | None:
    """Найти позиции сегментов AI 91 и AI 92, либо None."""
    if GS_SEPARATOR in code:
        parts = code.split(GS_SEPARATOR)
        for i, part in enumerate(parts[1:], start=1):
            if part.upper().startswith("91") and len(part) >= 6:
                idx_91 = code.find(part)
                if i + 1 < len(parts) and parts[i + 1].upper().startswith("92"):
                    return idx_91, code.find(parts[i + 1])
                return idx_91, -1
        return None

    m = _FULL_KM_PATTERN.match(code)
    if m:
        return m.start(3), m.start(4)

    idx_91 = code.find("91FFD0")
    if idx_91 == -1:
        for i in range(30, len(code) - 6):
            if code[i : i + 2] == "91" and code[i + 6 : i + 8] == "92":
                idx_91 = i
                break
    if idx_91 > 0:
        idx_92 = code.find("92", idx_91 + 4)
        if idx_92 > 0:
            return idx_91, idx_92
    return None


def has_crypto_tail(code: str) -> bool:
    """True, если в коде маркировки присутствует криптохвост (AI 91 / 92)."""
    trimmed = (code or "").strip()
    if not trimmed:
        return False
    if _find_crypto_segment_indices(trimmed) is not None:
        return True
    return len(trimmed) >= MARKING_CODE_MIN_LENGTH_WITH_CRYPTO_TAIL


def normalize_marking_code(code: str) -> str:
    """Вставить GS-разделители перед сегментами 91/92, если их нет."""
    if GS_SEPARATOR in code:
        return code

    m = _FULL_KM_PATTERN.match(code)
    if m:
        part1 = m.group(1) + m.group(2)
        part2 = m.group(3)
        part3 = m.group(4)
        return f"{part1}{GS_SEPARATOR}{part2}{GS_SEPARATOR}{part3}"

    indices = _find_crypto_segment_indices(code)
    if indices is not None:
        idx_91, idx_92 = indices
        if idx_92 > 0:
            return f"{code[:idx_91]}{GS_SEPARATOR}{code[idx_91:idx_92]}{GS_SEPARATOR}{code[idx_92:]}"
    return code


def codes_without_crypto_tail(codes: list[str]) -> list[str]:
    return [c for c in codes if not has_crypto_tail(c)]


def get_short_cis(code: str) -> str:
    """Человекочитаемый КМ: (01)GTIN(21)serial без криптохвоста (91/92).

  Обрезает полный код до сегмента перед первым GS или перед AI 91.
  Возвращает только видимые символы (без управляющих GS).
    """
    trimmed = (code or "").strip()
    if not trimmed:
        return ""
    if GS_SEPARATOR in trimmed:
        short = trimmed.split(GS_SEPARATOR)[0]
    else:
        idx = trimmed.find("91FFD0")
        short = trimmed[:idx] if idx > 0 else trimmed
    return short.replace(GS_SEPARATOR, "")
