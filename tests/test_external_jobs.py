import pytest
from httpx import AsyncClient, ASGITransport

from app.database import Database


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


# --- Database tests ---

@pytest.mark.asyncio
async def test_find_job_by_url(db):
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=None, salary_max=None, description="A job",
        url="https://example.com/job/123", posted_date=None,
        application_method="url", contact_email=None,
    )
    found = await db.find_job_by_url("https://example.com/job/123")
    assert found is not None
    assert found["id"] == job_id

    not_found = await db.find_job_by_url("https://example.com/nonexistent")
    assert not_found is None


# --- API tests ---

@pytest.mark.asyncio
async def test_save_external_job(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Data Scientist",
        "company": "BigCo",
        "url": "https://bigco.com/jobs/42",
        "description": "ML role",
        "source": "linkedin",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["job_id"] is not None


@pytest.mark.asyncio
async def test_save_external_job_missing_fields(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Engineer",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_lookup_job_found(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="TestCo", location="Remote",
        salary_min=100000, salary_max=150000, description="A job",
        url="https://testco.com/jobs/1", posted_date=None,
        application_method="url", contact_email=None,
    )
    resp = await client.get("/api/jobs/lookup", params={"url": "https://testco.com/jobs/1"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is True
    assert data["job_id"] == job_id
    assert data["title"] == "Engineer"


@pytest.mark.asyncio
async def test_lookup_job_not_found(client):
    resp = await client.get("/api/jobs/lookup", params={"url": "https://nowhere.com/job/999"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is False
