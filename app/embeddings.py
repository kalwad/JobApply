import logging
import struct

import httpx
from openai import AsyncOpenAI
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
    before_sleep_log,
)

from app.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)

_embedding_breaker = CircuitBreaker(failure_threshold=5, cooldown_seconds=300.0)

RETRYABLE_STATUS_CODES = {429, 500, 502, 503}


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRYABLE_STATUS_CODES
    if isinstance(exc, httpx.TransportError):
        return True
    try:
        import openai
        if isinstance(exc, (openai.RateLimitError, openai.InternalServerError)):
            return True
    except ImportError:
        pass
    return False


_embedding_retry = retry(
    retry=retry_if_exception(_is_retryable),
    stop=stop_after_attempt(4),
    wait=wait_exponential_jitter(initial=2, max=30),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)


def _resolve_ollama_url(url: str) -> str:
    import os
    if os.path.exists("/.dockerenv"):
        return url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
    return url


def _serialize_f32(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


class EmbeddingClient:
    """Async embedding client supporting OpenAI and Ollama providers."""

    def __init__(self, provider: str, api_key: str = "", model: str = "",
                 base_url: str = "", dimensions: int = 0):
        self.provider = provider
        self.api_key = api_key
        self.model = model or self._default_model()
        self.base_url = base_url or self._default_base_url()
        self.dimensions = dimensions or self._default_dimensions()

    def _default_model(self) -> str:
        if self.provider == "openai":
            return "text-embedding-3-small"
        if self.provider == "ollama":
            return "nomic-embed-text"
        return ""

    def _default_base_url(self) -> str:
        if self.provider == "ollama":
            return "http://localhost:11434"
        return ""

    def _default_dimensions(self) -> int:
        if self.provider == "openai":
            return 256
        if self.provider == "ollama":
            return 768
        return 256

    async def embed(self, text: str) -> list[float]:
        service = f"embedding:{self.provider}"
        if _embedding_breaker.is_open(service):
            raise RuntimeError(f"Circuit breaker open for {service}")
        try:
            result = await self._embed_with_retry(text)
            _embedding_breaker.record_success(service)
            return result
        except ValueError:
            raise
        except RuntimeError:
            raise
        except Exception:
            _embedding_breaker.record_failure(service)
            raise

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        service = f"embedding:{self.provider}"
        if _embedding_breaker.is_open(service):
            raise RuntimeError(f"Circuit breaker open for {service}")
        try:
            result = await self._embed_batch_with_retry(texts)
            _embedding_breaker.record_success(service)
            return result
        except ValueError:
            raise
        except RuntimeError:
            raise
        except Exception:
            _embedding_breaker.record_failure(service)
            raise

    @_embedding_retry
    async def _embed_with_retry(self, text: str) -> list[float]:
        if self.provider == "openai":
            return await self._openai_embed(text)
        elif self.provider == "ollama":
            return await self._ollama_embed(text)
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

    @_embedding_retry
    async def _embed_batch_with_retry(self, texts: list[str]) -> list[list[float]]:
        if self.provider == "openai":
            return await self._openai_embed_batch(texts)
        elif self.provider == "ollama":
            return await self._ollama_embed_batch(texts)
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

    async def _openai_embed(self, text: str) -> list[float]:
        client = AsyncOpenAI(api_key=self.api_key)
        response = await client.embeddings.create(
            model=self.model,
            input=text,
            dimensions=self.dimensions,
        )
        return response.data[0].embedding

    async def _openai_embed_batch(self, texts: list[str]) -> list[list[float]]:
        client = AsyncOpenAI(api_key=self.api_key)
        response = await client.embeddings.create(
            model=self.model,
            input=texts,
            dimensions=self.dimensions,
        )
        return [item.embedding for item in response.data]

    async def _ollama_embed(self, text: str) -> list[float]:
        url = f"{_resolve_ollama_url(self.base_url).rstrip('/')}/api/embeddings"
        payload = {"model": self.model, "prompt": text}
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()["embedding"]

    async def _ollama_embed_batch(self, texts: list[str]) -> list[list[float]]:
        results = []
        for text in texts:
            results.append(await self._ollama_embed(text))
        return results


# --- Vector store helpers ---


async def ensure_vec_tables(db, dimensions: int = 256) -> None:
    await db.execute(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_jobs USING vec0(item_id INTEGER PRIMARY KEY, embedding float[{dimensions}])"
    )
    await db.execute(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_context USING vec0(item_id INTEGER PRIMARY KEY, embedding float[{dimensions}])"
    )
    await db.commit()


async def upsert_embedding(db, table_name: str, item_id: int, vector: list[float]) -> None:
    blob = _serialize_f32(vector)
    await db.execute(
        f"DELETE FROM {table_name} WHERE item_id = ?", (item_id,)
    )
    await db.execute(
        f"INSERT INTO {table_name}(item_id, embedding) VALUES (?, ?)",
        (item_id, blob),
    )
    await db.commit()


async def search_embeddings(db, table_name: str, query_vector: list[float],
                            limit: int = 10, threshold: float = 0.5) -> list[tuple[int, float]]:
    blob = _serialize_f32(query_vector)
    cursor = await db.execute(
        f"SELECT item_id, distance FROM {table_name} WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
        (blob, limit),
    )
    rows = await cursor.fetchall()
    return [(row[0], row[1]) for row in rows]


async def delete_embedding(db, table_name: str, item_id: int) -> None:
    await db.execute(
        f"DELETE FROM {table_name} WHERE item_id = ?", (item_id,)
    )
    await db.commit()


async def retrieve_relevant_context(db, embedding_client, query_text: str,
                                     limit: int = 5) -> list[dict]:
    """Embed a query and retrieve the most relevant context items.

    Returns list of dicts with keys: item_id, distance, type, text.
    Context items are stored in a separate 'context_items' table with
    id, type ('work_history', 'contact_interaction', 'app_event'), and text.
    """
    if not embedding_client:
        return []
    try:
        query_vec = await embedding_client.embed(query_text[:8000])
        results = await search_embeddings(db, "vec_context", query_vec, limit=limit)
        if not results:
            return []

        items = []
        for item_id, distance in results:
            cursor = await db.execute(
                "SELECT id, type, text FROM context_items WHERE id = ?",
                (item_id,),
            )
            row = await cursor.fetchone()
            if row:
                items.append({
                    "item_id": row[0],
                    "type": row[1],
                    "text": row[2],
                    "distance": distance,
                })
        return items
    except Exception as e:
        logger.warning("Context retrieval failed: %s", e)
        return []
