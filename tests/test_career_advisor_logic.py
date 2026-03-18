import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.career_advisor import analyze_career


@pytest.fixture
def mock_client():
    client = MagicMock()
    client.chat = AsyncMock()
    return client


async def test_analyze_career_returns_list(mock_client):
    suggestions = [
        {"title": "DevOps Lead", "reasoning": "Strong infra background",
         "transferable_skills": ["AWS", "K8s"], "gaps": ["management"]},
        {"title": "SRE Manager", "reasoning": "Ops experience",
         "transferable_skills": ["monitoring"], "gaps": ["people skills"]},
    ]
    mock_client.chat = AsyncMock(return_value=json.dumps(suggestions))
    result = await analyze_career(
        mock_client, work_history="10 years infra",
        skills="AWS, K8s, Python", search_terms="DevOps, SRE",
    )
    assert len(result) == 2
    assert result[0]["title"] == "DevOps Lead"


async def test_analyze_career_dict_with_suggestions_key(mock_client):
    mock_client.chat = AsyncMock(return_value=json.dumps({
        "suggestions": [{"title": "PM", "reasoning": "x", "transferable_skills": [], "gaps": []}]
    }))
    result = await analyze_career(mock_client, "history", "skills", "terms")
    assert len(result) == 1
    assert result[0]["title"] == "PM"


async def test_analyze_career_single_dict_wrapped(mock_client):
    single = {"title": "Architect", "reasoning": "deep tech", "transferable_skills": [], "gaps": []}
    mock_client.chat = AsyncMock(return_value=json.dumps(single))
    result = await analyze_career(mock_client, "history", "skills", "terms")
    assert len(result) == 1
    assert result[0]["title"] == "Architect"


async def test_analyze_career_markdown_wrapped(mock_client):
    suggestions = [{"title": "CTO", "reasoning": "leader", "transferable_skills": [], "gaps": []}]
    mock_client.chat = AsyncMock(return_value=f"```json\n{json.dumps(suggestions)}\n```")
    result = await analyze_career(mock_client, "history", "skills", "terms")
    assert len(result) == 1


async def test_analyze_career_api_error(mock_client):
    mock_client.chat = AsyncMock(side_effect=Exception("rate limit"))
    result = await analyze_career(mock_client, "history", "skills", "terms")
    assert result == []


async def test_analyze_career_bad_json(mock_client):
    mock_client.chat = AsyncMock(return_value="I think you should try...")
    result = await analyze_career(mock_client, "history", "skills", "terms")
    assert result == []


async def test_analyze_career_prompt_contents(mock_client):
    mock_client.chat = AsyncMock(return_value="[]")
    await analyze_career(
        mock_client, work_history="Senior Engineer at Acme",
        skills="Python, Go", search_terms="backend, platform",
    )
    prompt = mock_client.chat.call_args[0][0]
    assert "Senior Engineer at Acme" in prompt
    assert "Python, Go" in prompt
    assert "backend, platform" in prompt
