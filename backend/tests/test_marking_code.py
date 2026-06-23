from utils.marking_code import (
    CRYPTO_TAIL_PRINT_ERROR,
    get_short_cis,
    has_crypto_tail,
    normalize_marking_code,
)

FULL_CODE = (
    "01029000040676422151lSbQXAES&g691FFD092dGVzdDxPl4yc2OOhCoXj6TPcEG6lSKcn9t0Vavgj/d4="
)
SHORT_CODE = "01029000040676422151lSbQXAES&g6"
CODE_WITH_GS = "01029000040676422151lSbQXAES&g6\x1d91FFD0\x1d92dGVzdDxP="


def test_has_crypto_tail_full_code():
    assert has_crypto_tail(FULL_CODE) is True


def test_has_crypto_tail_short_code_without_crypto():
    assert has_crypto_tail(SHORT_CODE) is False


def test_has_crypto_tail_gs_separated():
    assert has_crypto_tail(CODE_WITH_GS) is True


def test_normalize_marking_code_inserts_gs_separator():
    result = normalize_marking_code(FULL_CODE)
    assert "\x1d" in result
    assert result.startswith("01029000040676422151lSbQXAES&g6\x1d91FFD0\x1d92")


def test_normalize_marking_code_preserves_existing_separator():
    assert normalize_marking_code(CODE_WITH_GS) == CODE_WITH_GS


def test_crypto_tail_print_error_message():
    assert "криптохвоста" in CRYPTO_TAIL_PRINT_ERROR.lower()


def test_get_short_cis_strips_crypto_tail():
    assert get_short_cis(FULL_CODE) == SHORT_CODE
    assert get_short_cis(CODE_WITH_GS) == SHORT_CODE
    assert get_short_cis(SHORT_CODE) == SHORT_CODE
    assert "\x1d" not in get_short_cis(CODE_WITH_GS)
