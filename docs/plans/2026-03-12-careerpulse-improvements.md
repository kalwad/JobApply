# CareerPulse Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eight improvements that make the full loop — discover, score, prepare, apply — faster, smarter, and less noisy.

**Architecture:** Each task is self-contained, building on the existing FastAPI + aiosqlite + vanilla JS stack. Tasks are ordered by dependency: enrichment and cleanup (Group A) feed better data into pipeline and apply features (Group B). All AI features use the existing `AIClient` abstraction. All new DB columns use the existing `_migrate()` pattern.

**Tech Stack:** Python 3.13 / FastAPI / aiosqlite / httpx / BeautifulSoup / vanilla JS / pytest / pytest-httpx / pytest-asyncio

---

## Execution Order & Dependencies

```
Group A (independent — can run in parallel):
  Task 1: Job Description Enrichment
  Task 2: Fuzzy Cross-Source Deduplication
  Task 3: Auto-Dismiss Stale Jobs
  Task 4: Per-Source Scrape Scheduling

Group B (depends on Group A):
  Task 5: Application Pipeline View       ← after Task 3
  Task 6: One-Click Apply                 ← after Task 5
  Task 7: Standalone Cover Letter Editor   ← after Task 1
  Task 8: More Scrapers                   ← after Tasks 2 + 4
```

---

## Task 1: Job Description Enrichment

**Problem:** LinkedIn returns no description, Dice returns only a snippet. Without full descriptions, AI scoring is guessing from titles alone. This is the #1 quality bottleneck.

**Approach:** After scraping, fetch each job's detail page and extract the full description. Add a `description_enriched` flag so we only fetch once. Integrate into the scrape cycle and add a manual trigger endpoint.

**Files:**
- Create: `app/enrichment.py`
- Modify: `app/database.py:265-277` (add migration)
- Modify: `app/scheduler.py:46-50` (add enrichment pass after scraping)
- Modify: `app/main.py` (add `/api/jobs/enrich` endpoint)
- Create: `tests/test_enrichment.py`

### Step 1: Write failing tests for enrichment module

```python
# tests/test_enrichment.py
import re
import pytest
from app.enrichment import enrich_job_description

MOCK_LINKEDIN_DETAIL = """
<html><body>
<div class="show-more-less-html__markup">
  <p>We are looking for a Senior DevOps Engineer to join our team.</p>
  <ul><li>5+ years Kubernetes experience</li><li>AWS certified</li></ul>
</div>
</body></html>
"""

MOCK_DICE_DETAIL = """
<html><body>
<div data-testid="jobDescriptionHtml">
  <p>Platform Engineer needed for cloud-native infrastructure.</p>
  <p>Requirements: Terraform, Kubernetes, CI/CD pipelines.</p>
</div>
</body></html>
"""


@pytest.mark.asyncio
async def test_enrich_linkedin(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r"https://www\.linkedin\.com/jobs/view/.*"),
        text=MOCK_LINKEDIN_DETAIL,
    )
    result = await enrich_job_description("https://www.linkedin.com/jobs/view/test-123", "linkedin")
    assert "Senior DevOps Engineer" in result
    assert "Kubernetes" in result


@pytest.mark.asyncio
async def test_enrich_dice(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r"https://www\.dice\.com/job-detail/.*"),
        text=MOCK_DICE_DETAIL,
    )
    result = await enrich_job_description("https://www.dice.com/job-detail/abc-123", "dice")
    assert "Platform Engineer" in result
    assert "Terraform" in result


@pytest.mark.asyncio
async def test_enrich_handles_http_error(httpx_mock):
    httpx_mock.add_response(url=re.compile(r"https://example\.com/.*"), status_code=404)
    result = await enrich_job_description("https://example.com/job", "unknown")
    assert result is None


@pytest.mark.asyncio
async def test_enrich_generic_fallback(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r"https://example\.com/.*"),
        text="<html><body><main><p>" + "Job details here. " * 20 + "</p></main></body></html>",
    )
    result = await enrich_job_description("https://example.com/job", "unknown")
    assert result is not None
    assert "Job details here" in result
```

### Step 2: Run tests to verify they fail

Run: `uv run pytest tests/test_enrichment.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.enrichment'`

### Step 3: Implement enrichment module

```python
# app/enrichment.py
import logging

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
}


async def enrich_job_description(url: str, source: str) -> str | None:
    """Fetch a job detail page and extract the full description text."""
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as e:
        logger.warning(f"Enrichment fetch failed for {url}: {e}")
        return None

    soup = BeautifulSoup(resp.content, "html.parser")
    extractors = {
        "linkedin": _extract_linkedin,
        "dice": _extract_dice,
    }
    extractor = extractors.get(source, _extract_generic)
    return extractor(soup)


def _extract_linkedin(soup: BeautifulSoup) -> str | None:
    el = soup.select_one(".show-more-less-html__markup, .description__text")
    return el.get_text(separator="\n", strip=True) if el else _extract_generic(soup)


def _extract_dice(soup: BeautifulSoup) -> str | None:
    el = soup.select_one('[data-testid="jobDescriptionHtml"], .job-description, #jobDescription')
    if el:
        return el.get_text(separator="\n", strip=True)
    return _extract_generic(soup)


def _extract_generic(soup: BeautifulSoup) -> str | None:
    """Fallback: find the largest text block that looks like a job description."""
    candidates = soup.select("article, main, [class*='description'], [class*='content'], [class*='detail']")
    best = ""
    for el in candidates:
        text = el.get_text(separator="\n", strip=True)
        if len(text) > len(best):
            best = text
    return best if len(best) > 100 else None
```

### Step 4: Run tests to verify they pass

Run: `uv run pytest tests/test_enrichment.py -v`
Expected: All 4 tests PASS

### Step 5: Add `description_enriched` migration and DB methods

Modify `app/database.py`:

In `_migrate()` (after line 277), add to the `jobs_migrations` dict:
```python
"description_enriched": "ALTER TABLE jobs ADD COLUMN description_enriched INTEGER DEFAULT 0",
```

Add two new methods after `get_sources()` (after line 404):
```python
async def get_jobs_needing_enrichment(self, limit: int = 50) -> list[dict]:
    cursor = await self.db.execute(
        """SELECT j.id, j.url, j.description FROM jobs j
           INNER JOIN sources s ON s.job_id = j.id
           WHERE j.description_enriched = 0
           AND (j.description IS NULL OR length(j.description) < 200)
           AND j.dismissed = 0
           GROUP BY j.id
           ORDER BY j.created_at DESC LIMIT ?""",
        (limit,),
    )
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]

async def update_job_description(self, job_id: int, description: str):
    await self.db.execute(
        "UPDATE jobs SET description = ?, description_enriched = 1 WHERE id = ?",
        (description, job_id),
    )
    await self.db.commit()
```

