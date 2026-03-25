# External Jobs, Interview Tracking & Calendar — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add external job entry, interview round tracking, a calendar view with iCal subscription, and an interview detail panel with inline salary calculator.

**Architecture:** New `interview_rounds` and `ical_tokens` tables, new router module `app/routers/interviews.py`, new calendar router `app/routers/calendar.py`, new frontend view `app/static/js/views/calendar.js`, enhanced pipeline and detail views.

**Tech Stack:** Python/FastAPI, aiosqlite, vanilla JS, icalendar format (manual string generation — no new deps), existing salary-calculator.js.

---

## Task 1: Database Schema — interview_rounds and ical_tokens tables

**Files:**
- Modify: `app/database.py` — `_create_tables` method (after line ~724, after reminders table)

**Step 1: Add table DDL to _create_tables**

Add after the reminders table creation:

```python
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS interview_rounds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                round_number INTEGER NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                scheduled_at TEXT,
                duration_min INTEGER DEFAULT 60,
                interviewer_name TEXT DEFAULT '',
                interviewer_title TEXT DEFAULT '',
                contact_id INTEGER,
                location TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                status TEXT DEFAULT 'scheduled',
                created_at TEXT NOT NULL,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
            )
        """)
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS ical_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
        """)
```

**Step 2: Run existing tests to verify no breakage**

Run: `uv run pytest tests/test_database.py -v`
Expected: All existing tests PASS

**Step 3: Commit**

```bash
git add app/database.py
git commit -m "Add interview_rounds and ical_tokens tables"
```

---

## Task 2: Database CRUD — Interview Rounds

**Files:**
- Modify: `app/database.py` — add methods after reminders section (~line 780)
- Test: `tests/test_interviews.py` (create new)

**Step 1: Write failing tests**

Create `tests/test_interviews.py`:

```python
import pytest
from app.database import Database


@pytest.fixture
async def db(tmp_path):
    db_path = str(tmp_path / "test.db")
    database = Database(db_path)
    await database.init()
    yield database
    await database.close()


async def _create_job(db):
    return await db.insert_job(
        title="Test Engineer", company="TestCo", location="Remote",
        salary_min=100000, salary_max=150000, description="Test job",
        url="https://example.com/job1", posted_date=None,
        application_method="url", contact_email=None,
    )


@pytest.mark.asyncio
async def test_create_interview_round(db):
    job_id = await _create_job(db)
    round_id = await db.create_interview_round(job_id, label="Phone Screen")
    assert round_id is not None
    rounds = await db.get_interview_rounds(job_id)
    assert len(rounds) == 1
    assert rounds[0]["round_number"] == 1
    assert rounds[0]["label"] == "Phone Screen"
    assert rounds[0]["status"] == "scheduled"


@pytest.mark.asyncio
async def test_auto_increment_round_number(db):
    job_id = await _create_job(db)
    await db.create_interview_round(job_id, label="Phone Screen")
    await db.create_interview_round(job_id, label="Technical")
    await db.create_interview_round(job_id, label="Final")
    rounds = await db.get_interview_rounds(job_id)
    assert [r["round_number"] for r in rounds] == [1, 2, 3]


@pytest.mark.asyncio
async def test_round_number_after_deletion(db):
    job_id = await _create_job(db)
    r1 = await db.create_interview_round(job_id, label="Screen")
    r2 = await db.create_interview_round(job_id, label="Technical")
    await db.delete_interview_round(r2)
    r3 = await db.create_interview_round(job_id, label="Final")
    rounds = await db.get_interview_rounds(job_id)
    numbers = [r["round_number"] for r in rounds]
    assert numbers == [1, 3]


@pytest.mark.asyncio
async def test_update_interview_round(db):
    job_id = await _create_job(db)
    round_id = await db.create_interview_round(job_id, label="Screen")
    await db.update_interview_round(round_id, label="Phone Screen", status="completed",
                                     interviewer_name="Jane", interviewer_title="Recruiter",
                                     scheduled_at="2026-04-01T14:00:00Z", notes="Went well")
    rounds = await db.get_interview_rounds(job_id)
    r = rounds[0]
    assert r["label"] == "Phone Screen"
    assert r["status"] == "completed"
    assert r["interviewer_name"] == "Jane"
    assert r["notes"] == "Went well"


@pytest.mark.asyncio
async def test_delete_interview_round(db):
    job_id = await _create_job(db)
    round_id = await db.create_interview_round(job_id, label="Screen")
    await db.delete_interview_round(round_id)
    rounds = await db.get_interview_rounds(job_id)
    assert len(rounds) == 0


@pytest.mark.asyncio
async def test_get_interview_round_by_id(db):
    job_id = await _create_job(db)
    round_id = await db.create_interview_round(job_id, label="Technical",
                                                scheduled_at="2026-04-01T10:00:00Z")
    r = await db.get_interview_round(round_id)
    assert r is not None
    assert r["label"] == "Technical"
    assert r["job_id"] == job_id


@pytest.mark.asyncio
async def test_cascade_delete_job_removes_rounds(db):
    job_id = await _create_job(db)
    await db.create_interview_round(job_id, label="Screen")
    await db.create_interview_round(job_id, label="Technical")
    await db.db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    await db.db.commit()
    rounds = await db.get_interview_rounds(job_id)
    assert len(rounds) == 0


@pytest.mark.asyncio
async def test_create_round_with_all_fields(db):
    job_id = await _create_job(db)
    round_id = await db.create_interview_round(
        job_id, label="Technical", scheduled_at="2026-04-01T10:00:00Z",
        duration_min=90, interviewer_name="Bob", interviewer_title="Sr Engineer",
        location="https://zoom.us/j/123", notes="Bring laptop"
    )
    r = await db.get_interview_round(round_id)
    assert r["duration_min"] == 90
    assert r["interviewer_name"] == "Bob"
    assert r["location"] == "https://zoom.us/j/123"
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_interviews.py -v`
Expected: FAIL — methods don't exist yet

