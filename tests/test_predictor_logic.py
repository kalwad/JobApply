import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.predictor import predict_success


@pytest.fixture
def mock_client():
    client = MagicMock()
    client.chat = AsyncMock()
    return client


async def test_predict_success_valid_response(mock_client):
    response = {"probability": 75, "confidence": "medium", "reasoning": ["Good match", "Strong skills"]}
    mock_client.chat = AsyncMock(return_value=json.dumps(response))
    result = await predict_success(
        mock_client, history="Applied to 5 jobs, 2 interviews",
        title="DevOps Engineer", company="TechCo",
        description="We need a DevOps engineer with AWS experience",
    )
    assert result["probability"] == 75
    assert result["confidence"] == "medium"
    assert len(result["reasoning"]) == 2


async def test_predict_success_markdown_wrapped(mock_client):
    response = {"probability": 60, "confidence": "high", "reasoning": ["Aligned"]}
    mock_client.chat = AsyncMock(return_value=f"```json\n{json.dumps(response)}\n```")
    result = await predict_success(
        mock_client, history="", title="PM", company="Co", description="Role",
    )
    assert result["probability"] == 60


async def test_predict_success_api_error(mock_client):
    mock_client.chat = AsyncMock(side_effect=Exception("timeout"))
    result = await predict_success(
        mock_client, history="", title="Dev", company="Co", description="Job",
    )
    assert result["probability"] == 0
    assert result["confidence"] == "low"
    assert any("error" in r.lower() for r in result["reasoning"])


async def test_predict_success_bad_json(mock_client):
    mock_client.chat = AsyncMock(return_value="not valid json at all")
    result = await predict_success(
        mock_client, history="", title="Dev", company="Co", description="Job",
    )
    assert result["probability"] == 0
    assert result["confidence"] == "low"


async def test_predict_success_prompt_contains_context(mock_client):
    mock_client.chat = AsyncMock(return_value=json.dumps(
        {"probability": 50, "confidence": "low", "reasoning": []}
    ))
    await predict_success(
        mock_client, history="Applied to 3 jobs",
        title="SRE", company="BigCo", description="SRE role, on-call",
    )
    prompt = mock_client.chat.call_args[0][0]
    assert "SRE" in prompt
    assert "BigCo" in prompt
    assert "Applied to 3 jobs" in prompt
