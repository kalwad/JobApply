import struct
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

from app.embeddings import (
    EmbeddingClient,
    ensure_vec_tables,
    upsert_embedding,
    search_embeddings,
    delete_embedding,
    _embedding_breaker,
)


# --- EmbeddingClient tests ---


@pytest.mark.asyncio
async def test_openai_embed_single():
    mock_embedding = MagicMock()
    mock_embedding.embedding = [0.1, 0.2, 0.3]
    mock_response = MagicMock()
    mock_response.data = [mock_embedding]

    mock_client = MagicMock()
    mock_client.embeddings = MagicMock()
    mock_client.embeddings.create = AsyncMock(return_value=mock_response)

    with patch("app.embeddings.AsyncOpenAI", return_value=mock_client):
        client = EmbeddingClient(provider="openai", api_key="test-key")
        result = await client.embed("hello world")

    assert result == [0.1, 0.2, 0.3]
    mock_client.embeddings.create.assert_awaited_once_with(
        model="text-embedding-3-small",
        input="hello world",
        dimensions=256,
    )


@pytest.mark.asyncio
async def test_openai_embed_batch():
    mock_emb1 = MagicMock()
    mock_emb1.embedding = [0.1, 0.2]
    mock_emb2 = MagicMock()
    mock_emb2.embedding = [0.3, 0.4]
    mock_response = MagicMock()
    mock_response.data = [mock_emb1, mock_emb2]

    mock_client = MagicMock()
    mock_client.embeddings = MagicMock()
    mock_client.embeddings.create = AsyncMock(return_value=mock_response)

    with patch("app.embeddings.AsyncOpenAI", return_value=mock_client):
        client = EmbeddingClient(provider="openai", api_key="test-key")
        results = await client.embed_batch(["hello", "world"])

    assert results == [[0.1, 0.2], [0.3, 0.4]]
    mock_client.embeddings.create.assert_awaited_once_with(
        model="text-embedding-3-small",
        input=["hello", "world"],
        dimensions=256,
    )


@pytest.mark.asyncio
async def test_ollama_embed_single(httpx_mock):
    httpx_mock.add_response(
        url="http://localhost:11434/api/embeddings",
        json={"embedding": [0.5, 0.6, 0.7]},
    )
    client = EmbeddingClient(provider="ollama")
    result = await client.embed("test text")
    assert result == [0.5, 0.6, 0.7]


@pytest.mark.asyncio
async def test_ollama_embed_batch(httpx_mock):
    httpx_mock.add_response(
        url="http://localhost:11434/api/embeddings",
        json={"embedding": [0.1, 0.2]},
    )
    httpx_mock.add_response(
        url="http://localhost:11434/api/embeddings",
        json={"embedding": [0.3, 0.4]},
    )
    client = EmbeddingClient(provider="ollama")
    results = await client.embed_batch(["a", "b"])
    assert results == [[0.1, 0.2], [0.3, 0.4]]


@pytest.mark.asyncio
async def test_openai_default_model_and_dims():
    client = EmbeddingClient(provider="openai", api_key="k")
    assert client.model == "text-embedding-3-small"
    assert client.dimensions == 256


@pytest.mark.asyncio
async def test_ollama_default_model_and_dims():
    client = EmbeddingClient(provider="ollama")
    assert client.model == "nomic-embed-text"
    assert client.dimensions == 768


@pytest.mark.asyncio
async def test_unknown_provider_raises():
    client = EmbeddingClient(provider="unknown")
    with pytest.raises(ValueError, match="Unknown provider"):
        await client.embed("test")


@pytest.mark.asyncio
async def test_circuit_breaker_opens():
    _embedding_breaker._services.clear()
    mock_client = MagicMock()
    mock_client.embeddings = MagicMock()
    mock_client.embeddings.create = AsyncMock(
        side_effect=Exception("API error")
    )

    with patch("app.embeddings.AsyncOpenAI", return_value=mock_client):
        client = EmbeddingClient(provider="openai", api_key="test-key")
        for _ in range(5):
            try:
                await client.embed("test")
            except Exception:
                pass

        with pytest.raises(RuntimeError, match="Circuit breaker open"):
            await client.embed("test")

    _embedding_breaker._services.clear()


# --- Vector store tests ---


def _serialize_f32(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


@pytest.fixture
async def vec_db():
    import aiosqlite
    import sqlite_vec

    db = await aiosqlite.connect(":memory:")

    def _load_ext():
        db._connection.enable_load_extension(True)
        sqlite_vec.load(db._connection)
        db._connection.enable_load_extension(False)

    await db._execute(_load_ext)
    await ensure_vec_tables(db, dimensions=3)
    yield db
    await db.close()


@pytest.mark.asyncio
async def test_upsert_and_search(vec_db):
    await upsert_embedding(vec_db, "vec_jobs", 1, [1.0, 0.0, 0.0])
    await upsert_embedding(vec_db, "vec_jobs", 2, [0.0, 1.0, 0.0])
    await upsert_embedding(vec_db, "vec_jobs", 3, [0.9, 0.1, 0.0])

    results = await search_embeddings(
        vec_db, "vec_jobs", [1.0, 0.0, 0.0], limit=3
    )

    assert len(results) > 0
    ids = [r[0] for r in results]
    assert ids[0] == 1  # exact match first


@pytest.mark.asyncio
async def test_upsert_replaces_existing(vec_db):
    await upsert_embedding(vec_db, "vec_jobs", 1, [1.0, 0.0, 0.0])
    await upsert_embedding(vec_db, "vec_jobs", 1, [0.0, 1.0, 0.0])

    results = await search_embeddings(
        vec_db, "vec_jobs", [0.0, 1.0, 0.0], limit=1
    )
    assert len(results) == 1
    assert results[0][0] == 1


@pytest.mark.asyncio
async def test_delete_embedding(vec_db):
    await upsert_embedding(vec_db, "vec_jobs", 1, [1.0, 0.0, 0.0])
    await delete_embedding(vec_db, "vec_jobs", 1)

    results = await search_embeddings(
        vec_db, "vec_jobs", [1.0, 0.0, 0.0], limit=1
    )
    assert len(results) == 0


@pytest.mark.asyncio
async def test_search_respects_limit(vec_db):
    for i in range(5):
        await upsert_embedding(vec_db, "vec_jobs", i + 1, [float(i), 1.0, 0.0])

    results = await search_embeddings(
        vec_db, "vec_jobs", [1.0, 1.0, 0.0], limit=2
    )
    assert len(results) <= 2


@pytest.mark.asyncio
async def test_vec_context_table(vec_db):
    await upsert_embedding(vec_db, "vec_context", 10, [0.0, 0.0, 1.0])
    results = await search_embeddings(
        vec_db, "vec_context", [0.0, 0.0, 1.0], limit=1
    )
    assert len(results) == 1
    assert results[0][0] == 10