**Step 3: Implement database methods**

Add to `app/database.py` after the reminders methods:

```python
    # --- Interview Rounds ---

    async def create_interview_round(self, job_id: int, label: str = "",
                                      scheduled_at: str | None = None,
                                      duration_min: int = 60,
                                      interviewer_name: str = "",
                                      interviewer_title: str = "",
                                      location: str = "",
                                      notes: str = "") -> int:
        cursor = await self.db.execute(
            "SELECT COALESCE(MAX(round_number), 0) + 1 FROM interview_rounds WHERE job_id = ?",
            (job_id,))
        row = await cursor.fetchone()
        next_num = row[0]
        now = datetime.now(timezone.utc).isoformat()
        cursor = await self.db.execute(
            """INSERT INTO interview_rounds
               (job_id, round_number, label, scheduled_at, duration_min,
                interviewer_name, interviewer_title, location, notes, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)""",
            (job_id, next_num, label, scheduled_at, duration_min,
             interviewer_name, interviewer_title, location, notes, now))
        await self.db.commit()
        return cursor.lastrowid

    async def get_interview_rounds(self, job_id: int) -> list[dict]:
        cursor = await self.db.execute(
            """SELECT * FROM interview_rounds WHERE job_id = ?
               ORDER BY round_number""", (job_id,))
        return [dict(r) for r in await cursor.fetchall()]

    async def get_interview_round(self, round_id: int) -> dict | None:
        cursor = await self.db.execute(
            "SELECT * FROM interview_rounds WHERE id = ?", (round_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def update_interview_round(self, round_id: int, **kwargs) -> None:
        allowed = {"label", "scheduled_at", "duration_min", "interviewer_name",
                    "interviewer_title", "contact_id", "location", "notes", "status"}
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return
        sets = ", ".join(f"{k} = ?" for k in updates)
        vals = list(updates.values()) + [round_id]
        await self.db.execute(f"UPDATE interview_rounds SET {sets} WHERE id = ?", vals)
        await self.db.commit()

    async def delete_interview_round(self, round_id: int) -> None:
        await self.db.execute("DELETE FROM interview_rounds WHERE id = ?", (round_id,))
        await self.db.commit()
```

**Step 4: Run tests**

Run: `uv run pytest tests/test_interviews.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add app/database.py tests/test_interviews.py
git commit -m "Add interview rounds CRUD methods and tests"
```

---

## Task 3: Database CRUD — iCal Tokens & Calendar Queries

**Files:**
- Modify: `app/database.py`
- Modify: `tests/test_interviews.py`

**Step 1: Write failing tests**

Append to `tests/test_interviews.py`:

```python
@pytest.mark.asyncio
async def test_create_ical_token(db):
    token = await db.create_ical_token()
    assert token is not None
    assert len(token) == 64  # 32 bytes hex


@pytest.mark.asyncio
async def test_validate_ical_token(db):
    token = await db.create_ical_token()
    assert await db.validate_ical_token(token) is True
    assert await db.validate_ical_token("bogus") is False


@pytest.mark.asyncio
async def test_regenerate_ical_token(db):
    old = await db.create_ical_token()
    new = await db.regenerate_ical_token()
    assert new != old
    assert await db.validate_ical_token(old) is False
    assert await db.validate_ical_token(new) is True


@pytest.mark.asyncio
async def test_get_calendar_events(db):
    job_id = await _create_job(db)
    await db.create_interview_round(job_id, label="Screen",
                                     scheduled_at="2026-04-01T14:00:00Z")
    await db.create_interview_round(job_id, label="Technical",
                                     scheduled_at="2026-04-05T10:00:00Z")
    # Reminder for same job
    await db.db.execute(
        """INSERT INTO reminders (job_id, remind_at, reminder_type, status, created_at)
           VALUES (?, '2026-04-03T09:00:00Z', 'follow_up', 'pending', '2026-03-24T00:00:00Z')""",
        (job_id,))
    await db.db.commit()

    events = await db.get_calendar_events("2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z")
    assert len(events) == 3
    types = {e["event_type"] for e in events}
    assert types == {"interview", "reminder"}


@pytest.mark.asyncio
async def test_get_calendar_events_filters_by_range(db):
    job_id = await _create_job(db)
    await db.create_interview_round(job_id, label="Screen",
                                     scheduled_at="2026-03-15T14:00:00Z")
    await db.create_interview_round(job_id, label="Technical",
                                     scheduled_at="2026-04-05T10:00:00Z")
    events = await db.get_calendar_events("2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z")
    assert len(events) == 1
    assert events[0]["label"] == "Technical"
```

