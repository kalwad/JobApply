# LinkedIn Enrichment Hardening

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make LinkedIn job description enrichment reliable by using the guest API endpoint first, falling back to Playwright headless browser when that fails.

**Architecture:** Refactor `enrich_job_description()` into a strategy chain for LinkedIn: try the guest jobs API (`/jobs-guest/jobs/api/jobPosting/{jobId}`) first (lightweight httpx call), then fall back to Playwright if the guest API returns no description. Non-LinkedIn sources keep current behavior unchanged. Playwright is an optional dependency — enrichment degrades gracefully if not installed.

**Tech Stack:** httpx (existing), BeautifulSoup (existing), playwright (new optional dep)

---

### Task 1: Add playwright dependency

**Files:**
- Modify: `pyproject.toml`

**Step 1: Add playwright as optional dependency**

In `pyproject.toml`, add a `playwright` optional dependency group:

```toml
[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "pytest-httpx>=0.35.0",
    "httpx>=0.28.0",
]
playwright = [
    "playwright>=1.40.0",
]
```

**Step 2: Install and set up playwright**

Run:
```bash
uv pip install playwright
uv run playwright install chromium
```

**Step 3: Commit**

```bash
git add pyproject.toml
git commit -m "Add playwright as optional dependency for enrichment fallback"
```

---

### Task 2: Extract LinkedIn job ID helper and add guest API fetcher

**Files:**
- Modify: `app/enrichment.py`
- Test: `tests/test_enrichment.py`

**Step 1: Write the failing tests**

Add to `tests/test_enrichment.py`:

```python
from app.enrichment import extract_linkedin_job_id, fetch_linkedin_guest_api


def test_extract_job_id_from_standard_url():
    url = "https://www.linkedin.com/jobs/view/4567890123"
    assert extract_linkedin_job_id(url) == "4567890123"


def test_extract_job_id_from_url_with_slug():
    url = "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4567890123"
    assert extract_linkedin_job_id(url) == "4567890123"


def test_extract_job_id_returns_none_for_non_linkedin():
    assert extract_linkedin_job_id("https://dice.com/job/123") is None


MOCK_GUEST_API_RESPONSE = """
<html><body>
<div class="description__text">
  <p>We need a Platform Engineer with strong Kubernetes skills.</p>
  <p>Requirements: 5+ years infrastructure experience, Terraform, AWS.</p>
</div>
</body></html>
"""


@pytest.mark.asyncio
async def test_fetch_linkedin_guest_api_success(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r"https://www\.linkedin\.com/jobs-guest/jobs/api/jobPosting/.*"),
        text=MOCK_GUEST_API_RESPONSE,
    )
    result = await fetch_linkedin_guest_api("4567890123")
    assert result is not None
    assert "Platform Engineer" in result
    assert "Kubernetes" in result


@pytest.mark.asyncio
async def test_fetch_linkedin_guest_api_returns_none_on_error(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r"https://www\.linkedin\.com/jobs-guest/jobs/api/jobPosting/.*"),
        status_code=429,
    )
    result = await fetch_linkedin_guest_api("4567890123")
    assert result is None
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_enrichment.py -v -k "job_id or guest_api"`
Expected: FAIL — `extract_linkedin_job_id` and `fetch_linkedin_guest_api` not defined

**Step 3: Implement the functions**

In `app/enrichment.py`, add these functions:

```python
import re

def extract_linkedin_job_id(url: str) -> str | None:
    """Extract the numeric job ID from a LinkedIn job URL."""
    match = re.search(r"linkedin\.com/jobs/view/(?:.*?[-/])?(\d{8,})", url)
    return match.group(1) if match else None


async def fetch_linkedin_guest_api(job_id: str) -> str | None:
    """Fetch job description from LinkedIn's guest jobs API."""
    url = f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as e:
        logger.warning(f"LinkedIn guest API failed for job {job_id}: {e}")
        return None

    soup = BeautifulSoup(resp.content, "html.parser")
    el = soup.select_one(".description__text, .show-more-less-html__markup")
    if el:
        text = el.get_text(separator="\n", strip=True)
        return text if len(text) > 50 else None
    return None
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_enrichment.py -v -k "job_id or guest_api"`
Expected: PASS

