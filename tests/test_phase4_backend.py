import pytest
from httpx import AsyncClient, ASGITransport

from app.database import Database
from app.offer_calculator import calculate_total_comp, compare_offers


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.fixture
async def app(tmp_path):
    from app.main import create_app
    application = create_app(db_path=str(tmp_path / "test.db"), testing=True)
    db = Database(str(tmp_path / "test.db"))
    await db.init()
    application.state.db = db
    yield application
    await db.close()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _create_job(db, url="https://example.com/job/1"):
    return await db.insert_job(
        title="Engineer", company="TestCo", location="Remote",
        salary_min=None, salary_max=None, description="A job",
        url=url, posted_date=None,
        application_method="url", contact_email=None,
    )


# --- 4.2 Predictor ---

@pytest.mark.asyncio
async def test_predictor_module():
    from app.predictor import PREDICTION_PROMPT
    assert "APPLICATION HISTORY" in PREDICTION_PROMPT


@pytest.mark.asyncio
async def test_application_history_summary(db):
    summary = await db.get_application_history_summary()
    assert isinstance(summary, str)


@pytest.mark.asyncio
async def test_predict_success_no_ai(client, app):
    app.state.ai_client = None
    job_id = await _create_job(app.state.db)
    resp = await client.get(f"/api/jobs/{job_id}/predict-success")
    assert resp.status_code == 503


# --- 4.3 Contacts CRM ---

@pytest.mark.asyncio
async def test_contacts_crud_db(db):
    cid = await db.create_contact("Jane Smith", email="jane@example.com", company="Acme")
    contact = await db.get_contact(cid)
    assert contact["name"] == "Jane Smith"
    assert contact["email"] == "jane@example.com"

    contacts = await db.get_contacts()
    assert len(contacts) == 1

    await db.update_contact(cid, phone="555-1234")
    contact = await db.get_contact(cid)
    assert contact["phone"] == "555-1234"

    await db.delete_contact(cid)
    assert await db.get_contact(cid) is None


@pytest.mark.asyncio
async def test_contact_interactions(db):
    cid = await db.create_contact("John", email="john@example.com")
    iid = await db.add_contact_interaction(cid, "email", "Sent intro", "2026-03-13")
    interactions = await db.get_contact_interactions(cid)
    assert len(interactions) == 1
    assert interactions[0]["type"] == "email"


@pytest.mark.asyncio
async def test_job_contacts(db):
    job_id = await _create_job(db)
    cid = await db.create_contact("Recruiter", company="TestCo")
    await db.link_job_contact(job_id, cid, "recruiter")
    contacts = await db.get_job_contacts(job_id)
    assert len(contacts) == 1
    assert contacts[0]["relationship"] == "recruiter"

    await db.unlink_job_contact(job_id, cid)
    assert len(await db.get_job_contacts(job_id)) == 0