**Step 2: Run to verify failure**

Run: `uv run pytest tests/test_interviews.py -v -k "ical or calendar"`
Expected: FAIL

**Step 3: Implement methods**

Add to `app/database.py`:

```python
    # --- iCal Tokens ---

    async def create_ical_token(self) -> str:
        import secrets
        token = secrets.token_hex(32)
        now = datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            "INSERT INTO ical_tokens (token, created_at) VALUES (?, ?)", (token, now))
        await self.db.commit()
        return token

    async def validate_ical_token(self, token: str) -> bool:
        cursor = await self.db.execute(
            "SELECT id FROM ical_tokens WHERE token = ?", (token,))
        return await cursor.fetchone() is not None

    async def get_or_create_ical_token(self) -> str:
        cursor = await self.db.execute(
            "SELECT token FROM ical_tokens ORDER BY id DESC LIMIT 1")
        row = await cursor.fetchone()
        if row:
            return row[0]
        return await self.create_ical_token()

    async def regenerate_ical_token(self) -> str:
        await self.db.execute("DELETE FROM ical_tokens")
        await self.db.commit()
        return await self.create_ical_token()

    # --- Calendar Queries ---

    async def get_calendar_events(self, start: str, end: str) -> list[dict]:
        events = []
        # Interview rounds
        cursor = await self.db.execute(
            """SELECT ir.*, j.title as job_title, j.company, j.salary_min, j.salary_max
               FROM interview_rounds ir
               JOIN jobs j ON ir.job_id = j.id
               WHERE ir.scheduled_at >= ? AND ir.scheduled_at <= ?
               AND ir.status = 'scheduled'
               ORDER BY ir.scheduled_at""", (start, end))
        for row in await cursor.fetchall():
            d = dict(row)
            d["event_type"] = "interview"
            events.append(d)
        # Reminders
        cursor = await self.db.execute(
            """SELECT r.*, j.title as job_title, j.company
               FROM reminders r
               JOIN jobs j ON r.job_id = j.id
               WHERE r.remind_at >= ? AND r.remind_at <= ?
               AND r.status = 'pending'
               ORDER BY r.remind_at""", (start, end))
        for row in await cursor.fetchall():
            d = dict(row)
            d["event_type"] = "reminder"
            events.append(d)
        events.sort(key=lambda e: e.get("scheduled_at") or e.get("remind_at", ""))
        return events
```

**Step 4: Run tests**

Run: `uv run pytest tests/test_interviews.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add app/database.py tests/test_interviews.py
git commit -m "Add iCal token management and calendar event queries"
```

---

## Task 4: Interview Rounds API Router

**Files:**
- Create: `app/routers/interviews.py`
- Modify: `app/main.py` — register router (~line 382)
- Test: `tests/test_interview_api.py` (create new)

**Step 1: Write failing tests**

Create `tests/test_interview_api.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import create_app


@pytest.fixture
async def client():
    app = create_app(db_path=":memory:", testing=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _create_job(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Test Job", "company": "TestCo", "url": "https://example.com/j1"
    })
    return resp.json()["job_id"]


@pytest.mark.asyncio
async def test_create_interview_round(client):
    job_id = await _create_job(client)
    resp = await client.post(f"/api/jobs/{job_id}/interviews", json={
        "label": "Phone Screen", "scheduled_at": "2026-04-01T14:00:00Z"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["round_number"] == 1
    assert data["label"] == "Phone Screen"


@pytest.mark.asyncio
async def test_list_interview_rounds(client):
    job_id = await _create_job(client)
    await client.post(f"/api/jobs/{job_id}/interviews", json={"label": "Screen"})
    await client.post(f"/api/jobs/{job_id}/interviews", json={"label": "Technical"})
    resp = await client.get(f"/api/jobs/{job_id}/interviews")
    assert resp.status_code == 200
    rounds = resp.json()["rounds"]
    assert len(rounds) == 2
    assert rounds[0]["round_number"] == 1
    assert rounds[1]["round_number"] == 2


@pytest.mark.asyncio
async def test_update_interview_round(client):
    job_id = await _create_job(client)
    resp = await client.post(f"/api/jobs/{job_id}/interviews", json={"label": "Screen"})
    round_id = resp.json()["id"]
    resp = await client.put(f"/api/interviews/{round_id}", json={
        "label": "Phone Screen", "status": "completed", "notes": "Went great"
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_delete_interview_round(client):
    job_id = await _create_job(client)
    resp = await client.post(f"/api/jobs/{job_id}/interviews", json={"label": "Screen"})
    round_id = resp.json()["id"]
    resp = await client.delete(f"/api/interviews/{round_id}")
    assert resp.status_code == 200
    resp = await client.get(f"/api/jobs/{job_id}/interviews")
    assert len(resp.json()["rounds"]) == 0


@pytest.mark.asyncio
async def test_first_interview_auto_sets_interviewing(client):
    job_id = await _create_job(client)
    # Move to pipeline first
    await client.post(f"/api/jobs/{job_id}/application", params={"status": "applied"})
    # Add interview
    await client.post(f"/api/jobs/{job_id}/interviews", json={
        "label": "Screen", "scheduled_at": "2026-04-01T14:00:00Z"
    })
    # Check status moved to interviewing
    resp = await client.get(f"/api/pipeline/interviewing")
    jobs = resp.json()["jobs"]
    assert any(j["id"] == job_id for j in jobs)


@pytest.mark.asyncio
async def test_promote_interviewer_to_contact(client):
    job_id = await _create_job(client)
    resp = await client.post(f"/api/jobs/{job_id}/interviews", json={
        "label": "Technical", "interviewer_name": "Jane Doe",
        "interviewer_title": "Engineering Manager"
    })
    round_id = resp.json()["id"]
    resp = await client.post(f"/api/interviews/{round_id}/save-contact")
    assert resp.status_code == 200
    data = resp.json()
    assert data["contact_id"] is not None
    # Round should now have contact_id set
    resp = await client.get(f"/api/jobs/{job_id}/interviews")
    r = resp.json()["rounds"][0]
    assert r["contact_id"] == data["contact_id"]
```

