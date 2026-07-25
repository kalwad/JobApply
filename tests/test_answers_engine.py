"""Grounded short-answer engine tests."""

import uuid
from unittest.mock import AsyncMock

import pytest

from app.answers.engine import approve_answer, generate_answer
from app.facts.schema import Fact, FactCategory
from app.facts.store import FactStore


@pytest.mark.asyncio
async def test_exact_custom_qa_match(db):
    await db.save_custom_qa({
        "question_pattern": "What is your email?",
        "category": "contact",
        "answer": "user@example.com",
        "times_used": 0,
    })
    draft = await generate_answer("What is your email?", db)
    assert draft.answer == "user@example.com"
    assert draft.confidence == 1.0
    assert draft.needs_review is False


@pytest.mark.asyncio
async def test_fuzzy_custom_qa_match(db):
    await db.save_custom_qa({
        "question_pattern": "Why do you want to work here?",
        "category": "motivation",
        "answer": "Mission alignment",
        "times_used": 0,
    })
    draft = await generate_answer("why do you want to work here", db)
    assert draft.answer == "Mission alignment"
    assert draft.confidence >= 0.9


@pytest.mark.asyncio
async def test_deterministic_profile(db):
    await db.save_user_profile(full_name="Jane Doe", email="jane@example.com")
    draft = await generate_answer("What is your email address?", db)
    assert draft.answer == "jane@example.com"


@pytest.mark.asyncio
async def test_manual_fallback_without_facts(db):
    draft = await generate_answer("Describe your quantum flux capacitor experience", db)
    assert draft.requires_user_decision is True
    assert draft.needs_review is True


@pytest.mark.asyncio
async def test_approve_saves_custom_qa(db):
    qa_id = await approve_answer(
        "Favorite programming language?",
        "Python",
        db,
        category="general",
    )
    assert qa_id
    entries = await db.get_custom_qa()
    assert any(e["answer"] == "Python" for e in entries)


@pytest.mark.asyncio
async def test_answers_api_generate(client, db):
    await db.save_user_profile(email="api@test.com")
    resp = await client.post("/api/answers/generate", json={
        "question": "What is your email?",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["answer"] == "api@test.com"


@pytest.mark.asyncio
async def test_answers_api_approve(client, db):
    resp = await client.post("/api/answers/approve", json={
        "question": "Years of Python experience?",
        "answer": "5 years",
    })
    assert resp.status_code == 200
    entries = await db.get_custom_qa()
    assert any(e["answer"] == "5 years" for e in entries)


@pytest.mark.asyncio
async def test_grounded_ai_flags_unsupported_numbers(db, mock_ai_client):
    store = FactStore(db)
    fact = await store.create(Fact(
        id=str(uuid.uuid4()),
        category=FactCategory.WORK_EXPERIENCE,
        text="Managed a small team",
        employer="Acme",
        verified=True,
    ))

    mock_ai_client.chat = AsyncMock(return_value=(
        '{"answer": "I managed 50 engineers at Acme producing 99% uptime", '
        f'"supportingFactIds": ["{fact.id}"]}}'
    ))

    draft = await generate_answer(
        "Describe your leadership experience",
        db,
        ai_client=mock_ai_client,
    )
    assert draft.needs_review is True
    assert draft.missing_information
