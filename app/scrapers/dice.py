import json
import logging
import re
from urllib.parse import quote_plus, urlencode

import httpx
from bs4 import BeautifulSoup

from app.scrapers.base import BaseScraper, JobListing

logger = logging.getLogger(__name__)


class _DiceGone(Exception):
    """Raised when a Dice detail page returns 410 Gone."""
    pass


class DiceScraper(BaseScraper):
    source_name = "dice"

    BASE_URL = "https://www.dice.com/jobs"

    def _build_params(self, query: str, page: int = 1) -> dict:
        return {
            "q": query,
            "countryCode": "US",
            "radius": "30",
            "radiusUnit": "mi",
            "page": str(page),
            "pageSize": "20",
            "language": "en",
        }

    def _extract_jobs_from_html(self, html: str) -> list[dict]:
        """Extract job data from Next.js embedded JSON in Dice's HTML."""
        jobs = []
        try:
            # Dice uses Next.js streaming — job data is in self.__next_f.push() chunks
            chunks = []
            for m in re.finditer(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.DOTALL):
                chunks.append(m.group(1))

            if not chunks:
                return []

            combined = "".join(chunks)
            combined = combined.encode().decode("unicode_escape")

            # Find the jobList data array
            idx = combined.find('"jobList":{"data":[')
            if idx < 0:
                return []

            arr_start = combined.find("[", idx)
            arr_end = combined.find('],"meta"', arr_start)
            if arr_end < 0:
                # Fallback: find the matching bracket
                arr_end = combined.find("]}", arr_start)
            if arr_end < 0:
                return []

            arr_str = combined[arr_start : arr_end + 1]
            jobs = json.loads(arr_str)
        except Exception as e:
            logger.warning(f"Dice JSON extraction failed: {e}")
            # Fallback: try extracting individual job objects
            try:
                for m in re.finditer(
                    r'\{"id":"[^"]+","guid":"[^"]+".*?"title":"[^"]+?".*?\}',
                    combined,
                ):
                    try:
                        jobs.append(json.loads(m.group()))
                    except json.JSONDecodeError:
                        continue
            except Exception:
                pass

        return jobs

    def _parse_salary(self, salary_str: str) -> tuple[int | None, int | None]:
        if not salary_str:
            return None, None
        # Extract all number sequences (with or without commas)
        numbers = re.findall(r"[\d,]+", salary_str)
        clean_numbers = []
        for n in numbers:
            n = n.replace(",", "")
            if n.isdigit():
                val = int(n)
                # Skip hourly rates that look like salary (< 500 is likely hourly)
                if val >= 500:
                    clean_numbers.append(val)
        if len(clean_numbers) >= 2:
            return clean_numbers[0], clean_numbers[1]
        elif len(clean_numbers) == 1:
            return clean_numbers[0], None
        return None, None

    async def _fetch_full_description(self, client: httpx.AsyncClient, url: str) -> str | None:
        """Fetch the full job description from a Dice detail page.

        Returns description text, or None if unavailable.
        Raises _DiceGone if the listing has been removed (410).
        """
        if not url:
            return None
        try:
            resp = await self.rate_limited_get(client, url)
            if resp.status_code == 410:
                raise _DiceGone(url)
            resp.raise_for_status()
        except _DiceGone:
            raise
        except Exception as e:
            logger.debug(f"Dice detail fetch failed for {url}: {e}")
            return None
        soup = BeautifulSoup(resp.content, "html.parser")
        # Try JSON-LD first — Dice renders descriptions client-side but includes them in structured data
        for script in soup.select('script[type="application/ld+json"]'):
            try:
                data = json.loads(script.string)
                desc_html = data.get("description", "")
                if desc_html:
                    text = BeautifulSoup(desc_html, "html.parser").get_text(separator="\n", strip=True)
                    if len(text) > 100:
                        return text
            except (json.JSONDecodeError, TypeError):
                continue
        # Fallback to DOM selectors
        el = soup.select_one('[data-testid="jobDescriptionHtml"], .job-description, #jobDescription')
        if el:
            text = el.get_text(separator="\n", strip=True)
            return text if len(text) > 100 else None
        return None

    async def scrape(self) -> list[JobListing]:
        queries = self.search_terms[:10] if self.search_terms else ["devops remote", "SRE remote", "platform engineer remote"]
        all_jobs = []
        seen_ids = set()

        async with self.get_client() as client:
            for query in queries:
                for page in range(1, 3):  # 2 pages per query
                    params = self._build_params(query, page)
                    url = f"{self.BASE_URL}?{urlencode(params)}"

                    try:
                        resp = await self.rate_limited_get(client, url)
                        resp.raise_for_status()
                    except httpx.HTTPStatusError as e:
                        logger.error(f"Dice HTTP {e.response.status_code} for '{query}' page {page}")
                        continue
                    except (httpx.TimeoutException, httpx.ConnectError) as e:
                        logger.error(f"Dice fetch failed for '{query}' page {page}: {e}")
                        continue

                    raw_jobs = self._extract_jobs_from_html(resp.text)
                    logger.info(f"Dice: '{query}' page {page} returned {len(raw_jobs)} jobs")

                    for job in raw_jobs:
                        job_id = job.get("id") or job.get("guid", "")
                        if job_id in seen_ids:
                            continue
                        seen_ids.add(job_id)

                        title = job.get("title", "")
                        if not title:
                            continue

                        loc = job.get("jobLocation", {})
                        location_parts = []
                        if loc.get("city"):
                            location_parts.append(loc["city"])
                        if loc.get("region"):
                            location_parts.append(loc["region"])
                        location = ", ".join(location_parts) or "Remote"

                        if job.get("isRemote"):
                            location = f"Remote - {location}" if location != "Remote" else "Remote"

                        salary_min, salary_max = self._parse_salary(job.get("salary", ""))

                        tags = []
                        if job.get("employmentType"):
                            tags.append(job["employmentType"])
                        if job.get("workplaceTypes"):
                            tags.extend(job["workplaceTypes"])

                        detail_url = job.get("detailsPageUrl", "")
                        # Programmatic jobs use apply-redirect URLs with no detail page;
                        # construct the real detail URL from the guid instead
                        if "/apply-redirect" in detail_url:
                            guid = job.get("guid", "")
                            if guid:
                                detail_url = f"https://www.dice.com/job-detail/{guid}"
                            else:
                                detail_url = ""

                        description = job.get("summary", "")
                        try:
                            full_desc = await self._fetch_full_description(client, detail_url)
                            if full_desc:
                                description = full_desc
                        except _DiceGone:
                            logger.debug(f"Dice listing gone (410): {title}")
                            continue

                        all_jobs.append(
                            JobListing(
                                title=title,
                                company=job.get("companyName", ""),
                                location=location,
                                description=description,
                                url=detail_url,
                                source=self.source_name,
                                salary_min=salary_min,
                                salary_max=salary_max,
                                posted_date=job.get("postedDate"),
                                tags=tags,
                            )
                        )

        logger.info(f"Dice scraper found {len(all_jobs)} unique jobs")
        return all_jobs