**Step 2: Run to verify failure**

Run: `uv run pytest tests/test_interview_api.py -v`
Expected: FAIL

**Step 3: Create router**

Create `app/routers/interviews.py`:

```python
import logging
from fastapi import APIRouter, HTTPException, Request

from app.database import Database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/jobs/{job_id}/interviews")
async def list_interviews(job_id: int, request: Request):
    db: Database = request.app.state.db
    rounds = await db.get_interview_rounds(job_id)
    return {"rounds": rounds}


@router.post("/jobs/{job_id}/interviews")
async def create_interview(job_id: int, request: Request):
    db: Database = request.app.state.db
    body = await request.json()
    round_id = await db.create_interview_round(
        job_id,
        label=body.get("label", ""),
        scheduled_at=body.get("scheduled_at"),
        duration_min=body.get("duration_min", 60),
        interviewer_name=body.get("interviewer_name", ""),
        interviewer_title=body.get("interviewer_title", ""),
        location=body.get("location", ""),
        notes=body.get("notes", ""),
    )
    # Auto-move to interviewing if not already
    app_row = await db.get_application(job_id)
    if app_row and app_row["status"] not in ("interviewing", "offered", "rejected"):
        await db.update_application(job_id, status="interviewing")
    elif not app_row:
        await db.update_application(job_id, status="interviewing")

    r = await db.get_interview_round(round_id)
    return r


@router.put("/interviews/{round_id}")
async def update_interview(round_id: int, request: Request):
    db: Database = request.app.state.db
    body = await request.json()
    await db.update_interview_round(round_id, **body)
    return {"ok": True}


@router.delete("/interviews/{round_id}")
async def delete_interview(round_id: int, request: Request):
    db: Database = request.app.state.db
    await db.delete_interview_round(round_id)
    return {"ok": True}


@router.post("/interviews/{round_id}/save-contact")
async def promote_to_contact(round_id: int, request: Request):
    db: Database = request.app.state.db
    r = await db.get_interview_round(round_id)
    if not r:
        raise HTTPException(404, "Interview round not found")
    if not r["interviewer_name"]:
        raise HTTPException(400, "No interviewer name to promote")
    if r["contact_id"]:
        return {"contact_id": r["contact_id"], "already_existed": True}

    contact_id = await db.create_contact(
        name=r["interviewer_name"],
        role=r["interviewer_title"],
    )
    await db.update_interview_round(round_id, contact_id=contact_id)
    # Link contact to job
    await db.link_job_contact(r["job_id"], contact_id, relationship="interviewer")
    return {"contact_id": contact_id, "already_existed": False}
```

**Step 4: Register router in main.py**

Add at `app/main.py` line ~382 (after alerts router):

```python
    from app.routers import jobs, tailoring, pipeline, queue, contacts, analytics, settings, alerts, scraping, autofill, interviews
```

And add:

```python
    app.include_router(interviews.router)
```

**Step 5: Run tests**

Run: `uv run pytest tests/test_interview_api.py -v`
Expected: All PASS

Note: `create_contact` and `link_job_contact` methods may need to be verified/adjusted to match existing database.py signatures. Check `app/database.py` for the exact method names — they may be `insert_contact` or similar.

**Step 6: Commit**

```bash
git add app/routers/interviews.py app/main.py tests/test_interview_api.py
git commit -m "Add interview rounds API router with tests"
```

---

## Task 5: Calendar API Router & iCal Feed

**Files:**
- Create: `app/routers/calendar.py`
- Modify: `app/main.py` — register router
- Test: `tests/test_calendar_api.py` (create new)

**Step 1: Write failing tests**

