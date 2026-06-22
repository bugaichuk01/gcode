from __future__ import annotations

_VALID_GTIN_LENGTHS = frozenset({8, 12, 13, 14})


def normalize_gtin(gtin: str | None) -> str | None:
    """Нормализовать GTIN: только цифры; 13-значный дополнить до 14 ведущим нулём."""
    if not gtin:
        return None
    digits = "".join(c for c in str(gtin).strip() if c.isdigit())
    if not digits:
        return None
    if len(digits) > 14:
        digits = digits[-14:]
    if len(digits) == 13:
        digits = "0" + digits
    return digits


def validate_gtin_length(gtin: str | None) -> str | None:
    """Вернуть текст ошибки, если длина GTIN недопустима."""
    if not gtin:
        return None
    digits = "".join(c for c in str(gtin).strip() if c.isdigit())
    if not digits:
        return "GTIN должен содержать только цифры"
    if len(digits) not in _VALID_GTIN_LENGTHS:
        return (
            f"GTIN должен содержать 8, 12, 13 или 14 цифр (сейчас {len(digits)})"
        )
    return None
