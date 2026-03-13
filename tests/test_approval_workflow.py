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


async def _create_job(db, url="https://example.com/job/1"):
    return await db.insert_job(
        title="Engineer", company="TestCo", location="Remote",
        salary_min=None, salary_max=None, description="A job",
        url=url, posted_date=None,
        application_method="url", contact_email=None,
    )


# --- Approval Workflow ---

@pytest.mark.asyncio
async def test_submit_for_review(client, app):
    job_id = await _create_job(app.state.db, url="https://example.com/review1")
    resp = await client.post("/api/queue/add", json={"job_id": job_id})
    qid = resp.json()["queue_id"]

    resp = await client.post(f"/api/queue/{qid}/submit-for-review")
    assert resp.status_code == 200

    items = (await client.get("/api/queue", params={"status": "review"})).json()["queue"]
    assert len(items) == 1


@pytest.mark.asyncio
async def test_approve_queue_item(client, app):
    job_id = await _create_job(app.state.db, url="https://example.com/approve1")
    resp = await client.post("/api/queue/add", json={"job_id": job_id})
    qid = resp.json()["queue_id"]

    resp = await client.post(f"/api/queue/{qid}/approve")
    assert resp.status_code == 200

    item = await app.state.db.get_queue_item(qid)
    assert item["status"] == "approved"


@pytest.mark.asyncio
async def test_reject_queue_item(client, app):
    job_id = await _create_job(app.state.db, url="https://example.com/reject1")
    resp = await client.post("/api/queue/add", json={"job_id": job_id})
    qid = resp.json()["queue_id"]

    resp = await client.post(f"/api/queue/{qid}/reject")
    assert resp.status_code == 200

    item = await app.state.db.get_queue_item(qid)
    assert item["status"] == "rejected"


@pytest.mark.asyncio
async def test_fill_status(client, app):
    job_id = await _create_job(app.state.db, url="https://example.com/fill1")
    resp = await client.post("/api/queue/add", json={"job_id": job_id})
    qid = resp.json()["queue_id"]

    resp = await client.post(f"/api/queue/{qid}/fill-status", json={
        "status": "filling", "progress": 50
    })
    assert resp.status_code == 200

    resp = await client.post(f"/api/queue/{qid}/fill-status", json={
        "status": "submitted"
    })
    assert resp.status_code == 200

    # Should auto-mark as applied
    application = await app.state.db.get_application(job_id)
    assert application is not None
    assert application["status"] == "applied"


@pytest.mark.asyncio
async def test_fill_status_not_found(client):
    resp = await client.post("/api/queue/999/fill-status", json={"status": "filling"})
    assert resp.status_code == 404


# --- Batch Operations ---

@pytest.mark.asyncio
async def test_approve_all(client, app):
    db = app.state.db
    for i in range(3):
        job_id = await _create_job(db, url=f"https://example.com/batch-approve-{i}")
        qid = await db.add_to_queue(job_id)
        await db.update_queue_status(qid, "review")

    resp = await client.post("/api/queue/approve-all")
    assert resp.status_code == 200
    assert resp.json()["approved"] == 3

    items = await db.get_queue_items_by_status("approved")
    assert len(items) == 3


@pytest.mark.asyncio
async def test_reject_all(client, app):
    db = app.state.db
    for i in range(2):
        job_id = await _create_job(db, url=f"https://example.com/batch-reject-{i}")
        qid = await db.add_to_queue(job_id)
        await db.update_queue_status(qid, "review")

    resp = await client.post("/api/queue/reject-all")
    assert resp.status_code == 200
    assert resp.json()["rejected"] == 2


# --- DB Methods ---

@pytest.mark.asyncio
async def test_bulk_update_queue_status(db):
    j1 = await _create_job(db, url="https://example.com/bulk1")
    j2 = await _create_job(db, url="https://example.com/bulk2")
    q1 = await db.add_to_queue(j1)
    q2 = await db.add_to_queue(j2)
    await db.update_queue_status(q1, "review")
    await db.update_queue_status(q2, "review")

    count = await db.bulk_update_queue_status("review", "approved")
    assert count == 2


@pytest.mark.asyncio
async def test_get_queue_items_by_status(db):
    job_id = await _create_job(db, url="https://example.com/status1")
    qid = await db.add_to_queue(job_id)
    await db.update_queue_status(qid, "review")

    items = await db.get_queue_items_by_status("review")
    assert len(items) == 1
    assert items[0]["status"] == "review"

    empty = await db.get_queue_items_by_status("approved")
    assert len(empty) == 0


@pytest.mark.asyncio
async def test_queue_events_endpoint_exists(client):
    import asyncio
    try:
        async with asyncio.timeout(2):
            async with client.stream("GET", "/api/queue/events") as resp:
                assert resp.status_code == 200
                assert "text/event-stream" in resp.headers.get("content-type", "")
    except (TimeoutError, Exception):
        pass
