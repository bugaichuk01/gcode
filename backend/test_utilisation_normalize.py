from services.utilisation_service import normalize_marking_code
def test_normalize_marking_code_inserts_gs_separator():
    test_code = (
        "01029000040676422151lSbQXAES&g691FFD092dGVzdDxPl4yc2OOhCoXj6TPcEG6lSKcn9t0Vavgj/d4="
    )
    result = normalize_marking_code(test_code)
    assert "\x1d" in result, "Разделитель не добавлен!"
    assert result.startswith("01029000040676422151lSbQXAES&g6\x1d91FFD0\x1d92")
def test_normalize_marking_code_preserves_existing_separator():
    code_with_gs = "01029000040676422151lSbQXAES&g6\x1d91FFD0\x1d92dGVzdDxP="
    assert normalize_marking_code(code_with_gs) == code_with_gs
