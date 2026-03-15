import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.scheduler import run_job_embedding_cycle


@pytest.mark.asyncio
async def test_embedding_cycle_skips_without_client():
    db = MagicMock()
    result = await run_job_embedding_cycle(db, embedding_client=None)
    assert result == 0


@pytest.mark.asyncio
async def test_embedding_cycle_skips_without_vec():
    db = MagicMock()
    db._vec_loaded = False
    client = MagicMock()
    result = await run_job_embedding_cycle(db, embedding_client=client)
    assert result == 0


@pytest.mark.asyncio
async def test_embedding_cycle_embeds_jobs():
    mock_cursor = AsyncMock()
    mock_cursor.fetchall = AsyncMock(return_value=[
        {"id": 1, "title": "DevOps Engineer", "company": "Acme", "description": "AWS K8s"},
        {"id": 2, "title": "SRE", "company": "Corp", "description": "Terraform"},
    ])

    db = MagicMock()
    db._vec_loaded = True
    db.db = MagicMock()
    db.db.execute = AsyncMock(return_value=mock_cursor)

    client = MagicMock()
    client.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])

    with patch("app.embeddings.upsert_embedding", new_callable=AsyncMock) as mock_upsert:
        result = await run_job_embedding_cycle(db, embedding_client=client, batch_size=10)

    assert result == 2
    assert client.embed.await_count == 2
    assert mock_upsert.await_count == 2


@pytest.mark.asyncio
async def test_embedding_cycle_handles_errors():
    mock_cursor = AsyncMock()
    mock_cursor.fetchall = AsyncMock(return_value=[
        {"id": 1, "title": "Job", "company": "Co", "description": "Desc"},
    ])

    db = MagicMock()
    db._vec_loaded = True
    db.db = MagicMock()
    db.db.execute = AsyncMock(return_value=mock_cursor)

    client = MagicMock()
    client.embed = AsyncMock(side_effect=Exception("API error"))

    result = await run_job_embedding_cycle(db, embedding_client=client)
    assert result == 0


@pytest.mark.asyncio
async def test_embedding_cycle_no_jobs():
    mock_cursor = AsyncMock()
    mock_cursor.fetchall = AsyncMock(return_value=[])

    db = MagicMock()
    db._vec_loaded = True
    db.db = MagicMock()
    db.db.execute = AsyncMock(return_value=mock_cursor)

    client = MagicMock()
    result = await run_job_embedding_cycle(db, embedding_client=client)
    assert result == 0


@pytest.mark.asyncio
async def test_find_similar_falls_back_to_like():
    """find_similar_jobs uses LIKE when vec is not loaded."""
    import aiosqlite

    db_conn = await aiosqlite.connect(":memory:")
    db_conn.row_factory = aiosqlite.Row
    await db_conn.executescript("""
        CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, company TEXT,
                          location TEXT, url TEXT, dismissed INTEGER DEFAULT 0);
        CREATE TABLE job_scores (id INTEGER PRIMARY KEY, job_id INTEGER, match_score INTEGER);
        INSERT INTO jobs VALUES (1, 'SRE', 'Acme Corp', 'Remote', 'http://a.com', 0);
        INSERT INTO jobs VALUES (2, 'DevOps', 'Acme Corp', 'NY', 'http://b.com', 0);
        INSERT INTO jobs VALUES (3, 'Designer', 'Other Co', 'LA', 'http://c.com', 0);
    """)

    from app.database import Database
    db = Database.__new__(Database)
    db.db = db_conn
    db._vec_loaded = False

    results = await db.find_similar_jobs("SRE", "Acme Corp", exclude_id=1)
    assert len(results) == 1
    assert results[0]["id"] == 2

    await db_conn.close()


@pytest.mark.asyncio
async def test_similar_jobs_endpoint(tmp_path):
    """GET /api/jobs/{id}/similar returns similar jobs."""
    from httpx import AsyncClient, ASGITransport
    from app.main import create_app
    from app.database import Database

    db_path = str(tmp_path / "test.db")
    app = create_app(db_path=db_path, testing=True)
    db = Database(db_path)
    await db.init()
    app.state.db = db
    app.state.embedding_client = None

    try:
        job_id = await db.insert_job(
            title="Backend Engineer", company="TestCo",
            location="Remote", salary_min=0, salary_max=0,
            description="Python FastAPI", url="https://example.com/job1",
            posted_date="", application_method="url", contact_email="",
        )

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(f"/api/jobs/{job_id}/similar")
            assert resp.status_code == 200
            data = resp.json()
            assert "similar" in data

            resp = await client.get("/api/jobs/9999/similar")
            assert resp.status_code == 404
    finally:
        await db.close()
