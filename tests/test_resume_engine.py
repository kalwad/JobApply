"""Resume engine tests."""

import uuid

import pytest

from app.facts.schema import Fact, FactCategory
from app.facts.store import FactStore
from app.resume_engine.jd_parser import parse_job_description
from app.resume_engine.matcher import match_jd_to_facts
from app.resume_engine.one_page import fit_one_page, render_tailored_text
from app.resume_engine.tailor import tailor_resume


JD = """
Senior Python Engineer

Requirements:
- 5+ years Python experience
- FastAPI and AWS
- Kubernetes

Nice to have:
- GraphQL
"""


@pytest.mark.asyncio
async def test_jd_parser_extracts_skills():
    parsed = parse_job_description(JD)
    assert "python" in parsed["skills"]
    assert "fastapi" in parsed["skills"]
    assert "kubernetes" in parsed["skills"]


@pytest.mark.asyncio
async def test_matcher_never_invents_skills(db):
    store = FactStore(db)
    await store.create(Fact(
        id=str(uuid.uuid4()),
        category=FactCategory.WORK_EXPERIENCE,
        text="Built APIs with Python and FastAPI",
        verified=True,
        skills=["python", "fastapi"],
    ))
    facts = await store.list()
    report = match_jd_to_facts(JD, facts)
    matched_skills = {m["skill"] for m in report["matched"]}
    assert "python" in matched_skills
    gap_skills = {g["skill"] for g in report["gaps"]}
    assert "kubernetes" in gap_skills or "aws" in gap_skills


@pytest.mark.asyncio
async def test_heuristic_tailor(db):
    store = FactStore(db)
    await store.create(Fact(
        id=str(uuid.uuid4()),
        category=FactCategory.WORK_EXPERIENCE,
        text="Delivered Python services",
        employer="Acme",
        verified=True,
        skills=["python"],
    ))
    facts = await store.list()
    result = await tailor_resume(JD, facts, ai_client=None)
    assert result["content"]["experience"]
    assert result["supportingFactIds"]


def test_one_page_fitting_prunes():
    content = {
        "summary": "A" * 400,
        "experience": [{"text": "B" * 260, "supportingFactIds": ["1"]} for _ in range(30)],
        "skills": "python, fastapi, " + ", ".join(f"skill{i}" for i in range(40)),
        "education": ["BS CS", "MS CS"],
    }
    fitted = fit_one_page(content)
    assert fitted["pageEstimate"] <= 52
    assert len(fitted["content"]["experience"]) < 30
    assert any(s.startswith("pruned:") for s in fitted["steps"])


def test_render_tailored_text():
    text = render_tailored_text({
        "summary": "Engineer",
        "experience": [{"text": "Built APIs"}],
        "skills": "Python",
    })
    assert "Built APIs" in text
    assert "Python" in text


@pytest.mark.asyncio
async def test_resume_tailor_api(client, db):
    fact = await db.create_fact({
        "id": str(uuid.uuid4()),
        "category": "work_experience",
        "text": "Python microservices on AWS",
        "skills": ["python", "aws"],
        "verified": True,
    })
    await db.verify_fact(fact["id"], True)

    resp = await client.post("/api/resume/tailor", json={"job_description": JD})
    assert resp.status_code == 200
    data = resp.json()
    assert "content" in data
    assert "gaps" in data
    assert "pageEstimate" in data
    assert data["supportingFactIds"]
