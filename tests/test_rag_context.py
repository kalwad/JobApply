import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.scheduler import run_context_embedding_cycle
from app.embeddings import retrieve_relevant_context


@pytest.mark.asyncio
async def test_context_cycle_skips_without_client():
    db = MagicMock()
    result = await run_context_embedding_cycle(db, embedding_client=None)
    assert result == 0


@pytest.mark.asyncio
async def test_context_cycle_skips_without_vec():
    db = MagicMock()
    db._vec_loaded = False
    result = await run_context_embedding_cycle(db, embedding_client=MagicMock())
    assert result == 0


@pytest.mark.asyncio
async def test_context_cycle_syncs_and_embeds():
    # Mock work history
    wh_cursor = AsyncMock()
    wh_cursor.fetchall = AsyncMock(return_value=[
        {"id": 1, "job_title": "SRE", "company": "Acme", "description": "Managed K8s"},
    ])

    # Mock contact interactions
    ci_cursor = AsyncMock()
    ci_cursor.fetchall = AsyncMock(return_value=[
        {"id": 10, "notes": "Discussed role", "name": "Jane", "company": "Acme"},
    ])

    # Mock check for existing context items
    existing_cursor = AsyncMock()
    existing_cursor.fetchone = AsyncMock(return_value=None)

    # Mock unembedded items
    unembedded_cursor = AsyncMock()
    unembedded_cursor.fetchall = AsyncMock(return_value=[
        {"id": 100, "text": "SRE at Acme: Managed K8s"},
        {"id": 101, "text": "Interaction with Jane (Acme): Discussed role"},
    ])

    call_count = 0

    async def mock_execute(sql, params=None):
        nonlocal call_count
        sql_str = sql.strip().upper()
        if "FROM WORK_HISTORY" in sql_str:
            return wh_cursor
        if "FROM CONTACT_INTERACTIONS" in sql_str:
            return ci_cursor
        if "FROM CONTEXT_ITEMS WHERE TYPE" in sql_str:
            return existing_cursor
        if "FROM CONTEXT_ITEMS WHERE EMBEDDED" in sql_str:
            return unembedded_cursor
        return AsyncMock()

    db = MagicMock()
    db._vec_loaded = True
    db.db = MagicMock()
    db.db.execute = AsyncMock(side_effect=mock_execute)
    db.db.commit = AsyncMock()

    client = MagicMock()
    client.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])

    with patch("app.embeddings.upsert_embedding", new_callable=AsyncMock) as mock_upsert:
        result = await run_context_embedding_cycle(db, embedding_client=client)

    assert result == 2
    assert client.embed.await_count == 2
    assert mock_upsert.await_count == 2


@pytest.mark.asyncio
async def test_context_cycle_handles_embed_errors():
    wh_cursor = AsyncMock()
    wh_cursor.fetchall = AsyncMock(return_value=[])
    ci_cursor = AsyncMock()
    ci_cursor.fetchall = AsyncMock(return_value=[])

    unembedded_cursor = AsyncMock()
    unembedded_cursor.fetchall = AsyncMock(return_value=[
        {"id": 1, "text": "Some context"},
    ])

    async def mock_execute(sql, params=None):
        sql_str = sql.strip().upper()
        if "FROM WORK_HISTORY" in sql_str:
            return wh_cursor
        if "FROM CONTACT_INTERACTIONS" in sql_str:
            return ci_cursor
        if "FROM CONTEXT_ITEMS WHERE EMBEDDED" in sql_str:
            return unembedded_cursor
        return AsyncMock()

    db = MagicMock()
    db._vec_loaded = True
    db.db = MagicMock()
    db.db.execute = AsyncMock(side_effect=mock_execute)
    db.db.commit = AsyncMock()

    client = MagicMock()
    client.embed = AsyncMock(side_effect=Exception("API error"))

    result = await run_context_embedding_cycle(db, embedding_client=client)
    assert result == 0


class FakeRow:
    """Dict-like row that supports both string key and integer index access."""
    def __init__(self, data):
        self._data = data
        self._keys = list(data.keys())
    def __getitem__(self, key):
        if isinstance(key, int):
            return self._data[self._keys[key]]
        return self._data[key]
    def __contains__(self, key):
        return key in self._data


@pytest.mark.asyncio
async def test_retrieve_relevant_context_returns_items():
    mock_db = MagicMock()

    mock_search = AsyncMock(return_value=[(1, 0.1), (2, 0.3)])

    row1 = FakeRow({"id": 1, "type": "work_history", "text": "SRE at Acme"})
    row2 = FakeRow({"id": 2, "type": "contact_interaction", "text": "Met with Jane"})

    cursor1 = AsyncMock()
    cursor1.fetchone = AsyncMock(return_value=row1)
    cursor2 = AsyncMock()
    cursor2.fetchone = AsyncMock(return_value=row2)

    mock_db.execute = AsyncMock(side_effect=[cursor1, cursor2])

    mock_client = MagicMock()
    mock_client.embed = AsyncMock(return_value=[0.1, 0.2])

    with patch("app.embeddings.search_embeddings", mock_search):
        results = await retrieve_relevant_context(mock_db, mock_client, "DevOps role")

    assert len(results) == 2
    assert results[0]["type"] == "work_history"
    assert results[1]["type"] == "contact_interaction"


@pytest.mark.asyncio
async def test_retrieve_relevant_context_returns_empty_without_client():
    results = await retrieve_relevant_context(MagicMock(), None, "query")
    assert results == []


@pytest.mark.asyncio
async def test_retrieve_relevant_context_handles_errors():
    mock_client = MagicMock()
    mock_client.embed = AsyncMock(side_effect=Exception("API down"))
    results = await retrieve_relevant_context(MagicMock(), mock_client, "query")
    assert results == []