### Step 6: Write DB method tests

```python
# Add to tests/test_enrichment.py
from app.database import Database

@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.asyncio
async def test_get_jobs_needing_enrichment(db):
    job_id = await db.insert_job(
        title="Short Desc Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="tiny",
        url="https://example.com/1", posted_date=None,
        application_method="url", contact_email=None,
    )
    await db.insert_source(job_id, "linkedin", "https://example.com/1")
    jobs = await db.get_jobs_needing_enrichment()
    assert len(jobs) == 1
    assert jobs[0]["id"] == job_id


@pytest.mark.asyncio
async def test_update_job_description(db):
    job_id = await db.insert_job(
        title="Test", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="short",
        url="https://example.com/2", posted_date=None,
        application_method="url", contact_email=None,
    )
    await db.insert_source(job_id, "test", "https://example.com/2")
    await db.update_job_description(job_id, "Full detailed description " * 20)
    # Should no longer appear in needing enrichment
    jobs = await db.get_jobs_needing_enrichment()
    assert all(j["id"] != job_id for j in jobs)
```

### Step 7: Run all enrichment tests

Run: `uv run pytest tests/test_enrichment.py -v`
Expected: All 6 tests PASS

### Step 8: Integrate enrichment into scrape cycle

Modify `app/scheduler.py` — add enrichment pass at the end of `run_scrape_cycle()`, before the final `logger.info` on line 49:

```python
# Enrich jobs with short/missing descriptions
from app.enrichment import enrich_job_description
jobs_to_enrich = await db.get_jobs_needing_enrichment(limit=30)
enriched_count = 0
for job in jobs_to_enrich:
    sources = await db.get_sources(job["id"])
    source = sources[0]["source_name"] if sources else "unknown"
    desc = await enrich_job_description(job["url"], source)
    if desc and len(desc) > len(job.get("description") or ""):
        await db.update_job_description(job["id"], desc)
        enriched_count += 1
if enriched_count:
    logger.info(f"Enriched {enriched_count}/{len(jobs_to_enrich)} job descriptions")
```

### Step 9: Add manual enrich endpoint

Modify `app/main.py` — add after the `/api/scrape/progress` endpoint (after line 552):

```python
@app.post("/api/jobs/enrich")
async def enrich_jobs():
    from app.enrichment import enrich_job_description
    db = app.state.db
    jobs = await db.get_jobs_needing_enrichment(limit=50)
    enriched = 0
    for job in jobs:
        sources = await db.get_sources(job["id"])
        source = sources[0]["source_name"] if sources else "unknown"
        desc = await enrich_job_description(job["url"], source)
        if desc and len(desc) > len(job.get("description") or ""):
            await db.update_job_description(job["id"], desc)
            enriched += 1
    return {"enriched": enriched, "total": len(jobs)}
```

### Step 10: Run full test suite and commit

Run: `uv run pytest -v`

```bash
git add app/enrichment.py app/scheduler.py app/database.py app/main.py tests/test_enrichment.py
git commit -m "Add job description enrichment from detail pages"
```

---

## Task 2: Fuzzy Cross-Source Deduplication

**Problem:** The same job posted on LinkedIn and Dice has different URLs, so the hash dedup (`title|company|url`) doesn't catch it. Users see duplicates across sources.

**Approach:** After inserting a new job, check for near-duplicates using normalized company name + title word overlap. When a dupe is found, merge sources onto the older job and dismiss the newer one.

**Files:**
- Modify: `app/database.py` (add `_normalize_company`, `_title_similarity`, `find_cross_source_dupes`)
- Modify: `app/scheduler.py:29-44` (add dedup check after insert)
- Create: `tests/test_dedup.py`

### Step 1: Write failing tests

```python
# tests/test_dedup.py
import pytest
from app.database import Database, _normalize_company, _title_similarity


def test_normalize_company():
    assert _normalize_company("TechCorp Inc.") == "techcorp"
    assert _normalize_company("TechCorp") == "techcorp"
    assert _normalize_company("  Google LLC ") == "google"
    assert _normalize_company("Acme Corporation") == "acme"
    assert _normalize_company("Smith & Co.") == "smith  co"


def test_title_similarity():
    assert _title_similarity("Senior DevOps Engineer", "Senior DevOps Engineer") == 1.0
    assert _title_similarity("Senior DevOps Engineer", "DevOps Engineer") >= 0.6
    assert _title_similarity("Backend Engineer", "Frontend Designer") < 0.5


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.asyncio
async def test_find_cross_source_dupes(db):
    id1 = await db.insert_job(
        title="Senior DevOps Engineer", company="TechCorp",
        location="Remote", salary_min=None, salary_max=None,
        description="desc", url="https://linkedin.com/jobs/view/123",
        posted_date=None, application_method="url", contact_email=None,
    )
    id2 = await db.insert_job(
        title="Senior DevOps Engineer", company="TechCorp Inc",
        location="Remote", salary_min=None, salary_max=None,
        description="desc2", url="https://dice.com/job-detail/456",
        posted_date=None, application_method="url", contact_email=None,
    )
    dupes = await db.find_cross_source_dupes(id2, "Senior DevOps Engineer", "TechCorp Inc")
    assert len(dupes) >= 1
    assert dupes[0]["id"] == id1


@pytest.mark.asyncio
async def test_no_false_positive_dedup(db):
    await db.insert_job(
        title="DevOps Engineer", company="Google",
        location="Remote", salary_min=None, salary_max=None,
        description="d", url="https://example.com/1",
        posted_date=None, application_method="url", contact_email=None,
    )
    id2 = await db.insert_job(
        title="Backend Engineer", company="Meta",
        location="Remote", salary_min=None, salary_max=None,
        description="d", url="https://example.com/2",
        posted_date=None, application_method="url", contact_email=None,
    )
    dupes = await db.find_cross_source_dupes(id2, "Backend Engineer", "Meta")
    assert len(dupes) == 0
```

### Step 2: Run tests to verify they fail

Run: `uv run pytest tests/test_dedup.py -v`
Expected: FAIL — `ImportError: cannot import name '_normalize_company'`

### Step 3: Implement fuzzy matching functions

Add to `app/database.py` (after `make_dedup_hash` on line 10, before the `Database` class):

