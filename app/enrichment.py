import logging
import re

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
}


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