**Step 5: Commit**

```bash
git add app/enrichment.py tests/test_enrichment.py
git commit -m "Add LinkedIn guest API fetcher and job ID extractor"
```

---

### Task 3: Add Playwright fallback fetcher

**Files:**
- Modify: `app/enrichment.py`
- Test: `tests/test_enrichment.py`

**Step 1: Write the failing test**

Add to `tests/test_enrichment.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch

@pytest.mark.asyncio
async def test_fetch_linkedin_playwright_success():
    """Test Playwright fetcher with mocked browser."""
    from app.enrichment import fetch_linkedin_playwright

    mock_page = AsyncMock()
    mock_page.goto = AsyncMock()
    mock_page.wait_for_selector = AsyncMock()
    mock_page.query_selector = AsyncMock()

    mock_element = AsyncMock()
    mock_element.inner_text = AsyncMock(return_value="Full job description from Playwright with enough content to pass the length check easily")
    mock_page.query_selector.return_value = mock_element

    mock_context = AsyncMock()
    mock_context.new_page = AsyncMock(return_value=mock_page)
    mock_context.__aenter__ = AsyncMock(return_value=mock_context)
    mock_context.__aexit__ = AsyncMock(return_value=False)

    mock_browser = AsyncMock()
    mock_browser.new_context = AsyncMock(return_value=mock_context)

    mock_pw_instance = AsyncMock()
    mock_pw_instance.chromium.launch = AsyncMock(return_value=mock_browser)

    mock_pw = AsyncMock()
    mock_pw.__aenter__ = AsyncMock(return_value=mock_pw_instance)
    mock_pw.__aexit__ = AsyncMock(return_value=False)

    with patch("app.enrichment.async_playwright", return_value=mock_pw):
        result = await fetch_linkedin_playwright("https://www.linkedin.com/jobs/view/123456789")

    assert result is not None
    assert "Full job description" in result


@pytest.mark.asyncio
async def test_fetch_linkedin_playwright_not_installed():
    """Returns None when playwright is not installed."""
    from app.enrichment import fetch_linkedin_playwright

    with patch("app.enrichment.PLAYWRIGHT_AVAILABLE", False):
        result = await fetch_linkedin_playwright("https://www.linkedin.com/jobs/view/123456789")
    assert result is None
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_enrichment.py -v -k "playwright"`
Expected: FAIL — `fetch_linkedin_playwright` not defined

**Step 3: Implement Playwright fetcher**

In `app/enrichment.py`, add at the top (after existing imports):

```python
try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    async_playwright = None
    PLAYWRIGHT_AVAILABLE = False
```

Then add the function:

```python
async def fetch_linkedin_playwright(url: str) -> str | None:
    """Fetch LinkedIn job description using headless browser."""
    if not PLAYWRIGHT_AVAILABLE:
        logger.debug("Playwright not installed, skipping browser fallback")
        return None

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_selector(
                ".show-more-less-html__markup, .description__text, .jobs-description__content",
                timeout=10000,
            )
            el = await page.query_selector(
                ".show-more-less-html__markup, .description__text, .jobs-description__content"
            )
            if el:
                text = await el.inner_text()
                await browser.close()
                return text.strip() if len(text.strip()) > 50 else None
            await browser.close()
    except Exception as e:
        logger.warning(f"Playwright enrichment failed for {url}: {e}")
    return None
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_enrichment.py -v -k "playwright"`
Expected: PASS

**Step 5: Commit**

```bash
git add app/enrichment.py tests/test_enrichment.py
git commit -m "Add Playwright fallback fetcher for LinkedIn enrichment"
```

---

### Task 4: Wire up the strategy chain in enrich_job_description