```python
import re as _re

def _normalize_company(name: str) -> str:
    """Normalize company name for fuzzy comparison."""
    name = name.lower().strip()
    for suffix in [" inc.", " inc", " llc", " ltd", " ltd.", " corp", " corporation",
                   " co.", " co", " company", " group", " technologies", " technology"]:
        if name.endswith(suffix):
            name = name[:-len(suffix)].strip()
    return _re.sub(r"[^a-z0-9 ]", "", name).strip()


def _title_similarity(t1: str, t2: str) -> float:
    """Word overlap ratio between two job titles."""
    w1 = set(t1.lower().split())
    w2 = set(t2.lower().split())
    if not w1 or not w2:
        return 0.0
    intersection = w1 & w2
    return len(intersection) / max(len(w1), len(w2))
```

Add method to `Database` class (after `find_similar_jobs` on line 682):

```python
async def find_cross_source_dupes(self, exclude_id: int, title: str, company: str) -> list[dict]:
    """Find likely duplicate jobs from other sources using fuzzy company + title matching."""
    norm_company = _normalize_company(company)
    cursor = await self.db.execute(
        "SELECT id, title, company, url FROM jobs WHERE id != ? AND dismissed = 0",
        (exclude_id,),
    )
    rows = await cursor.fetchall()
    dupes = []
    for row in rows:
        if _normalize_company(row["company"]) != norm_company:
            continue
        if _title_similarity(title, row["title"]) >= 0.7:
            dupes.append(dict(row))
    return dupes
```

### Step 4: Run tests to verify they pass

Run: `uv run pytest tests/test_dedup.py -v`
Expected: All 5 tests PASS

### Step 5: Integrate dedup into scrape cycle

Modify `app/scheduler.py` — replace lines 42-44 (the `if job_id:` block) with:

```python
if job_id:
    # Check for cross-source duplicates
    dupes = await db.find_cross_source_dupes(job_id, listing.title, listing.company)
    if dupes:
        # Merge: add source to oldest existing job, dismiss this new one
        oldest = dupes[0]
        await db.insert_source(oldest["id"], source_name, listing.url)
        await db.dismiss_job(job_id)
        logger.debug(f"Dedup: merged '{listing.title}' @ {listing.company} into job {oldest['id']}")
    else:
        await db.insert_source(job_id, source_name, listing.url)
        total_new += 1
```

### Step 6: Run full test suite and commit

Run: `uv run pytest -v`

```bash
git add app/database.py app/scheduler.py tests/test_dedup.py
git commit -m "Add fuzzy cross-source job deduplication"
```

---

## Task 3: Auto-Dismiss Stale Jobs

**Problem:** Old jobs clutter the feed and waste AI scoring tokens. Jobs with no `posted_date` (39% of listings) age out silently. Users need automatic cleanup.

**Approach:** Add `auto_dismiss_stale()` DB method that runs after each scrape cycle. Jobs with `posted_date` older than 30 days or no `posted_date` with `created_at` older than 14 days get auto-dismissed. Jobs with applications (except "interested") are never touched.

**Files:**
- Modify: `app/database.py` (add `auto_dismiss_stale` method)
- Modify: `app/scheduler.py` (call after scraping)
- Create: `tests/test_stale_jobs.py`

### Step 1: Write failing tests

```python
# tests/test_stale_jobs.py
import pytest
from datetime import datetime, timedelta, timezone
from app.database import Database


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.asyncio
async def test_dismiss_old_posted_date(db):
    old_date = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    jid = await db.insert_job(
        title="Old Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/old", posted_date=old_date,
        application_method="url", contact_email=None,
    )
    dismissed = await db.auto_dismiss_stale(max_age_days=30, no_date_max_days=14)
    assert dismissed >= 1
    job = await db.get_job(jid)
    assert job["dismissed"] == 1


@pytest.mark.asyncio
async def test_dismiss_no_date_old_created(db):
    jid = await db.insert_job(
        title="No Date Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/nodate", posted_date=None,
        application_method="url", contact_email=None,
    )
    old_created = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
    await db.db.execute("UPDATE jobs SET created_at = ? WHERE id = ?", (old_created, jid))
    await db.db.commit()
    dismissed = await db.auto_dismiss_stale(max_age_days=30, no_date_max_days=14)
    assert dismissed >= 1


@pytest.mark.asyncio
async def test_keeps_fresh_jobs(db):
    jid = await db.insert_job(
        title="Fresh Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/fresh",
        posted_date=datetime.now(timezone.utc).isoformat(),
        application_method="url", contact_email=None,
    )
    await db.auto_dismiss_stale(max_age_days=30, no_date_max_days=14)
    job = await db.get_job(jid)
    assert job["dismissed"] == 0


@pytest.mark.asyncio
async def test_skips_applied_jobs(db):
    old_date = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    jid = await db.insert_job(
        title="Applied Old Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/applied", posted_date=old_date,
        application_method="url", contact_email=None,
    )
    await db.insert_application(jid, status="applied")
    await db.auto_dismiss_stale(max_age_days=30, no_date_max_days=14)
    job = await db.get_job(jid)
    assert job["dismissed"] == 0
```

### Step 2: Run tests to verify they fail

Run: `uv run pytest tests/test_stale_jobs.py -v`
Expected: FAIL — `AttributeError: 'Database' object has no attribute 'auto_dismiss_stale'`

### Step 3: Implement auto_dismiss_stale

Add to `app/database.py` (after `dismiss_job` on line 540):

```python
async def auto_dismiss_stale(self, max_age_days: int = 30, no_date_max_days: int = 14) -> int:
    """Auto-dismiss old jobs. Never dismisses jobs with non-interested applications."""
    cutoff_posted = (datetime.now(timezone.utc) - __import__('datetime').timedelta(days=max_age_days)).isoformat()
    cutoff_created = (datetime.now(timezone.utc) - __import__('datetime').timedelta(days=no_date_max_days)).isoformat()
    cursor = await self.db.execute("""
        UPDATE jobs SET dismissed = 1
        WHERE dismissed = 0
        AND id NOT IN (
            SELECT job_id FROM applications WHERE status != 'interested'
        )
        AND (
            (posted_date IS NOT NULL AND posted_date < ?)
            OR (posted_date IS NULL AND created_at < ?)
        )
    """, (cutoff_posted, cutoff_created))
    await self.db.commit()
    return cursor.rowcount
```

Note: Clean up the `__import__` — use the existing `from datetime import datetime, timezone` import at top and add `timedelta`:

```python
# At top of database.py, change line 3:
from datetime import datetime, timedelta, timezone
```