Create `tests/test_calendar_api.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import create_app


@pytest.fixture
async def client():
    app = create_app(db_path=":memory:", testing=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _create_job(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Test Engineer", "company": "TestCo", "url": "https://example.com/j1"
    })
    return resp.json()["job_id"]


@pytest.mark.asyncio
async def test_calendar_events(client):
    job_id = await _create_job(client)
    await client.post(f"/api/jobs/{job_id}/interviews", json={
        "label": "Screen", "scheduled_at": "2026-04-15T14:00:00Z"
    })
    resp = await client.get("/api/calendar", params={
        "start": "2026-04-01T00:00:00Z", "end": "2026-04-30T23:59:59Z"
    })
    assert resp.status_code == 200
    events = resp.json()["events"]
    assert len(events) == 1
    assert events[0]["event_type"] == "interview"


@pytest.mark.asyncio
async def test_calendar_empty_range(client):
    resp = await client.get("/api/calendar", params={
        "start": "2026-01-01T00:00:00Z", "end": "2026-01-31T23:59:59Z"
    })
    assert resp.status_code == 200
    assert resp.json()["events"] == []


@pytest.mark.asyncio
async def test_ical_token_lifecycle(client):
    # Get or create token
    resp = await client.get("/api/calendar/token")
    assert resp.status_code == 200
    token = resp.json()["token"]
    assert len(token) == 64

    # Same token on second call
    resp2 = await client.get("/api/calendar/token")
    assert resp2.json()["token"] == token

    # Regenerate
    resp3 = await client.post("/api/calendar/token/regenerate")
    new_token = resp3.json()["token"]
    assert new_token != token


@pytest.mark.asyncio
async def test_ical_feed(client):
    job_id = await _create_job(client)
    await client.post(f"/api/jobs/{job_id}/interviews", json={
        "label": "Technical", "scheduled_at": "2026-04-15T14:00:00Z",
        "duration_min": 60, "interviewer_name": "Jane",
        "location": "https://zoom.us/j/123"
    })
    # Get token
    resp = await client.get("/api/calendar/token")
    token = resp.json()["token"]

    # Fetch iCal
    resp = await client.get(f"/api/calendar.ics", params={"token": token})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/calendar; charset=utf-8"
    body = resp.text
    assert "BEGIN:VCALENDAR" in body
    assert "BEGIN:VEVENT" in body
    assert "Round 1: Technical" in body
    assert "TestCo" in body
    assert "LOCATION:https://zoom.us/j/123" in body
    assert "END:VCALENDAR" in body


@pytest.mark.asyncio
async def test_ical_feed_invalid_token(client):
    resp = await client.get("/api/calendar.ics", params={"token": "invalid"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_ical_feed_no_token(client):
    resp = await client.get("/api/calendar.ics")
    assert resp.status_code == 401
```

**Step 2: Run to verify failure**

Run: `uv run pytest tests/test_calendar_api.py -v`
Expected: FAIL

**Step 3: Create calendar router**

Create `app/routers/calendar.py`:

```python
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.database import Database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/calendar")
async def get_calendar_events(request: Request,
                               start: str = Query(...),
                               end: str = Query(...)):
    db: Database = request.app.state.db
    events = await db.get_calendar_events(start, end)
    return {"events": events}


@router.get("/calendar/token")
async def get_ical_token(request: Request):
    db: Database = request.app.state.db
    token = await db.get_or_create_ical_token()
    return {"token": token}


@router.post("/calendar/token/regenerate")
async def regenerate_ical_token(request: Request):
    db: Database = request.app.state.db
    token = await db.regenerate_ical_token()
    return {"token": token}


def _format_ical_datetime(iso_str: str) -> str:
    """Convert ISO datetime to iCal DTSTART format (UTC)."""
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _escape_ical(text: str) -> str:
    """Escape special characters for iCal text fields."""
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _build_ical(events: list[dict]) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CareerPulse//Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:CareerPulse Interviews",
    ]
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    for event in events:
        if event["event_type"] == "interview":
            uid = f"interview-{event['id']}@careerpulse"
            dtstart = _format_ical_datetime(event["scheduled_at"])
            duration = event.get("duration_min", 60)
            dt_start = datetime.fromisoformat(event["scheduled_at"].replace("Z", "+00:00"))
            dt_end = dt_start + timedelta(minutes=duration)
            dtend = dt_end.strftime("%Y%m%dT%H%M%SZ")
            summary = f"Round {event['round_number']}: {event['label']} — {event['company']}"
            desc_parts = [event.get("job_title", "")]
            if event.get("interviewer_name"):
                desc_parts.append(f"Interviewer: {event['interviewer_name']}")
            if event.get("notes"):
                desc_parts.append(event["notes"])
            description = "\\n".join(desc_parts)
            location = event.get("location", "")
        elif event["event_type"] == "reminder":
            uid = f"reminder-{event['id']}@careerpulse"
            dtstart = _format_ical_datetime(event["remind_at"])
            dt_start = datetime.fromisoformat(event["remind_at"].replace("Z", "+00:00"))
            dt_end = dt_start + timedelta(minutes=30)
            dtend = dt_end.strftime("%Y%m%dT%H%M%SZ")
            summary = f"Follow-up: {event['company']} — {event.get('job_title', '')}"
            description = f"Reminder type: {event.get('reminder_type', 'follow_up')}"
            location = ""
        else:
            continue

        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{uid}")
        lines.append(f"DTSTAMP:{now}")
        lines.append(f"DTSTART:{dtstart}")
        lines.append(f"DTEND:{dtend}")
        lines.append(f"SUMMARY:{_escape_ical(summary)}")
        if description:
            lines.append(f"DESCRIPTION:{_escape_ical(description)}")
        if location:
            lines.append(f"LOCATION:{_escape_ical(location)}")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


@router.get("/calendar.ics")
async def ical_feed(request: Request, token: str = Query(None)):
    if not token:
        raise HTTPException(401, "Token required")
    db: Database = request.app.state.db
    if not await db.validate_ical_token(token):
        raise HTTPException(401, "Invalid token")

    # Get all scheduled interviews and pending reminders (next 90 days)
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=7)).isoformat()
    end = (now + timedelta(days=90)).isoformat()
    events = await db.get_calendar_events(start, end)

    ical_body = _build_ical(events)
    return Response(
        content=ical_body,
        media_type="text/calendar; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )
```

