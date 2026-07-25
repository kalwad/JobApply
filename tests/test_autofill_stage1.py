"""Stage 1 autofill safety API tests (no Stage 2–6 dependencies)."""

import pytest


@pytest.mark.asyncio
async def test_meta_slim_stage1(client, app):
    # testing=True mounts full routers; meta still reports app identity
    resp = await client.get("/api/meta")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "JobApply"
    assert data.get("stage") == 1
    assert "fact_bank" not in data.get("features", {})


@pytest.mark.asyncio
async def test_profile_and_qa_persist(client, db):
    await client.post("/api/profile", json={
        "full_name": "Stage One",
        "email": "stage1@example.com",
        "phone": "555-1000",
    })
    profile = (await client.get("/api/profile")).json()
    assert profile["email"] == "stage1@example.com"

    qa = await client.post("/api/custom-qa", json={
        "question_pattern": "Why this company?",
        "category": "general",
        "answer": "I admire the product.",
    })
    assert qa.status_code == 200
    listed = (await client.get("/api/custom-qa")).json()
    items = listed.get("items", listed)
    assert any(i.get("answer") == "I admire the product." for i in items)


@pytest.mark.asyncio
async def test_autofill_skips_nonempty_and_eeo(client, db):
    await client.post("/api/profile", json={
        "full_name": "Ada Lovelace",
        "email": "ada@example.com",
        "address_city": "London",
    })
    resp = await client.post("/api/autofill/analyze", json={
        "fields": [
            {
                "selector": "#first_name",
                "label": "First Name",
                "name": "first_name",
                "type": "text",
                "currentValue": "",
            },
            {
                "selector": "#city",
                "label": "City",
                "name": "city",
                "type": "text",
                "currentValue": "AlreadyFilled",
            },
            {
                "selector": "#race",
                "label": "Race / Ethnicity",
                "name": "race",
                "type": "select",
                "currentValue": "",
                "options": ["Decline to self-identify", "White"],
            },
        ],
        "page_url": "https://boards.greenhouse.io/example/jobs/1",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("fill_eeo") is False
    mappings = data.get("mappings", [])
    by_sel = {m["selector"]: m for m in mappings}
    assert "#first_name" in by_sel
    assert by_sel["#first_name"]["action"] == "fill_text"
    assert "Ada" in by_sel["#first_name"]["value"]
    # Nonempty city should not be remapped by deterministic fill
    assert "#city" not in by_sel or by_sel["#city"].get("action") == "skip"
    # EEO either absent or explicit skip
    if "#race" in by_sel:
        assert by_sel["#race"]["action"] == "skip"