Then the method becomes:
```python
async def auto_dismiss_stale(self, max_age_days: int = 30, no_date_max_days: int = 14) -> int:
    cutoff_posted = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    cutoff_created = (datetime.now(timezone.utc) - timedelta(days=no_date_max_days)).isoformat()
    cursor = await self.db.execute("""
        UPDATE jobs SET dismissed = 1
        WHERE dismissed = 0
        AND id NOT IN (
            SELECT job_id FROM applications WHERE status != 'interested'
        )
        AND (
            (posted_date IS NOT NULL AND posted_date < ?)
            OR (posted_date IS NULL AND created_at < ?)
        )
    """, (cutoff_posted, cutoff_created))
    await self.db.commit()
    return cursor.rowcount
```

### Step 4: Run tests to verify they pass

Run: `uv run pytest tests/test_stale_jobs.py -v`
Expected: All 4 tests PASS

### Step 5: Integrate into scrape cycle

Modify `app/scheduler.py` — add at the very end of `run_scrape_cycle()`, just before `return total_new` (line 50):

```python
dismissed = await db.auto_dismiss_stale()
if dismissed:
    logger.info(f"Auto-dismissed {dismissed} stale jobs")
```

### Step 6: Run full test suite and commit

Run: `uv run pytest -v`

```bash
git add app/database.py app/scheduler.py tests/test_stale_jobs.py
git commit -m "Auto-dismiss stale jobs after scraping"
```

---

## Task 4: Per-Source Scrape Scheduling

**Problem:** All scrapers run on the same interval (default 6h). HackerNews "Who is Hiring" is monthly — scraping every 6h is wasted. LinkedIn/Dice benefit from shorter intervals.

**Approach:** Add a `scraper_schedule` table with per-source `interval_hours` and `last_scraped_at`. The scrape cycle checks each source's schedule before running it.

**Files:**
- Modify: `app/database.py` (add `scraper_schedule` table + methods)
- Modify: `app/scheduler.py` (check schedule before each scraper)
- Modify: `app/main.py` (add schedule config endpoints)
- Modify: `app/static/js/app.js` (add schedule config to Settings > Data Management)
- Create: `tests/test_scraper_schedule.py`

### Step 1: Write failing tests

```python
# tests/test_scraper_schedule.py
import pytest
from datetime import datetime, timedelta, timezone
from app.database import Database


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.asyncio
async def test_default_schedule_should_run(db):
    """A scraper with no schedule record should always run."""
    should_run = await db.should_scraper_run("dice")
    assert should_run is True


@pytest.mark.asyncio
async def test_recently_run_scraper_skips(db):
    await db.update_scraper_schedule("hackernews", interval_hours=24)
    await db.mark_scraper_ran("hackernews")
    should_run = await db.should_scraper_run("hackernews")
    assert should_run is False


@pytest.mark.asyncio
async def test_overdue_scraper_runs(db):
    await db.update_scraper_schedule("dice", interval_hours=1)
    # Mark as ran 2 hours ago
    old_time = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    await db.db.execute(
        "UPDATE scraper_schedule SET last_scraped_at = ? WHERE source_name = ?",
        (old_time, "dice"),
    )
    await db.db.commit()
    should_run = await db.should_scraper_run("dice")
    assert should_run is True


@pytest.mark.asyncio
async def test_get_all_schedules(db):
    await db.update_scraper_schedule("dice", interval_hours=4)
    await db.update_scraper_schedule("hackernews", interval_hours=168)
    schedules = await db.get_all_scraper_schedules()
    assert len(schedules) == 2
    names = {s["source_name"] for s in schedules}
    assert "dice" in names
    assert "hackernews" in names
```

### Step 2: Run tests to verify they fail

Run: `uv run pytest tests/test_scraper_schedule.py -v`
Expected: FAIL — `AttributeError: 'Database' object has no attribute 'should_scraper_run'`

### Step 3: Add table and methods to database.py

Add table creation in `_create_tables()` (in the `executescript` block, after the last CREATE TABLE):

```sql
CREATE TABLE IF NOT EXISTS scraper_schedule (
    source_name TEXT PRIMARY KEY,
    interval_hours INTEGER NOT NULL DEFAULT 6,
    last_scraped_at TEXT
);
```

Add methods after `get_scraper_key` (after line 630):

```python
async def update_scraper_schedule(self, source_name: str, interval_hours: int):
    await self.db.execute(
        """INSERT INTO scraper_schedule (source_name, interval_hours)
           VALUES (?, ?)
           ON CONFLICT(source_name) DO UPDATE SET interval_hours = excluded.interval_hours""",
        (source_name, interval_hours),
    )
    await self.db.commit()

async def mark_scraper_ran(self, source_name: str):
    now = datetime.now(timezone.utc).isoformat()
    await self.db.execute(
        """INSERT INTO scraper_schedule (source_name, interval_hours, last_scraped_at)
           VALUES (?, 6, ?)
           ON CONFLICT(source_name) DO UPDATE SET last_scraped_at = excluded.last_scraped_at""",
        (source_name, now),
    )
    await self.db.commit()

async def should_scraper_run(self, source_name: str) -> bool:
    cursor = await self.db.execute(
        "SELECT interval_hours, last_scraped_at FROM scraper_schedule WHERE source_name = ?",
        (source_name,),
    )
    row = await cursor.fetchone()
    if not row or not row["last_scraped_at"]:
        return True
    last = datetime.fromisoformat(row["last_scraped_at"])
    interval = timedelta(hours=row["interval_hours"])
    return datetime.now(timezone.utc) > last + interval

async def get_all_scraper_schedules(self) -> list[dict]:
    cursor = await self.db.execute("SELECT * FROM scraper_schedule ORDER BY source_name")
    return [dict(r) for r in await cursor.fetchall()]
```

### Step 4: Run tests to verify they pass

Run: `uv run pytest tests/test_scraper_schedule.py -v`
Expected: All 4 tests PASS

### Step 5: Update scheduler to respect per-source intervals

Modify `app/scheduler.py` — inside the `for` loop (line 11), add a schedule check right after getting `source_name` (after line 14):

```python
# Check per-source schedule
if not await db.should_scraper_run(source_name):
    logger.info(f"Skipping {source_name} — not yet due")
    continue
```

After the scraper finishes (after the `for listing in listings` loop, after line 46), mark it as ran:

```python
await db.mark_scraper_ran(source_name)
```

### Step 6: Add schedule config endpoints to main.py

Add after the scraper-keys endpoints (after line 916):