**Step 4: Register in main.py**

Add `calendar` to the imports and `app.include_router(calendar.router)`.

**Step 5: Run tests**

Run: `uv run pytest tests/test_calendar_api.py -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add app/routers/calendar.py app/main.py tests/test_calendar_api.py
git commit -m "Add calendar API with iCal subscription feed"
```

---

## Task 6: Enhanced Save External Job (auto-fetch description)

**Files:**
- Modify: `app/routers/jobs.py` (~line 45)
- Test: `tests/test_external_job.py` (create new)

**Step 1: Write failing tests**

Create `tests/test_external_job.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport
from app.main import create_app


@pytest.fixture
async def client():
    app = create_app(db_path=":memory:", testing=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_save_external_basic(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "DevOps Engineer", "company": "Acme", "url": "https://acme.com/jobs/1"
    })
    assert resp.status_code == 200
    assert resp.json()["job_id"] is not None


@pytest.mark.asyncio
async def test_save_external_with_initial_status(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "SRE", "company": "Acme", "url": "https://acme.com/jobs/2",
        "initial_status": "applied"
    })
    job_id = resp.json()["job_id"]
    resp = await client.get("/api/pipeline/applied")
    jobs = resp.json()["jobs"]
    assert any(j["id"] == job_id for j in jobs)


@pytest.mark.asyncio
@patch("app.routers.jobs.enrich_job_description", new_callable=AsyncMock)
async def test_save_external_fetch_description(mock_enrich, client):
    mock_enrich.return_value = "Full job description from page"
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Engineer", "company": "Co", "url": "https://co.com/j1",
        "fetch_description": True
    })
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    resp = await client.get(f"/api/jobs/{job_id}")
    assert "Full job description" in resp.json()["description"]


@pytest.mark.asyncio
@patch("app.routers.jobs.enrich_job_description", new_callable=AsyncMock)
async def test_save_external_fetch_fails_silently(mock_enrich, client):
    mock_enrich.return_value = None
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Engineer", "company": "Co", "url": "https://co.com/j2",
        "fetch_description": True
    })
    assert resp.status_code == 200
    assert resp.json()["job_id"] is not None
```

**Step 2: Run to verify failure**

Run: `uv run pytest tests/test_external_job.py -v`
Expected: FAIL (at least the new tests)

**Step 3: Modify save_external_job endpoint**

In `app/routers/jobs.py`, update the `save_external_job` function:

```python
@router.post("/jobs/save-external")
async def save_external_job(request: Request):
    db = request.app.state.db
    body = await request.json()
    title = body.get("title", "").strip()
    company = body.get("company", "").strip()
    url = body.get("url", "").strip()
    if not title or not company or not url:
        raise HTTPException(400, "title, company, and url are required")

    description = body.get("description", "")

    # Auto-fetch description if requested and none provided
    if body.get("fetch_description") and not description and url:
        try:
            from app.enrichment import enrich_job_description
            fetched = await enrich_job_description(url, source="external")
            if fetched:
                description = fetched
        except Exception:
            pass  # Fail silently

    source = body.get("source", "external")
    job_id = await db.insert_job(
        title=title, company=company, location=body.get("location", ""),
        salary_min=body.get("salary_min"), salary_max=body.get("salary_max"),
        description=description, url=url, posted_date=body.get("posted_date"),
        application_method=body.get("application_method", "url"),
        contact_email=body.get("contact_email"),
    )
    if job_id:
        await db.insert_source(job_id, source, url)
        await db.add_event(job_id, "saved_external", f"Saved from {source}")
        # Set initial pipeline status if provided
        initial_status = body.get("initial_status")
        if initial_status:
            await db.update_application(job_id, status=initial_status)
    return {"ok": True, "job_id": job_id}
```

**Step 4: Run tests**