**Files:**
- Modify: `app/enrichment.py`
- Test: `tests/test_enrichment.py`

**Step 1: Write the failing test**

Add to `tests/test_enrichment.py`:

```python
@pytest.mark.asyncio
async def test_linkedin_enrichment_uses_guest_api_first(httpx_mock):
    """Guest API is tried before falling back to direct fetch."""
    guest_response = """
    <html><body>
    <div class="description__text">
      <p>Guest API description with enough content to be valid and pass length checks.</p>
    </div>
    </body></html>
    """
    httpx_mock.add_response(
        url=re.compile(r"https://www\.linkedin\.com/jobs-guest/jobs/api/jobPosting/.*"),
        text=guest_response,
    )
    result = await enrich_job_description(
        "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4567890123", "linkedin"
    )
    assert result is not None
    assert "Guest API description" in result


@pytest.mark.asyncio
async def test_linkedin_falls_back_to_direct_when_guest_api_fails(httpx_mock):
    """When guest API returns 429, fall back to direct page fetch."""
    httpx_mock.add_response(
        url=re.compile(r"https://www\.linkedin\.com/jobs-guest/jobs/api/jobPosting/.*"),
        status_code=429,
    )
    httpx_mock.add_response(
        url=re.compile(r"https://www\.linkedin\.com/jobs/view/.*"),
        text=MOCK_LINKEDIN_DETAIL,
    )
    with patch("app.enrichment.fetch_linkedin_playwright", new_callable=AsyncMock, return_value=None):
        result = await enrich_job_description(
            "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4567890123", "linkedin"
        )
    assert result is not None
    assert "Senior DevOps Engineer" in result
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_enrichment.py -v -k "guest_api_first or falls_back"`
Expected: FAIL — current `enrich_job_description` doesn't use guest API

**Step 3: Refactor enrich_job_description for LinkedIn strategy chain**

Replace the current `enrich_job_description` function in `app/enrichment.py`:

```python
async def enrich_job_description(url: str, source: str) -> str | None:
    """Fetch a job detail page and extract the full description text.

    For LinkedIn, tries strategies in order:
    1. Guest jobs API (lightweight, no JS)
    2. Playwright headless browser (if installed)
    3. Direct page fetch (original behavior)
    """
    if source == "linkedin":
        return await _enrich_linkedin(url)

    return await _fetch_and_extract(url, source)


async def _enrich_linkedin(url: str) -> str | None:
    """Try multiple strategies to get LinkedIn job description."""
    # Strategy 1: Guest API
    job_id = extract_linkedin_job_id(url)
    if job_id:
        desc = await fetch_linkedin_guest_api(job_id)
        if desc:
            logger.debug(f"LinkedIn enrichment via guest API for job {job_id}")
            return desc

    # Strategy 2: Playwright
    desc = await fetch_linkedin_playwright(url)
    if desc:
        logger.debug(f"LinkedIn enrichment via Playwright for {url}")
        return desc

    # Strategy 3: Direct fetch (original)
    return await _fetch_and_extract(url, "linkedin")


async def _fetch_and_extract(url: str, source: str) -> str | None:
    """Original direct-fetch enrichment logic."""
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
```

**Step 4: Run full test suite**

Run: `uv run pytest tests/test_enrichment.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add app/enrichment.py tests/test_enrichment.py
git commit -m "Wire LinkedIn enrichment strategy chain: guest API -> Playwright -> direct"
```

---

### Task 5: Run full test suite and verify

**Step 1: Run all tests**

Run: `uv run pytest -v`
Expected: All tests pass, no regressions

**Step 2: Manual smoke test**

Run: `uv run python -c "from app.enrichment import extract_linkedin_job_id, fetch_linkedin_guest_api; import asyncio; print(extract_linkedin_job_id('https://www.linkedin.com/jobs/view/senior-sre-at-acme-4567890123'))"`
Expected: Prints `4567890123`

**Step 3: Commit any fixups if needed, then done**
