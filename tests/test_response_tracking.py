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


async def _create_applied_job(db):
    job_id = await db.insert_job(
        title="Engineer", company="TestCo", location="Remote",
        salary_min=None, salary_max=None, description="A job",
        url="https://example.com/job/1", posted_date=None,
        application_method="url", contact_email=None,
    )
    await db.upsert_application(job_id, "applied")
    return job_id


# --- Database tests ---

@pytest.mark.asyncio
async def test_record_response(db):
    job_id = await _create_applied_job(db)
    result = await db.record_response(job_id, "interview_invite")
    assert result["response_type"] == "interview_invite"
    assert result["response_received_at"] is not None

    app = await db.get_application(job_id)
    assert app["response_type"] == "interview_invite"


@pytest.mark.asyncio
async def test_record_response_no_application(db):
    job_id = await db.insert_job(
        title="Engineer", company="TestCo", location="Remote",
        salary_min=None, salary_max=None, description="A job",
        url="https://example.com/job/2", posted_date=None,
        application_method="url", contact_email=None,
    )
    with pytest.raises(ValueError):
        await db.record_response(job_id, "rejection")


@pytest.mark.asyncio
async def test_response_analytics_empty(db):
    analytics = await db.get_response_analytics()
    assert analytics["total_applied"] == 0
    assert analytics["response_rate"] == 0


@pytest.mark.asyncio
async def test_response_analytics_with_data(db):
    j1 = await _create_applied_job(db)
    # Need a second job with different URL
    j2 = await db.insert_job(
        title="Dev", company="OtherCo", location="Remote",
        salary_min=None, salary_max=None, description="Another job",
        url="https://example.com/job/3", posted_date=None,
        application_method="url", contact_email=None,
    )
    await db.upsert_application(j2, "applied")

    await db.record_response(j1, "interview_invite")

    analytics = await db.get_response_analytics()
    assert analytics["total_applied"] == 2
    assert analytics["total_responses"] == 1
    assert analytics["response_rate"] == 50.0
    assert analytics["type_breakdown"]["interview_invite"] == 1


# --- API tests ---

@pytest.mark.asyncio
async def test_api_record_response(client, app):
    job_id = await _create_applied_job(app.state.db)
    resp = await client.post(f"/api/jobs/{job_id}/response", json={
        "response_type": "rejection"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["response_type"] == "rejection"


@pytest.mark.asyncio
async def test_api_record_response_invalid_type(client, app):
    job_id = await _create_applied_job(app.state.db)
    resp = await client.post(f"/api/jobs/{job_id}/response", json={
        "response_type": "invalid"
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_api_record_response_job_not_found(client):
    resp = await client.post("/api/jobs/999/response", json={
        "response_type": "rejection"
    })
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_api_response_rates(client):
    resp = await client.get("/api/analytics/response-rates")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_applied" in data
    assert "response_rate" in data
    assert "by_source" in data
    assert "by_score_range" in data
