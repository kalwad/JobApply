"""Stage 1 saved-Q&A + AI short-answer analyze path (no live ATS).

Saved Q&A matching is applied in the extension (`applyCustomQA`) for skipped
fields. Backend tests here cover persistence + deterministic resilience when AI
times out. Extension Q&A behavior is covered in `extension/tests/content.test.js`.
"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_saved_qa_persists_for_extension_matching(client, db):
    qa = await client.post("/api/custom-qa", json={
        "question_pattern": "Why do you want to work here?",
        "category": "general",
        "answer": "I want to build reliable hiring tools.",
    })
    assert qa.status_code == 200
    listed = (await client.get("/api/custom-qa")).json()
    items = listed.get("items", listed)
    assert any(
        i.get("answer") == "I want to build reliable hiring tools."
        and "why do you want" in (i.get("question_pattern") or "").lower()
        for i in items
    )


@pytest.mark.asyncio
async def test_analyze_returns_deterministic_email_without_waiting_on_essay(client, db):
    await client.post("/api/profile", json={
        "full_name": "Ada Lovelace",
        "first_name": "Ada",
        "last_name": "Lovelace",
        "email": "ada@example.com",
        "phone": "555-0100",
    })
    resp = await client.post("/api/autofill/analyze", json={
        "page_url": "https://boards.greenhouse.io/example/jobs/99",
        "fields": [
            {
                "selector": "#email",
                "label": "Email",
                "name": "email",
                "type": "email",
                "currentValue": "",
            },
            {
                "selector": "#essay",
                "label": "Describe a challenging project you led",
                "name": "essay",
                "type": "textarea",
                "currentValue": "",
            },
        ],
    })
    assert resp.status_code == 200
    data = resp.json()
    mappings = data.get("mappings") or []
    by_sel = {m["selector"]: m for m in mappings}
    assert "#email" in by_sel
    assert by_sel["#email"]["action"] == "fill_text"
    assert "ada@example.com" in by_sel["#email"]["value"]
    # Must not claim total failure when contact fields matched.
    assert data.get("error") not in ("no fields found", "No fields found")


@pytest.mark.asyncio
async def test_salary_question_does_not_receive_saved_why_company_answer(client, db):
    await client.post("/api/custom-qa", json={
        "question_pattern": "Why do you want to work here?",
        "category": "general",
        "answer": "I want to build reliable hiring tools.",
    })
    await client.post("/api/profile", json={
        "full_name": "Ada Lovelace",
        "email": "ada@example.com",
        "desired_salary_min": 120000,
    })
    resp = await client.post("/api/autofill/analyze", json={
        "page_url": "https://boards.greenhouse.io/example/jobs/99",
        "fields": [
            {
                "selector": "#salary",
                "label": "What are your salary expectations?",
                "name": "salary",
                "type": "text",
                "currentValue": "",
            },
        ],
    })
    assert resp.status_code == 200
    for m in resp.json().get("mappings") or []:
        if m.get("selector") == "#salary":
            assert "reliable hiring" not in str(m.get("value", "")).lower()
