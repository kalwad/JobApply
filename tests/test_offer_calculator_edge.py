import pytest

from app.offer_calculator import calculate_total_comp, compare_offers


def test_calculate_total_comp_zeros():
    result = calculate_total_comp({})
    assert result["base"] == 0
    assert result["total_comp"] == 0
    assert result["pto_value"] == 0
    assert result["total_cash"] == 0


def test_calculate_total_comp_none_values():
    offer = {"base": None, "equity": None, "bonus": None, "pto_days": None}
    result = calculate_total_comp(offer)
    assert result["base"] == 0
    assert result["total_comp"] == 0


def test_calculate_total_comp_retirement_value():
    offer = {"base": 100000, "retirement_match": 6}
    result = calculate_total_comp(offer)
    assert result["retirement_value"] == 6000


def test_calculate_total_comp_pto_value():
    offer = {"base": 260000, "pto_days": 20}
    result = calculate_total_comp(offer)
    # daily_rate = 260000 / 260 = 1000, pto_value = 1000 * 20 = 20000
    assert result["pto_value"] == 20000


def test_calculate_total_comp_total_with_pto():
    offer = {"base": 100000, "bonus": 10000, "pto_days": 10}
    result = calculate_total_comp(offer)
    assert result["total_with_pto"] == result["total_comp"] + result["pto_value"]


def test_compare_offers_empty():
    result = compare_offers([])
    assert result == []


def test_compare_offers_single():
    offers = [{"id": 1, "base": 100000}]
    result = compare_offers(offers)
    assert len(result) == 1
    assert result[0]["vs_best"] == 0


def test_compare_offers_sorts_descending():
    offers = [
        {"id": 1, "base": 80000},
        {"id": 2, "base": 120000},
        {"id": 3, "base": 100000},
    ]
    result = compare_offers(offers)
    assert result[0]["offer_id"] == 2
    assert result[1]["offer_id"] == 3
    assert result[2]["offer_id"] == 1


def test_compare_offers_vs_best_deltas():
    offers = [
        {"id": 1, "base": 100000},
        {"id": 2, "base": 80000},
    ]
    result = compare_offers(offers)
    assert result[0]["vs_best"] == 0
    assert result[1]["vs_best"] == -20000


def test_compare_offers_preserves_metadata():
    offers = [{"id": 5, "job_id": 10, "base": 90000, "location": "NYC", "notes": "great team"}]
    result = compare_offers(offers)
    assert result[0]["offer_id"] == 5
    assert result[0]["job_id"] == 10
    assert result[0]["location"] == "NYC"
    assert result[0]["notes"] == "great team"
