def calculate_total_comp(offer: dict) -> dict:
    base = offer.get("base", 0) or 0
    equity = offer.get("equity", 0) or 0
    bonus = offer.get("bonus", 0) or 0
    health = offer.get("health_value", 0) or 0
    retirement_match = offer.get("retirement_match", 0) or 0
    relocation = offer.get("relocation", 0) or 0

    retirement_value = int(base * retirement_match / 100)
    total_cash = base + bonus
    total_comp = base + equity + bonus + health + retirement_value + relocation

    pto_days = offer.get("pto_days", 0) or 0
    daily_rate = base / 260 if base > 0 else 0
    pto_value = int(daily_rate * pto_days)

    return {
        "base": base,
        "equity": equity,
        "bonus": bonus,
        "health_value": health,
        "retirement_value": retirement_value,
        "relocation": relocation,
        "pto_value": pto_value,
        "total_cash": total_cash,
        "total_comp": total_comp,
        "total_with_pto": total_comp + pto_value,
    }


def compare_offers(offers: list[dict]) -> list[dict]:
    results = []
    for offer in offers:
        comp = calculate_total_comp(offer)
        results.append({
            "offer_id": offer.get("id"),
            "job_id": offer.get("job_id"),
            "location": offer.get("location", ""),
            "notes": offer.get("notes", ""),
            **comp,
        })
    results.sort(key=lambda x: x["total_comp"], reverse=True)
    if results:
        best = results[0]["total_comp"]
        for r in results:
            r["vs_best"] = r["total_comp"] - best
    return results
