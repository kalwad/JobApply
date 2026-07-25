import json
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.resume_analyzer import (
    analyze_resume,
    clamp_seniority,
    professional_years,
    sanitize_content_issues,
    seniority_from_years,
    validate_employment_dates,
)


@pytest.mark.asyncio
async def test_analyze_resume_extracts_terms():
    mock_client = MagicMock()
    mock_client.chat = AsyncMock(return_value=json.dumps({
        "search_terms": ["Software Engineer", "Data Analyst"],
        "job_titles": [{"title": "Software Engineer", "why": "python experience", "evidence": ["Python"]}],
        "key_skills": ["Python", "SQL"],
        "seniority": "mid",
        "summary": "Solid software foundation",
        "content_heuristic_score": 72,
        "content_issues": [],
        "content_tips": [],
    }))
    result = await analyze_resume(
        mock_client,
        "Software engineer with Python...",
        today=date(2026, 7, 25),
        work_history=[{
            "company": "Acme",
            "start_month": 6,
            "start_year": 2023,
            "end_month": None,
            "end_year": None,
            "is_current": 1,
        }],
    )
    assert "Software Engineer" in result["search_terms"]
    assert result["job_titles"][0]["title"] == "Software Engineer"
    assert "Python" in result["key_skills"]
    assert result["seniority"] in ("mid", "junior", "entry", "senior")  # clamped by years
    assert result["summary"] == "Solid software foundation"
    assert result["content_heuristic_score"] == 72


@pytest.mark.asyncio
async def test_analyze_resume_handles_error():
    mock_client = MagicMock()
    mock_client.chat = AsyncMock(side_effect=Exception("API error"))
    result = await analyze_resume(mock_client, "some resume")
    assert result["search_terms"] == []
    assert result["job_titles"] == []


@pytest.mark.asyncio
async def test_analyze_resume_handles_bad_json():
    mock_client = MagicMock()
    mock_client.chat = AsyncMock(return_value="not json")
    result = await analyze_resume(mock_client, "some resume")
    assert result["search_terms"] == []


def test_june_2026_present_is_valid_in_july_2026():
    """Regression: June 2026–Present must NOT be flagged as future-dated in July 2026."""
    today = date(2026, 7, 25)
    history = [{
        "company": "PulseMo Technologies",
        "start_month": 6,
        "start_year": 2026,
        "end_month": None,
        "end_year": None,
        "is_current": 1,
    }]
    assert validate_employment_dates(history, today) == []
    # Hallucinated "created in 2023" claims are stripped
    cleaned = sanitize_content_issues(
        [
            "Future-dated job experience (PulseMo Technologies, June 2026 – Present) when resume was created in 2023",
            "Missing Summary section",
        ],
        history,
        today,
    )
    assert not any("future" in i.lower() for i in cleaned)
    assert not any("created in 2023" in i.lower() for i in cleaned)


def test_truly_future_start_is_flagged():
    today = date(2026, 7, 25)
    history = [{
        "company": "Future Corp",
        "start_month": 1,
        "start_year": 2027,
        "is_current": 1,
    }]
    issues = validate_employment_dates(history, today)
    assert len(issues) == 1
    assert "2027" in issues[0]


def test_seniority_clamped_by_experience_years():
    history = [{
        "company": "Acme",
        "start_month": 6,
        "start_year": 2025,
        "is_current": 1,
    }]
    today = date(2026, 7, 25)
    years = professional_years(history, today)
    assert years < 2
    assert seniority_from_years(years) in ("intern", "entry", "junior")
    assert clamp_seniority("senior", history, today) != "senior"
    assert clamp_seniority("principal", history, today) in ("intern", "entry", "junior", "mid")
    assert clamp_seniority("senior/staff/lead/principal", [], today) == "unknown"
