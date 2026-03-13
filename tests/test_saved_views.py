import json

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


# --- Database layer tests ---

@pytest.mark.asyncio
async def test_create_and_get_saved_view(db):
    view_id = await db.create_saved_view("High Score", {"min_score": 80})
    assert view_id is not None
    view = await db.get_saved_view(view_id)
    assert view["name"] == "High Score"
    assert view["filters"] == {"min_score": 80}
    assert view["created_at"]
    assert view["updated_at"]


@pytest.mark.asyncio
async def test_list_saved_views(db):
    await db.create_saved_view("View A", {"status": "new"})
    await db.create_saved_view("View B", {"min_score": 70})
    views = await db.get_saved_views()
    assert len(views) == 2
    names = {v["name"] for v in views}
    assert names == {"View A", "View B"}


@pytest.mark.asyncio
async def test_update_saved_view(db):
    view_id = await db.create_saved_view("Old Name", {"foo": "bar"})
    updated = await db.update_saved_view(view_id, name="New Name", filters={"baz": 1})
    assert updated is True
    view = await db.get_saved_view(view_id)
    assert view["name"] == "New Name"
    assert view["filters"] == {"baz": 1}


@pytest.mark.asyncio
async def test_update_saved_view_partial(db):
    view_id = await db.create_saved_view("Keep Name", {"keep": True})
    await db.update_saved_view(view_id, filters={"new": True})
    view = await db.get_saved_view(view_id)
    assert view["name"] == "Keep Name"
    assert view["filters"] == {"new": True}


@pytest.mark.asyncio
async def test_update_nonexistent_view(db):
    result = await db.update_saved_view(999, name="Nope")
    assert result is False


@pytest.mark.asyncio
async def test_delete_saved_view(db):
    view_id = await db.create_saved_view("To Delete", {})
    deleted = await db.delete_saved_view(view_id)
    assert deleted is True
    assert await db.get_saved_view(view_id) is None


@pytest.mark.asyncio
async def test_delete_nonexistent_view(db):
    deleted = await db.delete_saved_view(999)
    assert deleted is False


# --- API endpoint tests ---

@pytest.mark.asyncio
async def test_api_crud_saved_views(client):
    # Create
    resp = await client.post("/api/saved-views", json={
        "name": "Remote Jobs", "filters": {"location": "remote"}
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    view_id = data["view"]["id"]
    assert data["view"]["name"] == "Remote Jobs"
    assert data["view"]["filters"] == {"location": "remote"}

    # List
    resp = await client.get("/api/saved-views")
    assert resp.status_code == 200
    views = resp.json()["views"]
    assert len(views) == 1
    assert views[0]["id"] == view_id

    # Update
    resp = await client.put(f"/api/saved-views/{view_id}", json={
        "name": "Remote Only", "filters": {"location": "remote", "min_score": 50}
    })
    assert resp.status_code == 200
    assert resp.json()["view"]["name"] == "Remote Only"

    # Delete
    resp = await client.delete(f"/api/saved-views/{view_id}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Verify deleted
    resp = await client.get("/api/saved-views")
    assert resp.json()["views"] == []


@pytest.mark.asyncio
async def test_api_create_view_no_name(client):
    resp = await client.post("/api/saved-views", json={"filters": {}})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_api_update_view_not_found(client):
    resp = await client.put("/api/saved-views/999", json={"name": "Nope"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_api_delete_view_not_found(client):
    resp = await client.delete("/api/saved-views/999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_api_update_view_empty_name(client):
    resp = await client.post("/api/saved-views", json={"name": "Test", "filters": {}})
    view_id = resp.json()["view"]["id"]
    resp = await client.put(f"/api/saved-views/{view_id}", json={"name": "  "})
    assert resp.status_code == 400
