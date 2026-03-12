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


# Database integration tests

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
    jobs = await db.get_jobs_needing_enrichment()
    assert all(j["id"] != job_id for j in jobs)
