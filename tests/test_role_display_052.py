"""Change 052: display-имена ролей — фактические часы (task_role_hours)
и assignments оптимизации показывают «Разработчик Java», а не «разработчик_java»."""
import pathlib

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

ROOT = pathlib.Path(__file__).resolve().parent.parent


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
    await init_db()
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", headers=auth) as ac:
        yield ac, session_mod
    await session_mod.engine.dispose()


@pytest.mark.asyncio
async def test_imported_role_hours_actual_display_names(client):
    """Фактические часы ролей импортируются с display-именами (маппинг колонок xlsx)."""
    ac, session_mod = client
    r = await ac.post("/api/v1/data/import")
    assert r.status_code == 200, r.text
    counts = r.json()["counts"]
    assert counts.get("task_role_hours", 0) > 0

    from src.db.models import TaskRoleHoursORM
    async with session_mod.SessionLocal() as s:
        roles = (await s.execute(select(TaskRoleHoursORM.role).distinct())).scalars().all()
    assert roles
    for role in roles:
        assert "_" not in role, f"машинное имя роли протекло в БД: {role!r}"
    assert "Тестировщик (Автотестирование)" in roles, roles
    assert "Разработчик Java" in roles, roles
