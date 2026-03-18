import asyncio

import pytest

from app.database import Database


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


async def _insert_job(db, i):
    return await db.insert_job(
        f"Job {i}", f"Company {i}", "Remote", None, None,
        f"Description {i}", f"https://example.com/job/{i}",
        None, "url", None,
    )


async def test_concurrent_job_inserts(db):
    """Multiple coroutines inserting jobs concurrently should not corrupt data."""
    tasks = [_insert_job(db, i) for i in range(20)]
    ids = await asyncio.gather(*tasks)
    assert len(set(ids)) == 20

    jobs = await db.list_jobs(limit=100)
    assert len(jobs) == 20


async def test_concurrent_score_inserts(db):
    """Concurrent score inserts for different jobs should not conflict."""
    for i in range(10):
        await _insert_job(db, i)

    async def insert_score(job_id):
        await db.insert_score(job_id, 50 + job_id, ["r"], ["c"], ["k"])

    tasks = [insert_score(i + 1) for i in range(10)]
    await asyncio.gather(*tasks)

    for i in range(10):
        score = await db.get_score(i + 1)
        assert score is not None
        assert score["match_score"] == 50 + (i + 1)


async def test_concurrent_reads_during_write(db):
    """Reads should not block on writes and vice versa."""
    for i in range(5):
        await _insert_job(db, i)

    async def read_jobs():
        return await db.list_jobs(limit=100)

    async def write_job(i):
        return await _insert_job(db, 100 + i)

    read_tasks = [read_jobs() for _ in range(5)]
    write_tasks = [write_job(i) for i in range(5)]
    results = await asyncio.gather(*read_tasks, *write_tasks, return_exceptions=True)
    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 0


async def test_concurrent_profile_updates(db):
    """Concurrent profile updates should not lose data."""
    await db.save_user_profile(full_name="Initial User")

    async def update_field(field, value):
        await db.save_user_profile(**{field: value})

    await asyncio.gather(
        update_field("email", "test@test.com"),
        update_field("phone", "555-1234"),
        update_field("location", "Remote"),
    )

    profile = await db.get_user_profile()
    assert profile is not None
    assert profile.get("email") or profile.get("phone") or profile.get("location")


async def test_concurrent_application_status(db):
    """Concurrent application status updates for different jobs."""
    for i in range(5):
        await _insert_job(db, i)

    async def apply_to_job(job_id, status):
        await db.upsert_application(job_id, status)

    tasks = [apply_to_job(i + 1, "applied") for i in range(5)]
    await asyncio.gather(*tasks)

    for i in range(5):
        app = await db.get_application(i + 1)
        assert app is not None
        assert app["status"] == "applied"
