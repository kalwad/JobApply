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
async def test_create_and_get_resume(db):
    rid = await db.create_resume("Backend Resume", "Jane Doe\nExperience...", is_default=True,
                                  search_terms=["python", "fastapi"], key_skills=["Python"])
    resume = await db.get_resume(rid)
    assert resume["name"] == "Backend Resume"
    assert resume["is_default"] is True
    assert resume["search_terms"] == ["python", "fastapi"]
    assert resume["key_skills"] == ["Python"]


@pytest.mark.asyncio
async def test_list_resumes(db):
    await db.create_resume("Resume A", "text A")
    await db.create_resume("Resume B", "text B")
    resumes = await db.get_resumes()
    assert len(resumes) == 2


@pytest.mark.asyncio
async def test_set_default_resume(db):
    r1 = await db.create_resume("First", "text", is_default=True)
    r2 = await db.create_resume("Second", "text")
    assert (await db.get_resume(r1))["is_default"] is True
    assert (await db.get_resume(r2))["is_default"] is False

    await db.set_default_resume(r2)
    assert (await db.get_resume(r1))["is_default"] is False
    assert (await db.get_resume(r2))["is_default"] is True


@pytest.mark.asyncio
async def test_update_resume(db):
    rid = await db.create_resume("Old", "old text")
    await db.update_resume(rid, name="New", resume_text="new text")
    resume = await db.get_resume(rid)
    assert resume["name"] == "New"
    assert resume["resume_text"] == "new text"


@pytest.mark.asyncio
async def test_delete_resume(db):
    rid = await db.create_resume("To Delete", "text")
    assert await db.delete_resume(rid) is True
    assert await db.get_resume(rid) is None


@pytest.mark.asyncio
async def test_get_default_resume(db):
    await db.create_resume("Not Default", "text A")
    await db.create_resume("Default", "text B", is_default=True)
    default = await db.get_default_resume()
    assert default["name"] == "Default"


@pytest.mark.asyncio
async def test_migrate_resume_from_search_config(db):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    await db.save_search_config(
        resume_text="My Resume Text",
        search_terms=["python"],
        job_titles=["Engineer"],
        key_skills=["Python"],
        seniority="senior",
        summary="Experienced dev",
    )
    await db.migrate_resume_from_search_config()
    resumes = await db.get_resumes()
    assert len(resumes) == 1
    assert resumes[0]["name"] == "Default Resume"
    assert resumes[0]["is_default"] is True
    assert resumes[0]["resume_text"] == "My Resume Text"

    # Should not duplicate on second call
    await db.migrate_resume_from_search_config()
    assert len(await db.get_resumes()) == 1


# --- API tests ---

@pytest.mark.asyncio
async def test_api_crud_resumes(client):
    # Create
    resp = await client.post("/api/resumes", json={
        "name": "Frontend Resume",
        "resume_text": "React developer...",
        "is_default": True,
        "search_terms": ["react"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    rid = data["resume"]["id"]
    assert data["resume"]["is_default"] is True

    # List
    resp = await client.get("/api/resumes")
    assert resp.status_code == 200
    assert len(resp.json()["resumes"]) == 1

    # Update
    resp = await client.put(f"/api/resumes/{rid}", json={"name": "Updated Resume"})
    assert resp.status_code == 200
    assert resp.json()["resume"]["name"] == "Updated Resume"

    # Delete
    resp = await client.delete(f"/api/resumes/{rid}")
    assert resp.status_code == 200

    # Verify gone
    resp = await client.get("/api/resumes")
    assert len(resp.json()["resumes"]) == 0


@pytest.mark.asyncio
async def test_api_create_resume_no_name(client):
    resp = await client.post("/api/resumes", json={"resume_text": "text"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_api_set_default(client):
    resp1 = await client.post("/api/resumes", json={"name": "A", "resume_text": "a", "is_default": True})
    resp2 = await client.post("/api/resumes", json={"name": "B", "resume_text": "b"})
    r2_id = resp2.json()["resume"]["id"]

    resp = await client.post(f"/api/resumes/{r2_id}/set-default")
    assert resp.status_code == 200

    resumes = (await client.get("/api/resumes")).json()["resumes"]
    defaults = [r for r in resumes if r["is_default"]]
    assert len(defaults) == 1
    assert defaults[0]["id"] == r2_id


@pytest.mark.asyncio
async def test_api_set_default_not_found(client):
    resp = await client.post("/api/resumes/999/set-default")
    assert resp.status_code == 404
