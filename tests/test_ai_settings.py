import pytest
import pytest_asyncio
from app.database import Database


@pytest_asyncio.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.asyncio
async def test_ai_settings_default_none(db):
    result = await db.get_ai_settings()
    assert result is None


@pytest.mark.asyncio
async def test_save_and_get_ai_settings(db):
    await db.save_ai_settings("anthropic", "sk-test-key", "claude-sonnet-4-20250514", "")
    result = await db.get_ai_settings()
    assert result["provider"] == "anthropic"
    assert result["api_key"] == "sk-test-key"
    assert result["model"] == "claude-sonnet-4-20250514"
    assert result["base_url"] == ""


@pytest.mark.asyncio
async def test_save_ollama_settings(db):
    await db.save_ai_settings("ollama", "", "llama3", "http://localhost:11434")
    result = await db.get_ai_settings()
    assert result["provider"] == "ollama"
    assert result["api_key"] == ""
    assert result["model"] == "llama3"
    assert result["base_url"] == "http://localhost:11434"


@pytest.mark.asyncio
async def test_update_ai_settings(db):
    await db.save_ai_settings("anthropic", "key1", "model1", "")
    await db.save_ai_settings("ollama", "", "llama3", "http://localhost:11434")
    result = await db.get_ai_settings()
    assert result["provider"] == "ollama"
    assert result["model"] == "llama3"


@pytest.mark.asyncio
async def test_save_bedrock_settings(db):
    await db.save_ai_settings(
        "bedrock", "AKIAIOSFODNN7EXAMPLE",
        "us.anthropic.claude-sonnet-4-6", "",
        region="us-west-2",
    )
    result = await db.get_ai_settings()
    assert result["provider"] == "bedrock"
    assert result["api_key"] == "AKIAIOSFODNN7EXAMPLE"
    assert result["model"] == "us.anthropic.claude-sonnet-4-6"
    assert result["region"] == "us-west-2"


@pytest.mark.asyncio
async def test_bedrock_region_default_empty(db):
    await db.save_ai_settings("bedrock", "", "us.anthropic.claude-sonnet-4-6", "")
    result = await db.get_ai_settings()
    assert result["region"] == ""


@pytest.mark.asyncio
async def test_update_region_preserves_on_overwrite(db):
    await db.save_ai_settings("bedrock", "key1", "model1", "", region="us-east-1")
    await db.save_ai_settings("bedrock", "key2", "model2", "", region="eu-west-1")
    result = await db.get_ai_settings()
    assert result["region"] == "eu-west-1"
    assert result["api_key"] == "key2"


@pytest.mark.asyncio
async def test_region_column_exists_after_migration(db):
    """Verify the region column exists in ai_settings table."""
    await db.save_ai_settings("anthropic", "key", "model", "")
    result = await db.get_ai_settings()
    assert "region" in result