Run: `uv run pytest tests/test_external_job.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add app/routers/jobs.py tests/test_external_job.py
git commit -m "Add auto-fetch description and initial status to save-external"
```

---

## Task 7: Frontend — API Methods

**Files:**
- Modify: `app/static/js/api.js` — add new methods

**Step 1: Add API methods**

Add to the api object in `app/static/js/api.js`:

```javascript
    // Interview Rounds
    getInterviews(jobId) {
        return this.request('GET', `/api/jobs/${jobId}/interviews`);
    },
    createInterview(jobId, data) {
        return this.request('POST', `/api/jobs/${jobId}/interviews`, data);
    },
    updateInterview(roundId, data) {
        return this.request('PUT', `/api/interviews/${roundId}`, data);
    },
    deleteInterview(roundId) {
        return this.request('DELETE', `/api/interviews/${roundId}`);
    },
    promoteInterviewer(roundId) {
        return this.request('POST', `/api/interviews/${roundId}/save-contact`);
    },

    // Calendar
    getCalendarEvents(start, end) {
        const qs = new URLSearchParams({ start, end });
        return this.request('GET', `/api/calendar?${qs}`);
    },
    getIcalToken() {
        return this.request('GET', '/api/calendar/token');
    },
    regenerateIcalToken() {
        return this.request('POST', '/api/calendar/token/regenerate');
    },

    // Enhanced external job
    saveExternalJob(data) {
        return this.request('POST', '/api/jobs/save-external', data);
    },
```

**Step 2: Commit**

```bash
git add app/static/js/api.js
git commit -m "Add API methods for interviews, calendar, and external jobs"
```

---

## Task 8: Frontend — Calendar View

**Files:**
- Create: `app/static/js/views/calendar.js`
- Modify: `app/static/js/app.js` — add route and nav link
- Modify: `app/static/css/style.css` — calendar styles

**This is the largest frontend task. Build the calendar view with:**

1. Monthly grid (7 columns × 5-6 rows)
2. Day cells with event chips (color-coded: blue=interview, amber=reminder)
3. Click day → expand event list
4. Click event → interview detail panel (Task 10)
5. Prev/Next month navigation, Today button
6. Subscribe button (shows iCal URL + copy)
7. Right sidebar: upcoming 7 days agenda

**Key functions to implement:**

```javascript
async function renderCalendar(container) { ... }
function buildMonthGrid(year, month, events) { ... }
function renderDayEvents(date, events) { ... }
function renderAgendaSidebar(events) { ... }
function renderSubscribeModal(token) { ... }
```

**Route registration in app.js:**

Add to `getRoute()`:
```javascript
if (hash === '#/calendar') return { view: 'calendar' };
```

Add to `handleRoute()`:
```javascript
case 'calendar': await renderCalendar(main); break;
```

Add nav link in `index.html` or wherever nav is built — between Pipeline and Stats.

**Step: Commit**

```bash
git add app/static/js/views/calendar.js app/static/js/app.js app/static/css/style.css
git commit -m "Add calendar view with monthly grid and agenda sidebar"
```

---

## Task 9: Frontend — Add External Job Modal

**Files:**
- Modify: `app/static/js/views/pipeline.js` — add "Add Job" button + modal

**Add to the pipeline board header (near the tab buttons):**

1. "Add Job" button in kanban header
2. Modal with fields: URL (auto-fetch on blur), Title, Company, Description, Location, Salary min/max, Initial Status dropdown, "Add First Interview" toggle
3. On URL blur: `POST /api/jobs/save-external` with `fetch_description: true`, populate fields from response or from a separate fetch
4. Submit creates job and optionally first interview round

**Key functions:**

```javascript
function renderAddExternalJobModal(container) { ... }
async function handleUrlFetch(url) { ... }
async function submitExternalJob(formData) { ... }
```

**Step: Commit**

```bash
git add app/static/js/views/pipeline.js
git commit -m "Add external job modal to pipeline board"
```

---

## Task 10: Frontend — Interview Timeline in Job Detail

**Files:**
- Modify: `app/static/js/views/detail.js` — add interviews section

**Add below the existing job info when the job is in the pipeline:**

1. "Interviews" section with vertical timeline
2. Each round: number + label header, datetime, interviewer, location, status badge, notes
3. "Add Interview Round" button with inline form (label suggestions dropdown, datetime picker, interviewer fields, location, notes)
4. Edit/delete per round
5. "Save to Network" button per interviewer → calls `promoteInterviewer(roundId)`

**Step: Commit**

```bash
git add app/static/js/views/detail.js
git commit -m "Add interview timeline to job detail view"
```

---

## Task 11: Frontend — Interview Detail Panel with Salary Calculator

**Files:**
- Modify: `app/static/js/views/calendar.js` — click handler
- Modify: `app/static/js/views/pipeline.js` — click handler
- May need: `app/static/js/views/detail.js`

**When clicking an interview event (from calendar or pipeline):**

