import pathlib

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

ROOT = pathlib.Path(__file__).resolve().parent.parent
XLSX = ROOT / "Датасет_с_правками_основной.xlsx"


@pytest_asyncio.fixture()
async def client(tmp_path, monkeypatch, auth):
    from src.core.config import settings
    import src.db.session as session_mod
    from src.db.session import init_db
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 't.db'}")
    settings.dataset_dir = ROOT / "dataset"

    session_mod.engine = create_async_engine(settings.database_url, echo=False)
    session_mod.SessionLocal = async_sessionmaker(session_mod.engine, expire_on_commit=False)
    await session_mod.init_db()
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", headers=auth) as ac:
        yield ac
    await session_mod.engine.dispose()


@pytest.fixture()
def sample_xlsx():
    assert XLSX.exists()
    return XLSX
