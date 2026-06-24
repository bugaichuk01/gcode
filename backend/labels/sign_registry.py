"""Реестр предопределённых знаков соответствия для PDF-рендера этикеток."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_SIGNS_DIR = Path(__file__).resolve().parent / "signs"


@dataclass(frozen=True)
class SignDefinition:
    key: str
    label: str
    asset: str  # имя PNG-файла в labels/signs/


SIGN_REGISTRY: tuple[SignDefinition, ...] = (
    SignDefinition("rst_decl", "Знак соответствия РСТ декларирования", "rst_decl.png"),
    SignDefinition("ctr", "СТР", "ctr.png"),
    SignDefinition("rst", "Знак соответствия РСТ", "rst.png"),
    SignDefinition("eac", "Знак ЕАС", "eac.png"),
    SignDefinition("ce", "CE", "ce.png"),
)

_SIGN_BY_KEY: dict[str, SignDefinition] = {s.key: s for s in SIGN_REGISTRY}


def resolve_sign_path(sign_key: str) -> Path | None:
    """Возвращает путь к PNG знака или None для неизвестного ключа."""
    definition = _SIGN_BY_KEY.get(sign_key)
    if definition is None:
        return None
    path = _SIGNS_DIR / definition.asset
    if path.is_file() and path.stat().st_size > 0:
        return path
    logger.warning(
        "Файл знака %s не найден или пуст (ожидался %s)",
        definition.asset,
        path,
    )
    return None


def sign_registry_metadata() -> list[dict[str, str]]:
    """Метаданные реестра для тестов и возможного API."""
    return [{"key": s.key, "label": s.label, "asset": s.asset} for s in SIGN_REGISTRY]