@pytest.mark.asyncio
async def test_api_contacts_crud(client):
    resp = await client.post("/api/contacts", json={
        "name": "Alice", "email": "alice@test.com", "company": "BigCo"
    })
    assert resp.status_code == 200
    cid = resp.json()["contact"]["id"]

    resp = await client.get("/api/contacts")
    assert len(resp.json()["contacts"]) == 1

    resp = await client.put(f"/api/contacts/{cid}", json={"role": "Engineering Manager"})
    assert resp.status_code == 200
    assert resp.json()["contact"]["role"] == "Engineering Manager"

    resp = await client.delete(f"/api/contacts/{cid}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_api_contact_interactions(client):
    resp = await client.post("/api/contacts", json={"name": "Bob"})
    cid = resp.json()["contact"]["id"]

    resp = await client.post(f"/api/contacts/{cid}/interactions", json={
        "type": "meeting", "notes": "Coffee chat", "date": "2026-03-13"
    })
    assert resp.status_code == 200

    resp = await client.get(f"/api/contacts/{cid}/interactions")
    assert len(resp.json()["interactions"]) == 1


@pytest.mark.asyncio
async def test_api_job_contacts(client, app):
    job_id = await _create_job(app.state.db)
    resp = await client.post("/api/contacts", json={"name": "Hiring Mgr"})
    cid = resp.json()["contact"]["id"]

    resp = await client.post(f"/api/jobs/{job_id}/contacts", json={
        "contact_id": cid, "relationship": "hiring_manager"
    })
    assert resp.status_code == 200

    resp = await client.get(f"/api/jobs/{job_id}/contacts")
    assert len(resp.json()["contacts"]) == 1

    resp = await client.delete(f"/api/jobs/{job_id}/contacts/{cid}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_api_create_contact_no_name(client):
    resp = await client.post("/api/contacts", json={"email": "test@test.com"})
    assert resp.status_code == 400


# --- 4.4 Career Advisor ---

@pytest.mark.asyncio
async def test_career_advisor_module():
    from app.career_advisor import CAREER_PROMPT
    assert "WORK HISTORY" in CAREER_PROMPT


@pytest.mark.asyncio
async def test_career_suggestions_db(db):
    await db.save_career_suggestions([
        {"title": "Staff Engineer", "reasoning": "Growth path", "transferable_skills": ["Python"], "gaps": ["Go"]},
        {"title": "Engineering Manager", "reasoning": "Leadership exp", "transferable_skills": ["Team lead"], "gaps": ["Budgeting"]},
    ])
    suggestions = await db.get_career_suggestions()
    assert len(suggestions) == 2
    assert suggestions[0]["transferable_skills"] == ["Python"] or suggestions[0]["transferable_skills"] == ["Team lead"]


@pytest.mark.asyncio
async def test_accept_career_suggestion(db):
    await db.save_career_suggestions([
        {"title": "DevOps Lead", "reasoning": "Infra background", "transferable_skills": ["AWS"], "gaps": []},
    ])
    suggestions = await db.get_career_suggestions()
    result = await db.accept_career_suggestion(suggestions[0]["id"])
    assert result is not None
    assert result["title"] == "DevOps Lead"


@pytest.mark.asyncio
async def test_api_career_suggestions(client):
    resp = await client.get("/api/career/suggestions")
    assert resp.status_code == 200
    assert "suggestions" in resp.json()


@pytest.mark.asyncio
async def test_api_analyze_career_no_ai(client, app):
    app.state.ai_client = None
    resp = await client.post("/api/career/analyze")
    assert resp.status_code == 503


# --- 4.5 Offer Calculator ---

def test_calculate_total_comp():
    result = calculate_total_comp({
        "base": 150000, "equity": 30000, "bonus": 15000,
        "pto_days": 20, "health_value": 12000,
        "retirement_match": 4, "relocation": 5000,
    })
    assert result["base"] == 150000
    assert result["total_cash"] == 165000
    assert result["retirement_value"] == 6000
    assert result["total_comp"] == 218000


def test_compare_offers():
    offers = [
        {"id": 1, "base": 150000, "equity": 30000, "bonus": 15000, "pto_days": 20,
         "health_value": 12000, "retirement_match": 4, "relocation": 0, "location": "SF"},
        {"id": 2, "base": 130000, "equity": 50000, "bonus": 10000, "pto_days": 25,
         "health_value": 15000, "retirement_match": 6, "relocation": 10000, "location": "Austin"},
    ]
    result = compare_offers(offers)
    assert len(result) == 2
    assert result[0]["vs_best"] == 0  # Best offer
    assert result[1]["vs_best"] < 0  # Worse offer


@pytest.mark.asyncio
async def test_api_offers_crud(client, app):
    job_id = await _create_job(app.state.db, url="https://example.com/offer-test")
    resp = await client.post("/api/offers", json={
        "job_id": job_id, "base": 160000, "equity": 25000, "bonus": 20000,
        "pto_days": 20, "location": "Remote"
    })
    assert resp.status_code == 200
    oid = resp.json()["offer"]["id"]

    resp = await client.get("/api/offers")
    assert len(resp.json()["offers"]) == 1

    resp = await client.put(f"/api/offers/{oid}", json={"base": 170000})
    assert resp.status_code == 200
    assert resp.json()["offer"]["base"] == 170000

    resp = await client.delete(f"/api/offers/{oid}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_api_offers_compare(client, app):
    for i, base in enumerate([150000, 130000]):
        await app.state.db.create_offer(
            base=base, equity=20000, bonus=10000, pto_days=20,
            location=f"City{i}",
        )
    resp = await client.get("/api/offers/compare")
    assert resp.status_code == 200
    comp = resp.json()["comparison"]
    assert len(comp) == 2
    assert comp[0]["vs_best"] == 0