```python
@app.get("/api/scraper-schedule")
async def get_scraper_schedule():
    db = app.state.db
    schedules = await db.get_all_scraper_schedules()
    return {"schedules": schedules}

@app.post("/api/scraper-schedule")
async def update_scraper_schedule(request: Request):
    data = await request.json()
    db = app.state.db
    source_name = data.get("source_name")
    interval_hours = data.get("interval_hours")
    if not source_name or interval_hours is None:
        raise HTTPException(400, "source_name and interval_hours required")
    await db.update_scraper_schedule(source_name, int(interval_hours))
    return {"ok": True}
```

### Step 7: Add schedule config to Settings UI

Modify `app/static/js/app.js` — in the Data Management tab render function, add a "Scraper Schedule" section:

- Fetch schedules from `GET /api/scraper-schedule`
- Render a table: Source Name | Interval (hours) | Last Ran | Save button per row
- Each row has an input for interval_hours, POST to `/api/scraper-schedule` on save
- Pre-populate with default intervals for all known scrapers

### Step 8: Run full test suite and commit

Run: `uv run pytest -v`

```bash
git add app/database.py app/scheduler.py app/main.py app/static/js/app.js tests/test_scraper_schedule.py
git commit -m "Add per-source scrape scheduling with configurable intervals"
```

---

## Task 5: Application Pipeline View

**Problem:** The `applications` table and status tracking exist, but there's no dedicated pipeline view. Users can't see at a glance what stage each application is in. The dashboard shows pipeline counts but no job details per stage.

**Approach:** Add a "Pipeline" view to the frontend with kanban-style columns (Interested → Prepared → Applied → Interviewing → Offered → Rejected). Add DB support for additional statuses and a pipeline query endpoint.

**Files:**
- Modify: `app/database.py` (add `rejected_at`, `offered_at` columns, `get_pipeline_jobs` method)
- Modify: `app/main.py` (add `/api/pipeline` and `/api/pipeline/{status}` endpoints)
- Modify: `app/static/js/app.js` (add Pipeline view + nav link)
- Modify: `app/static/css/style.css` (pipeline kanban styles)
- Create: `tests/test_pipeline.py`

### Step 1: Write failing tests

```python
# tests/test_pipeline.py
import pytest
from app.database import Database


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.asyncio
async def test_upsert_application_sets_timestamps(db):
    jid = await db.insert_job(
        title="Test Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="desc",
        url="https://example.com/1", posted_date=None,
        application_method="url", contact_email=None,
    )
    await db.upsert_application(jid, status="interested")
    app = await db.get_application(jid)
    assert app["status"] == "interested"
    assert app["applied_at"] is None

    await db.upsert_application(jid, status="applied")
    app = await db.get_application(jid)
    assert app["status"] == "applied"
    assert app["applied_at"] is not None

    await db.upsert_application(jid, status="rejected")
    app = await db.get_application(jid)
    assert app["status"] == "rejected"
    assert app["rejected_at"] is not None


@pytest.mark.asyncio
async def test_get_pipeline_jobs(db):
    statuses = ["interested", "prepared", "applied", "interviewing", "offered", "rejected"]
    for i, status in enumerate(statuses):
        jid = await db.insert_job(
            title=f"Job {i}", company="Co", location="Remote",
            salary_min=None, salary_max=None, description="d",
            url=f"https://example.com/{i}", posted_date=None,
            application_method="url", contact_email=None,
        )
        await db.upsert_application(jid, status=status)

    for status in statuses:
        jobs = await db.get_pipeline_jobs(status)
        assert len(jobs) == 1
        assert jobs[0]["app_status"] == status


@pytest.mark.asyncio
async def test_get_pipeline_stats(db):
    for i, status in enumerate(["interested", "applied", "applied", "rejected"]):
        jid = await db.insert_job(
            title=f"Job {i}", company="Co", location="Remote",
            salary_min=None, salary_max=None, description="d",
            url=f"https://example.com/{i}", posted_date=None,
            application_method="url", contact_email=None,
        )
        await db.upsert_application(jid, status=status)

    stats = await db.get_pipeline_stats()
    assert stats["interested"] == 1
    assert stats["applied"] == 2
    assert stats["rejected"] == 1
```

### Step 2: Run tests to verify they fail

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: FAIL — `AttributeError: 'Database' object has no attribute 'upsert_application'`

### Step 3: Add DB migrations and methods

In `_migrate()`, add applications table migrations (after the profile migrations block):

```python
# Applications table migrations
app_cursor = await self.db.execute("PRAGMA table_info(applications)")
app_columns = {row[1] for row in await app_cursor.fetchall()}
app_migrations = {
    "rejected_at": "ALTER TABLE applications ADD COLUMN rejected_at TEXT",
    "offered_at": "ALTER TABLE applications ADD COLUMN offered_at TEXT",
    "withdrawn_at": "ALTER TABLE applications ADD COLUMN withdrawn_at TEXT",
}
for col, sql in app_migrations.items():
    if col not in app_columns:
        await self.db.execute(sql)
```

Add methods after `get_application()` (after line 445):

```python
async def upsert_application(self, job_id: int, status: str):
    now = datetime.now(timezone.utc).isoformat()
    existing = await self.get_application(job_id)
    timestamp_fields = {
        "applied": "applied_at",
        "rejected": "rejected_at",
        "offered": "offered_at",
        "withdrawn": "withdrawn_at",
    }
    if existing:
        sets = {"status": status}
        ts_col = timestamp_fields.get(status)
        if ts_col:
            sets[ts_col] = now
        set_clause = ", ".join(f"{k} = ?" for k in sets)
        vals = list(sets.values()) + [existing["id"]]
        await self.db.execute(f"UPDATE applications SET {set_clause} WHERE id = ?", vals)
    else:
        cols = ["job_id", "status"]
        vals = [job_id, status]
        ts_col = timestamp_fields.get(status)
        if ts_col:
            cols.append(ts_col)
            vals.append(now)
        placeholders = ", ".join("?" for _ in cols)
        col_str = ", ".join(cols)
        await self.db.execute(
            f"INSERT INTO applications ({col_str}) VALUES ({placeholders})", vals
        )
    await self.db.commit()

async def get_pipeline_jobs(self, status: str) -> list[dict]:
    cursor = await self.db.execute("""
        SELECT j.id, j.title, j.company, j.location, j.url, j.created_at,
               js.match_score, a.status as app_status, a.applied_at
        FROM jobs j
        INNER JOIN applications a ON j.id = a.job_id
        LEFT JOIN job_scores js ON j.id = js.job_id
        WHERE a.status = ? AND j.dismissed = 0
        ORDER BY COALESCE(a.applied_at, j.created_at) DESC
    """, (status,))
    return [dict(r) for r in await cursor.fetchall()]

async def get_pipeline_stats(self) -> dict:
    cursor = await self.db.execute("""
        SELECT a.status, COUNT(*) as count
        FROM applications a
        INNER JOIN jobs j ON j.id = a.job_id
        WHERE j.dismissed = 0
        GROUP BY a.status
    """)
    rows = await cursor.fetchall()
    stats = {}
    for row in rows:
        stats[row["status"]] = row["count"]
    return stats
```

