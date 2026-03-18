import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport

from app.database import Database


@pytest.fixture
async def db(tmp_path):
    """Async database fixture with automatic init and cleanup."""
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.fixture
async def app(tmp_path):
    """FastAPI test app with isolated database."""
    from app.main import create_app
    application = create_app(db_path=str(tmp_path / "test.db"), testing=True)
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    application.state.db = database
    yield application
    await database.close()


@pytest.fixture
async def client(app):
    """Async HTTP test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def mock_ai_client():
    """Mock AI client with configurable chat responses."""
    ai = MagicMock()
    ai.chat = AsyncMock(return_value="OK")
    ai.provider = "test"
    return ai