1. Slide-out panel or modal, split left/right
2. Left: interview info (round, datetime, interviewer, location, notes, status controls, link to full detail)
3. Right: compact salary calculator pre-populated from job's salary_min/max, employment type from tags
4. Reuse `calculateSalary()` and render stat cards (Gross, Taxes, Take-Home) + donut chart
5. "Edit" toggle to make calculator inputs editable
6. Changes to calculator don't save back to job

**Step: Commit**

```bash
git add app/static/js/views/calendar.js app/static/js/views/pipeline.js
git commit -m "Add interview detail panel with inline salary calculator"
```

---

## Task 12: Frontend Tests

**Files:**
- Create/modify: `app/static/tests/` or wherever vitest tests live

**Tests to write (~15-20):**

1. Calendar grid renders correct number of days for month
2. Calendar navigation changes month
3. Event chips render with correct colors
4. Agenda sidebar shows next 7 days only
5. Subscribe modal shows token and copy button
6. Add external job modal: required field validation
7. Add external job modal: URL fetch populates fields
8. Interview timeline renders rounds in order
9. Add interview form submits correctly
10. Interview detail panel renders with salary data
11. Pipeline kanban drag-and-drop still works (regression)

Run: `cd app/static && npx vitest run`

**Step: Commit**

```bash
git add app/static/tests/
git commit -m "Add frontend tests for calendar, interviews, and external jobs"
```

---

## Task 13: Integration Test — Full Flow

**Files:**
- Create: `tests/test_full_flow.py`

**Test the complete user journey:**

```python
@pytest.mark.asyncio
async def test_external_job_to_calendar_flow(client):
    # 1. Add external job
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Staff Engineer", "company": "Dropbox",
        "url": "https://dropbox.jobs/1234", "initial_status": "interested"
    })
    job_id = resp.json()["job_id"]

    # 2. Add interview rounds
    await client.post(f"/api/jobs/{job_id}/interviews", json={
        "label": "Phone Screen", "scheduled_at": "2026-04-10T15:00:00Z",
        "interviewer_name": "Sarah", "interviewer_title": "Recruiter"
    })
    await client.post(f"/api/jobs/{job_id}/interviews", json={
        "label": "Technical", "scheduled_at": "2026-04-15T14:00:00Z",
        "interviewer_name": "Bob", "interviewer_title": "Sr Engineer",
        "location": "https://zoom.us/j/456"
    })

    # 3. Verify calendar shows both
    resp = await client.get("/api/calendar", params={
        "start": "2026-04-01T00:00:00Z", "end": "2026-04-30T23:59:59Z"
    })
    assert len(resp.json()["events"]) == 2

    # 4. Verify iCal feed works
    token_resp = await client.get("/api/calendar/token")
    token = token_resp.json()["token"]
    resp = await client.get("/api/calendar.ics", params={"token": token})
    assert "Dropbox" in resp.text
    assert "Phone Screen" in resp.text
    assert "Technical" in resp.text

    # 5. Promote interviewer
    rounds_resp = await client.get(f"/api/jobs/{job_id}/interviews")
    round_id = rounds_resp.json()["rounds"][0]["id"]
    resp = await client.post(f"/api/interviews/{round_id}/save-contact")
    assert resp.json()["contact_id"] is not None

    # 6. Verify job moved to interviewing
    resp = await client.get("/api/pipeline/interviewing")
    assert any(j["id"] == job_id for j in resp.json()["jobs"])

    # 7. Complete round, verify calendar excludes it
    await client.put(f"/api/interviews/{round_id}", json={"status": "completed"})
    resp = await client.get("/api/calendar", params={
        "start": "2026-04-01T00:00:00Z", "end": "2026-04-30T23:59:59Z"
    })
    assert len(resp.json()["events"]) == 1  # Only technical remains
```

Run: `uv run pytest tests/test_full_flow.py -v`

**Step: Commit**

```bash
git add tests/test_full_flow.py
git commit -m "Add integration test for external job to calendar flow"
```

---

## Task 14: Run Full Test Suite — Regression Check

Run all tests to verify nothing is broken:

```bash
uv run pytest                          # Backend
cd app/static && npx vitest run        # Frontend
cd extension && npx vitest run         # Extension
```

All must pass. Fix any failures before final commit.

---

## Task Assignment Summary

| Task | Owner | Dependencies |
|------|-------|-------------|
| 1. DB Schema | backend-dev | none |
| 2. DB CRUD interviews | backend-dev | Task 1 |
| 3. DB CRUD ical + calendar queries | backend-dev | Task 1 |
| 4. Interview API router | backend-dev | Task 2 |
| 5. Calendar API + iCal feed | backend-dev | Task 3 |
| 6. Enhanced save-external | backend-dev | none |
| 7. Frontend API methods | frontend-dev | none |
| 8. Calendar view | frontend-dev | Task 7 |
| 9. Add external job modal | frontend-dev | Task 7 |
| 10. Interview timeline in detail | frontend-dev | Task 7 |
| 11. Interview detail panel + salary calc | frontend-dev + uiux-specialist | Task 8, 10 |
| 12. Frontend tests | frontend-dev | Tasks 8-11 |
| 13. Integration test | backend-dev | Tasks 4-6 |
| 14. Full regression | all | all |