### Step 4: Run tests to verify they pass

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: All 3 tests PASS

### Step 5: Add pipeline API endpoints

Add to `app/main.py` after the `/api/stats` endpoint (after line 457):

```python
@app.get("/api/pipeline")
async def get_pipeline():
    db = app.state.db
    stats = await db.get_pipeline_stats()
    return {"stats": stats}

@app.get("/api/pipeline/{status}")
async def get_pipeline_jobs(status: str):
    db = app.state.db
    jobs = await db.get_pipeline_jobs(status)
    return {"jobs": jobs, "count": len(jobs)}
```

### Step 6: Add Pipeline view to frontend

Modify `app/static/js/app.js`:

1. Add route: In `getRoute()`, add `if (hash === '#/pipeline') return { view: 'pipeline' };`
2. Add handler: In `handleRoute()`, add `case 'pipeline': renderPipeline(container); break;`
3. Add nav link: In the nav HTML, add `<a href="#/pipeline" class="nav-link">Pipeline</a>` between Dashboard and Settings
4. Implement `renderPipeline(container)`:

```javascript
async function renderPipeline(container) {
    const statuses = ['interested', 'prepared', 'applied', 'interviewing', 'offered', 'rejected'];
    const statusLabels = {
        interested: 'Interested', prepared: 'Prepared', applied: 'Applied',
        interviewing: 'Interviewing', offered: 'Offered', rejected: 'Rejected'
    };
    const statusColors = {
        interested: 'var(--text-secondary)', prepared: 'var(--accent)',
        applied: 'var(--score-green)', interviewing: 'var(--score-amber)',
        offered: '#22c55e', rejected: 'var(--danger)'
    };

    // Fetch all pipeline data in parallel
    const results = await Promise.all(
        statuses.map(s => api.request('GET', `/api/pipeline/${s}`))
    );

    container.innerHTML = `
        <h1>Pipeline</h1>
        <div class="pipeline-board">
            ${statuses.map((status, i) => `
                <div class="pipeline-column">
                    <div class="pipeline-column-header" style="border-top: 3px solid ${statusColors[status]}">
                        <span>${statusLabels[status]}</span>
                        <span class="pipeline-count">${results[i].count}</span>
                    </div>
                    <div class="pipeline-cards">
                        ${results[i].jobs.map(job => `
                            <div class="card pipeline-card" onclick="navigate('#/job/${job.id}')">
                                <div class="pipeline-card-title">${escapeHtml(job.title)}</div>
                                <div class="pipeline-card-company">${escapeHtml(job.company)}</div>
                                ${job.match_score ? `<span class="score-badge ${getScoreClass(job.match_score)}" style="font-size:0.7rem">${job.match_score}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}
```

### Step 7: Add pipeline CSS

Add to `app/static/css/style.css`:

```css
/* Pipeline board */
.pipeline-board {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 12px;
    min-height: 400px;
}
.pipeline-column {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.pipeline-column-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 0.85rem;
}
.pipeline-count {
    background: var(--bg);
    padding: 2px 8px;
    border-radius: 99px;
    font-size: 0.75rem;
}
.pipeline-cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
}
.pipeline-card {
    padding: 10px;
    cursor: pointer;
}
.pipeline-card:hover {
    transform: translateY(-1px);
}
.pipeline-card-title {
    font-size: 0.8rem;
    font-weight: 500;
    margin-bottom: 4px;
}
.pipeline-card-company {
    font-size: 0.7rem;
    color: var(--text-secondary);
}

@media (max-width: 768px) {
    .pipeline-board {
        grid-template-columns: 1fr;
    }
}
```

### Step 8: Run full test suite and commit

Run: `uv run pytest -v`

```bash
git add app/database.py app/main.py app/static/js/app.js app/static/css/style.css tests/test_pipeline.py
git commit -m "Add application pipeline view with kanban columns"
```

---

## Task 6: One-Click Apply

**Problem:** Current workflow is: see job → click URL → external site → find apply button → use extension. Too many steps. The "Apply Now" button in job detail already exists but doesn't track the application or coordinate with the extension.

**Approach:** Add a `POST /api/jobs/{id}/apply` endpoint that marks the application as "applied", logs an event, and returns the apply URL. Wire the existing "Apply Now" button to call this endpoint first.

**Files:**
- Modify: `app/main.py` (add `/api/jobs/{id}/apply` endpoint)
- Modify: `app/static/js/app.js` (wire Apply Now button to new endpoint)
- Create: `tests/test_apply.py`

### Step 1: Write failing test

```python
# tests/test_apply.py
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import create_app
from app.database import Database


@pytest.fixture
async def app_and_db(tmp_path):
    application = create_app(db_path=str(tmp_path / "test.db"), testing=True)
    db = Database(str(tmp_path / "test.db"))
    await db.init()
    application.state.db = db
    yield application, db
    await db.close()


@pytest.fixture
async def client(app_and_db):
    app, _ = app_and_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_apply_endpoint(client, app_and_db):
    _, db = app_and_db
    job_id = await db.insert_job(
        title="Apply Test", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/job", posted_date=None,
        application_method="url", contact_email=None,
    )
    resp = await client.post(f"/api/jobs/{job_id}/apply")
    assert resp.status_code == 200
    data = resp.json()
    assert data["url"] == "https://example.com/job"
    assert data["status"] == "applied"

    app_record = await db.get_application(job_id)
    assert app_record["status"] == "applied"

    events = await db.get_events(job_id)
    assert any(e["event_type"] == "applied" for e in events)


@pytest.mark.asyncio
async def test_apply_uses_apply_url_when_available(client, app_and_db):
    _, db = app_and_db
    job_id = await db.insert_job(
        title="Apply URL Test", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/listing", posted_date=None,
        application_method="url", contact_email=None,
    )
    await db.update_job_contact(job_id, apply_url="https://example.com/apply-now")
    resp = await client.post(f"/api/jobs/{job_id}/apply")
    data = resp.json()
    assert data["url"] == "https://example.com/apply-now"
```

### Step 2: Run tests to verify they fail

Run: `uv run pytest tests/test_apply.py -v`
Expected: FAIL — `404` (endpoint doesn't exist)

### Step 3: Implement the endpoint

Add to `app/main.py` after the `/api/jobs/{job_id}/application` endpoint (after line 453):

```python
@app.post("/api/jobs/{job_id}/apply")
async def apply_to_job(job_id: int):
    db = app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    apply_url = job.get("apply_url") or job["url"]
    await db.upsert_application(job_id, status="applied")
    await db.add_event(job_id, "applied", "Applied via CareerPulse")
    return {"url": apply_url, "status": "applied"}
```

### Step 4: Run tests to verify they pass

Run: `uv run pytest tests/test_apply.py -v`
Expected: All 2 tests PASS

### Step 5: Wire frontend Apply Now button

Modify `app/static/js/app.js` — find the existing "Apply Now" button click handler in `renderJobDetailContent()` and change it to:

```javascript
// When Apply Now is clicked:
const applyBtn = container.querySelector('#apply-btn');
if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
        try {
            const result = await api.request('POST', `/api/jobs/${jobId}/apply`);
            window.open(result.url, '_blank');
            renderJobDetail(document.getElementById('app'), jobId); // Refresh detail
        } catch (err) {
            showToast('Failed to apply: ' + err.message, 'error');
        }
    });
}
```

### Step 6: Run full test suite and commit

Run: `uv run pytest -v`

```bash
git add app/main.py app/static/js/app.js tests/test_apply.py
git commit -m "Add one-click apply with auto status tracking"
```

---

## Task 7: Standalone Cover Letter Editor

**Problem:** `tailoring.py` generates cover letters alongside tailored resumes in the "prepare" flow, but the prompt is generic and uses only resume text. Users need standalone, higher-quality cover letters that leverage the full profile, company research, and match data.

**Approach:** Add a dedicated cover letter generation module with a better prompt. Add a "Generate Cover Letter" button in job detail that produces an editable letter in a textarea. Save edits back via the existing application update endpoint.

**Files:**
- Create: `app/cover_letter.py`
- Modify: `app/main.py` (add `/api/jobs/{id}/generate-cover-letter` endpoint)
- Modify: `app/static/js/app.js` (add generate button + editor in job detail)
- Create: `tests/test_cover_letter.py`

### Step 1: Write failing test

```python
# tests/test_cover_letter.py
import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from app.cover_letter import generate_cover_letter


@pytest.mark.asyncio
async def test_cover_letter_generation():
    mock_client = MagicMock()
    mock_client.chat = AsyncMock(return_value=json.dumps({
        "cover_letter": "Dear Hiring Manager,\n\nI am excited to apply for the Senior DevOps role at TechCorp..."
    }))

    result = await generate_cover_letter(
        client=mock_client,
        job_title="Senior DevOps Engineer",
        company="TechCorp",
        job_description="We need a DevOps engineer with K8s experience...",
        resume_text="10 years DevOps experience with Kubernetes, AWS, Terraform...",
        profile={"full_name": "John Doe", "location": "Denver, CO"},
        match_reasons=["Strong Kubernetes experience", "AWS certified"],
    )
    assert "cover_letter" in result
    assert len(result["cover_letter"]) > 0
    mock_client.chat.assert_called_once()
    prompt = mock_client.chat.call_args[0][0]
    assert "TechCorp" in prompt
    assert "DevOps" in prompt


@pytest.mark.asyncio
async def test_cover_letter_handles_ai_error():
    mock_client = MagicMock()
    mock_client.chat = AsyncMock(side_effect=Exception("API error"))

    result = await generate_cover_letter(
        client=mock_client,
        job_title="Test",
        company="Co",
        job_description="desc",
        resume_text="resume",
        profile={},
    )
    assert result["cover_letter"] == ""
```

### Step 2: Run tests to verify they fail

Run: `uv run pytest tests/test_cover_letter.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.cover_letter'`

### Step 3: Implement cover letter module

```python
# app/cover_letter.py
import logging

from app.ai_client import parse_json_response

logger = logging.getLogger(__name__)

COVER_LETTER_PROMPT = """Write a professional cover letter for this specific job application.

CANDIDATE PROFILE:
Name: {name}
Location: {location}

CANDIDATE RESUME:
{resume}

JOB DETAILS:
Title: {job_title}
Company: {company}
Description: {job_description}

WHY THIS IS A GOOD MATCH:
{match_reasons}

INSTRUCTIONS:
- 250-350 words, 3-4 paragraphs
- Opening: specific reference to the role and company — no generic "I'm writing to express interest"
- Body: connect 2-3 specific accomplishments from the resume to job requirements
- Closing: express genuine enthusiasm, include availability
- Tone: confident professional, not desperate or overly formal
- DO NOT fabricate any experience or skills not in the resume

Return ONLY valid JSON:
{{"cover_letter": "<the full cover letter text>"}}"""


async def generate_cover_letter(
    client,
    job_title: str,
    company: str,
    job_description: str,
    resume_text: str,
    profile: dict,
    match_reasons: list[str] | None = None,
) -> dict:
    try:
        prompt = COVER_LETTER_PROMPT.format(
            name=profile.get("full_name", ""),
            location=profile.get("location", ""),
            resume=resume_text,
            job_title=job_title,
            company=company,
            job_description=job_description,
            match_reasons="\n".join(f"- {r}" for r in (match_reasons or ["General match"])),
        )
        raw = await client.chat(prompt, max_tokens=2048)
        return parse_json_response(raw)
    except Exception as e:
        logger.error(f"Cover letter generation failed: {e}")
        return {"cover_letter": ""}
```

### Step 4: Run tests to verify they pass

Run: `uv run pytest tests/test_cover_letter.py -v`
Expected: All 2 tests PASS

### Step 5: Add endpoint to main.py

Add after the `/api/jobs/{job_id}/email` endpoint:

```python
@app.post("/api/jobs/{job_id}/generate-cover-letter")
async def generate_cover_letter_endpoint(job_id: int):
    db = app.state.db
    client = app.state.ai_client
    if not client:
        raise HTTPException(503, "AI client not configured")

    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    config = await db.get_search_config()
    resume_text = config["resume_text"] if config else ""
    profile = await db.get_user_profile() or {}
    score = await db.get_score(job_id)
    match_reasons = score["match_reasons"] if score else []

    from app.cover_letter import generate_cover_letter
    result = await generate_cover_letter(
        client=client,
        job_title=job["title"],
        company=job["company"],
        job_description=job.get("description") or "",
        resume_text=resume_text,
        profile=profile,
        match_reasons=match_reasons,
    )

    # Save to application record
    app_record = await db.get_application(job_id)
    if app_record:
        await db.update_application(app_record["id"], cover_letter=result["cover_letter"])
    else:
        app_id = await db.insert_application(job_id, status="interested")
        await db.update_application(app_id, cover_letter=result["cover_letter"])

    return result
```

### Step 6: Add generate button + editor to frontend

Modify `app/static/js/app.js` — in the job detail sidebar, add a "Generate Cover Letter" button that:
1. Calls `POST /api/jobs/{jobId}/generate-cover-letter`
2. Shows a loading spinner while generating
3. On success, displays the letter in an editable `<textarea>`
4. Adds a "Save Edits" button that calls the existing application update endpoint
5. Adds a "Copy" button to copy the letter to clipboard

### Step 7: Run full test suite and commit

Run: `uv run pytest -v`

```bash
git add app/cover_letter.py app/main.py app/static/js/app.js tests/test_cover_letter.py
git commit -m "Add standalone cover letter generation with editor"
```

---

## Task 8: More Scrapers (Wellfound, BuiltIn)

**Problem:** More sources = more coverage = better chance of finding the right job. Wellfound (AngelList) and BuiltIn are major boards not yet covered.

**Approach:** Add two new scrapers following the existing `BaseScraper` pattern. Both have public job search pages that return HTML we can parse.

**Files:**
- Create: `app/scrapers/wellfound.py`
- Create: `app/scrapers/builtin.py`
- Modify: `app/scrapers/__init__.py` (add to ALL_SCRAPERS)
- Create: `tests/test_scrapers/test_wellfound.py`
- Create: `tests/test_scrapers/test_builtin.py`

### Step 1: Research Wellfound page structure

Fetch `https://wellfound.com/jobs` in a browser and inspect the job card HTML structure. Look for:
- Job card container element and class
- Title, company, location, URL selectors
- Pagination pattern (infinite scroll vs. page params)
- Whether data is in HTML or loaded via JS (Next.js data props, JSON-LD)

Document the selectors found before writing code.

### Step 2: Write failing Wellfound scraper test

```python
# tests/test_scrapers/test_wellfound.py
import re
import pytest
from app.scrapers.wellfound import WellfoundScraper

MOCK_WELLFOUND_HTML = """
<!-- Populate with actual HTML structure from Step 1 -->
"""

@pytest.mark.asyncio
async def test_wellfound_parse(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r"https://wellfound\.com/.*"),
        text=MOCK_WELLFOUND_HTML,
    )
    scraper = WellfoundScraper(search_terms=["devops"])
    jobs = await scraper.scrape()
    assert len(jobs) > 0
    assert jobs[0].title
    assert jobs[0].company
    assert jobs[0].source == "wellfound"
```

### Step 3: Implement Wellfound scraper

```python
# app/scrapers/wellfound.py
import logging
import httpx
from bs4 import BeautifulSoup
from app.scrapers.base import BaseScraper, JobListing

logger = logging.getLogger(__name__)

class WellfoundScraper(BaseScraper):
    source_name = "wellfound"

    async def scrape(self) -> list[JobListing]:
        listings = []
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        for term in (self.search_terms or ["software engineer"]):
            try:
                async with httpx.AsyncClient(headers=headers, timeout=15.0, follow_redirects=True) as client:
                    resp = await client.get(
                        f"https://wellfound.com/jobs",
                        params={"query": term, "remote": "true"},
                    )
                    resp.raise_for_status()
            except Exception as e:
                logger.error(f"Wellfound fetch failed for '{term}': {e}")
                continue

            soup = BeautifulSoup(resp.text, "html.parser")
            # Parse job cards — selectors depend on Step 1 research
            # This is a template; adjust selectors based on actual HTML
            for card in soup.select("[data-test='JobCard'], .styles_component__card"):
                title_el = card.select_one("a[data-test='jobTitle'], h2 a")
                company_el = card.select_one("[data-test='companyName'], .styles_component__companyName")
                location_el = card.select_one("[data-test='location'], .styles_component__location")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                url = "https://wellfound.com" + title_el.get("href", "") if title_el.get("href", "").startswith("/") else title_el.get("href", "")
                listings.append(JobListing(
                    title=title,
                    company=company_el.get_text(strip=True) if company_el else "Unknown",
                    location=location_el.get_text(strip=True) if location_el else "Remote",
                    description="",
                    url=url,
                    source=self.source_name,
                ))
        return listings
```

### Step 4: Run Wellfound test

Run: `uv run pytest tests/test_scrapers/test_wellfound.py -v`

### Step 5: Research BuiltIn page structure

Same process as Step 1 but for `https://builtin.com/jobs/remote/dev-engineering`.

### Step 6: Write failing BuiltIn scraper test

```python
# tests/test_scrapers/test_builtin.py
import re
import pytest
from app.scrapers.builtin import BuiltInScraper

MOCK_BUILTIN_HTML = """
<!-- Populate with actual HTML structure from Step 5 -->
"""

@pytest.mark.asyncio
async def test_builtin_parse(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r"https://builtin\.com/.*"),
        text=MOCK_BUILTIN_HTML,
    )
    scraper = BuiltInScraper(search_terms=["devops"])
    jobs = await scraper.scrape()
    assert len(jobs) > 0
    assert jobs[0].source == "builtin"
```

### Step 7: Implement BuiltIn scraper

Follow same pattern as Wellfound — `BaseScraper` subclass, httpx fetch, BeautifulSoup parse.

### Step 8: Add to ALL_SCRAPERS

Modify `app/scrapers/__init__.py`:

```python
from app.scrapers.wellfound import WellfoundScraper
from app.scrapers.builtin import BuiltInScraper

ALL_SCRAPERS = [
    HackerNewsScraper, RemotiveScraper, USAJobsScraper,
    LinkedInScraper, DiceScraper,
    ArbeitnowScraper, JobicyScraper, IndeedScraper,
    RemoteOKScraper, HimalayasScraper,
    WellfoundScraper, BuiltInScraper,
]
```

### Step 9: Run full test suite and commit

Run: `uv run pytest -v`

```bash
git add app/scrapers/wellfound.py app/scrapers/builtin.py app/scrapers/__init__.py tests/test_scrapers/
git commit -m "Add Wellfound and BuiltIn scrapers"
```

---

## Appendix: Test Fixture Reference

All test files in this plan use this pattern for the DB fixture:

```python
@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()
```

`pytest-asyncio` is configured with `asyncio_mode = "auto"` in `pyproject.toml`, so no `@pytest.mark.asyncio` decorator configuration is needed beyond the marker itself.

`pytest-httpx` is already a dev dependency — use `httpx_mock` fixture parameter for HTTP mocking.

Run commands always use `uv run pytest` per project conventions.
