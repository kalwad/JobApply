"""Fact Bank tests — schema, store, importer heuristics, API."""

import uuid

import pytest

from app.facts.importer import import_resume_heuristic
from app.facts.schema import Fact, FactCategory
from app.facts.store import FactStore


SAMPLE_RESUME = """
Jane Doe
jane@example.com | 555-123-4567

EXPERIENCE
Senior Engineer | Acme Corp (2019 - Present)
- Built Python microservices handling 2M requests/day
- Led migration to Kubernetes on AWS

EDUCATION
BS Computer Science — State University

SKILLS
Python, FastAPI, AWS, Kubernetes
"""


@pytest.mark.asyncio
async def test_facts_table_and_crud(db):
    fact_id = str(uuid.uuid4())
    created = await db.create_fact({
        "id": fact_id,
        "category": "skill",
        "text": "Python",
        "skills": ["python"],
        "verified": False,
        "source": "test",
    })
    assert created["id"] == fact_id
    assert created["skills"] == ["python"]
    assert created["verified"] is False

    listed = await db.list_facts()
    assert len(listed) == 1

    verified = await db.verify_fact(fact_id, True)
    assert verified["verified"] is True

    updated = await db.update_fact(fact_id, {"text": "Python 3"})
    assert updated["text"] == "Python 3"

    assert await db.delete_fact(fact_id) is True
    assert await db.get_fact(fact_id) is None


@pytest.mark.asyncio
async def test_fact_store_assemble(db):
    store = FactStore(db)
    await store.create(Fact(
        id=str(uuid.uuid4()),
        category=FactCategory.WORK_EXPERIENCE,
        text="Shipped features",
        employer="Acme",
        role="Engineer",
        verified=True,
    ))
    await store.create(Fact(
        id=str(uuid.uuid4()),
        category=FactCategory.SKILL,
        text="Python",
        verified=True,
    ))
    text = await store.assemble_master_resume()
    assert "Python" in text
    assert "Shipped features" in text


def test_importer_heuristics():
    facts = import_resume_heuristic(SAMPLE_RESUME)
    assert len(facts) >= 4
    categories = {f.category for f in facts}
    assert FactCategory.WORK_EXPERIENCE in categories
    assert FactCategory.SKILL in categories
    assert all(not f.verified for f in facts)


@pytest.mark.asyncio
async def test_facts_api_list_create_verify(client):
    resp = await client.post("/api/facts", json={
        "category": "skill",
        "text": "TypeScript",
        "verified": False,
    })
    assert resp.status_code == 200
    fact = resp.json()["fact"]
    assert fact["text"] == "TypeScript"
    assert fact["verified"] is False

    resp = await client.get("/api/facts")
    assert resp.status_code == 200
    assert len(resp.json()["facts"]) == 1

    resp = await client.post(f"/api/facts/{fact['id']}/verify")
    assert resp.status_code == 200
    assert resp.json()["fact"]["verified"] is True


@pytest.mark.asyncio
async def test_facts_import_from_resume(client):
    resp = await client.post("/api/facts/import-from-resume", json={
        "resume_text": SAMPLE_RESUME,
        "use_ai": False,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] >= 3
    assert all(not f["verified"] for f in data["facts"])


@pytest.mark.asyncio
async def test_facts_assemble_master_resume(client):
    create = await client.post("/api/facts", json={
        "category": "work_experience",
        "text": "Built APIs",
        "verified": True,
    })
    fact_id = create.json()["fact"]["id"]
    await client.post(f"/api/facts/{fact_id}/verify")

    resp = await client.post("/api/facts/assemble-master-resume")
    assert resp.status_code == 200
    assert "Built APIs" in resp.json()["resume_text"]
