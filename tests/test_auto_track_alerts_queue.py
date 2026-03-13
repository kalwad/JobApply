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
    application.state.tailor = None
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


# --- 3.1 Auto-Track ---

@pytest.mark.asyncio
async def test_mark_applied_by_url(client, app):
    job_id = await _create_job(app.state.db)
    resp = await client.post("/api/jobs/mark-applied-by-url", json={
        "url": "https://example.com/job/1"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is True
    assert data["job_id"] == job_id
    assert data["status"] == "applied"


@pytest.mark.asyncio
async def test_mark_applied_not_found(client):
    resp = await client.post("/api/jobs/mark-applied-by-url", json={
        "url": "https://nowhere.com/nope"
    })
    assert resp.status_code == 200
    assert resp.json()["found"] is False


@pytest.mark.asyncio
async def test_mark_applied_no_url(client):
    resp = await client.post("/api/jobs/mark-applied-by-url", json={})
    assert resp.status_code == 400


# --- 3.2 Job Alerts ---

@pytest.mark.asyncio
async def test_alerts_crud_db(db):
    aid = await db.create_job_alert("High Score Remote", {"location": "remote"}, min_score=80)
    alert = await db.get_job_alert(aid)
    assert alert["name"] == "High Score Remote"
    assert alert["min_score"] == 80
    assert alert["enabled"] is True

    alerts = await db.get_job_alerts()
    assert len(alerts) == 1

    await db.update_job_alert(aid, enabled=False)
    alert = await db.get_job_alert(aid)
    assert alert["enabled"] is False

    await db.delete_job_alert(aid)
    assert await db.get_job_alert(aid) is None


@pytest.mark.asyncio
async def test_api_alerts_crud(client):
    resp = await client.post("/api/alerts", json={
        "name": "Python Jobs", "filters": {"search": "python"}, "min_score": 70
    })
    assert resp.status_code == 200
    aid = resp.json()["alert"]["id"]

    resp = await client.get("/api/alerts")
    assert len(resp.json()["alerts"]) == 1

    resp = await client.put(f"/api/alerts/{aid}", json={"enabled": False})
    assert resp.status_code == 200
    assert resp.json()["alert"]["enabled"] is False

    resp = await client.delete(f"/api/alerts/{aid}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_api_create_alert_no_name(client):
    resp = await client.post("/api/alerts", json={"filters": {}})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_alert_check_finds_jobs(db):
    from app.scheduler import run_alert_check
    job_id = await _create_job(db, url="https://example.com/alert-test")
    await db.insert_score(job_id, 85, ["Good match"], [], ["Python"])
    await db.create_job_alert("Test Alert", {}, min_score=80)
    count = await run_alert_check(db)
    assert count >= 1


# --- 3.3 Application Queue ---

@pytest.mark.asyncio
async def test_queue_crud_db(db):
    job_id = await _create_job(db, url="https://example.com/queue-test")
    qid = await db.add_to_queue(job_id, priority=5)
    assert qid is not None

    items = await db.get_queue()
    assert len(items) == 1
    assert items[0]["priority"] == 5

    await db.update_queue_status(qid, "ready")
    item = await db.get_queue_item(qid)
    assert item["status"] == "ready"
    assert item["prepared_at"] is not None

    await db.remove_from_queue(qid)
    assert await db.get_queue_item(qid) is None


@pytest.mark.asyncio
async def test_api_queue_add_and_list(client, app):
    job_id = await _create_job(app.state.db, url="https://example.com/q1")
    resp = await client.post("/api/queue/add", json={"job_id": job_id})
    assert resp.status_code == 200

    resp = await client.get("/api/queue")
    assert resp.status_code == 200
    assert len(resp.json()["queue"]) == 1


@pytest.mark.asyncio
async def test_api_queue_add_no_job(client):
    resp = await client.post("/api/queue/add", json={"job_id": 999})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_api_queue_approve(client, app):
    job_id = await _create_job(app.state.db, url="https://example.com/q2")
    resp = await client.post("/api/queue/add", json={"job_id": job_id})
    qid = resp.json()["queue_id"]
    resp = await client.post(f"/api/queue/{qid}/approve")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_api_queue_delete(client, app):
    job_id = await _create_job(app.state.db, url="https://example.com/q3")
    resp = await client.post("/api/queue/add", json={"job_id": job_id})
    qid = resp.json()["queue_id"]
    resp = await client.delete(f"/api/queue/{qid}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_api_prepare_all_no_tailor(client):
    resp = await client.post("/api/queue/prepare-all")
    assert resp.status_code == 503


# --- 3.4 Follow-Up Templates ---

@pytest.mark.asyncio
async def test_templates_crud_db(db):
    tid = await db.create_follow_up_template(
        "Standard Follow-Up", 7, "Hi, I wanted to follow up...", is_default=True
    )
    template = await db.get_follow_up_template(tid)
    assert template["name"] == "Standard Follow-Up"
    assert template["days_after"] == 7
    assert template["is_default"] is True

    templates = await db.get_follow_up_templates()
    assert len(templates) == 1

    await db.update_follow_up_template(tid, days_after=14)
    template = await db.get_follow_up_template(tid)
    assert template["days_after"] == 14

    await db.delete_follow_up_template(tid)
    assert await db.get_follow_up_template(tid) is None


@pytest.mark.asyncio
async def test_api_templates_crud(client):
    resp = await client.post("/api/follow-up-templates", json={
        "name": "Quick Follow-Up", "days_after": 5,
        "template_text": "Just checking in...", "is_default": True
    })
    assert resp.status_code == 200
    tid = resp.json()["template"]["id"]

    resp = await client.get("/api/follow-up-templates")
    assert len(resp.json()["templates"]) == 1

    resp = await client.put(f"/api/follow-up-templates/{tid}", json={"days_after": 10})
    assert resp.status_code == 200
    assert resp.json()["template"]["days_after"] == 10

    resp = await client.delete(f"/api/follow-up-templates/{tid}")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_api_create_template_no_name(client):
    resp = await client.post("/api/follow-up-templates", json={"days_after": 7})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reminder_new_columns(db):
    job_id = await _create_job(db, url="https://example.com/reminder-test")
    from datetime import datetime, timezone, timedelta
    remind_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    rid = await db.create_reminder(job_id, remind_at, "follow_up")
    # Update with new columns
    await db.update_reminder_draft(rid, "Hi, following up on my application...")
    reminders = await db.get_reminders()
    r = reminders[0]
    assert r["draft_text"] == "Hi, following up on my application..."


@pytest.mark.asyncio
async def test_follow_up_module():
    from app.follow_up import FOLLOW_UP_PROMPT
    # Just verify the module loads and prompt is defined
    assert "JOB TITLE" in FOLLOW_UP_PROMPT
