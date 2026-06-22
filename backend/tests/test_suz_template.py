from services.product_groups import resolve_suz_template_id


def test_bicycle_template():
    assert resolve_suz_template_id("bicycle") == 11
    assert resolve_suz_template_id("bicycles") == 11


def test_perfumery_template():
    assert resolve_suz_template_id("perfumery") == 9


def test_lp_and_linen_template():
    assert resolve_suz_template_id("lp") == 10
    assert resolve_suz_template_id("linen") == 10


def test_unknown_group_uses_fallback():
    assert resolve_suz_template_id("automotive", fallback=9) == 9
