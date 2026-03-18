import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.follow_up import draft_follow_up


@pytest.fixture
def mock_client():
    client = MagicMock()
    client.chat = AsyncMock(return_value="Thank you for considering my application. I remain very interested in the role.")
    return client


async def test_draft_follow_up_basic(mock_client):
    result = await draft_follow_up(
        mock_client, title="Software Engineer", company="Acme Corp",
        applied_at="2026-03-01", days_since=14,
    )
    assert "interested" in result.lower()
    mock_client.chat.assert_called_once()
    prompt = mock_client.chat.call_args[0][0]
    assert "Software Engineer" in prompt
    assert "Acme Corp" in prompt
    assert "14" in prompt


async def test_draft_follow_up_with_template(mock_client):
    template = "Hi, I wanted to follow up on my application for {title}."
    await draft_follow_up(
        mock_client, title="Data Analyst", company="BigCo",
        applied_at="2026-02-15", days_since=7, template_text=template,
    )
    prompt = mock_client.chat.call_args[0][0]
    assert "template" in prompt.lower()
    assert template in prompt


async def test_draft_follow_up_no_template(mock_client):
    await draft_follow_up(
        mock_client, title="PM", company="StartupX",
        applied_at="2026-01-01", days_since=30,
    )
    prompt = mock_client.chat.call_args[0][0]
    assert "template" not in prompt.lower() or "Use this template" not in prompt


async def test_draft_follow_up_error_returns_empty():
    client = MagicMock()
    client.chat = AsyncMock(side_effect=Exception("API down"))
    result = await draft_follow_up(
        client, title="Engineer", company="Co",
        applied_at="2026-03-01", days_since=7,
    )
    assert result == ""


async def test_draft_follow_up_max_tokens(mock_client):
    await draft_follow_up(
        mock_client, title="Dev", company="Co",
        applied_at="2026-03-01", days_since=7,
    )
    _, kwargs = mock_client.chat.call_args
    assert kwargs.get("max_tokens") == 512
