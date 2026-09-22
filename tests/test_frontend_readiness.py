import pathlib

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

ROOT = pathlib.Path(__file__).resolve().parent.parent


@pytest.fixture()
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture()
async def client(tmp_path, monkeypatch, auth):
    from src.core.config import settings
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 't.db'}")
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from src.core.config import settings
    import src.db.session as session_mod

    session_mod.engine = create_async_engine(settings.database_url, echo=False)
    session_mod.SessionLocal = async_sessionmaker(session_mod.engine, expire_on_commit=False)
    from src.db.session import init_db

    settings.dataset_dir = ROOT / "dataset"
    await init_db()
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", headers=auth) as ac:
        yield ac
    await session_mod.engine.dispose()


@pytest.mark.asyncio
async def test_cors_headers(client, auth):
    """change 004: CORS-заголовки в ответе и preflight (dev-сервер фронта на другом origin)."""
    r = await client.options("/api/v1/bus-factor", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
    })
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"
    r = await client.get("/healthz", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "*"


@pytest.mark.asyncio
async def test_cors_specific_origin(tmp_path, monkeypatch, auth):
    """change 004: CORS_ORIGINS env — конкретный origin разрешён, прочие нет."""
    import sys
    from src.core.config import settings
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    import src.db.session as session_mod

    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 't.db'}")

    # app считывает cors_origins при создании middleware — патчим singleton и перезагружаем модуль
    monkeypatch.setattr(settings, "cors_origins", "http://localhost:3000")
    sys.modules.pop("src.main", None)
    session_mod.engine = create_async_engine(settings.database_url, echo=False)
    session_mod.SessionLocal = async_sessionmaker(session_mod.engine, expire_on_commit=False)
    from src.db.session import init_db

    try:
        await init_db()
        from src.main import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", headers=auth) as ac:
            r = await ac.get("/healthz", headers={"Origin": "http://localhost:3000"})
            assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
            r = await ac.get("/healthz", headers={"Origin": "http://evil.example"})
            assert r.headers.get("access-control-allow-origin") != "http://evil.example"
    finally:
        await session_mod.engine.dispose()
        sys.modules.pop("src.main", None)


@pytest.mark.asyncio
async def test_bus_risk_endpoint(client, auth):
    """change 004: ручка bus-risk на демо-датасете."""
    r = await client.post("/api/v1/data/import")
    assert r.status_code == 200
    r = await client.post("/api/v1/plans/generate")
    assert r.status_code == 201
    plan_id = r.json()["plan_id"]

    r = await client.get(f"/api/v1/plans/{plan_id}/bus-risk")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["total_at_risk"], int)
    assert body["total_at_risk"] == len(body["tasks"])
    for t in body["tasks"]:
        assert t["at_risk_keys"], f"у задачи {t['task_id']} пуст at_risk_keys"
        assert "sprint_no" in t
        for role, holders in t["holders"].items():
            assert len(holders) <= 1  # риск = 0 или 1 носитель

    # несуществующий план
    r = await client.get("/api/v1/plans/nonexistent/bus-risk")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_plan_bus_risk_unit():
    """change 004: unit — одиночная роль уходит в риск, многолюдная — нет; роль без носителей = holders []."""
    from src.domain.models import Engineer as Eng
    from src.domain.models import Task
    from src.services.bus_factor import plan_bus_risk

    tasks = {
        "T1": Task(task_id="T1", team_id="X", role_hours={"Редкая роль": 10}),
        "T2": Task(task_id="T2", team_id="X", role_hours={"Массовая роль": 10}),
        "T3": Task(task_id="T3", team_id="X", role_hours={"Никого нет": 5}),
    }
    eng_objs = [
        Eng(engineer_id="E1", team_id="X", role="Массовая роль"),
        Eng(engineer_id="E2", team_id="X", role="Массовая роль"),
        Eng(engineer_id="E3", team_id="Y", role="Редкая роль"),
    ]
    planned = [{"task_id": tid, "sprint_no": 1} for tid in tasks]
    out = plan_bus_risk(planned, tasks, eng_objs)
    ids = {t["task_id"] for t in out["tasks"]}
    assert "T2" not in ids
    t1 = next(t for t in out["tasks"] if t["task_id"] == "T1")
    assert t1["at_risk_keys"] == ["Редкая роль"] and t1["holders"] == {"Редкая роль": ["E3"]}
    t3 = next(t for t in out["tasks"] if t["task_id"] == "T3")
    assert t3["at_risk_keys"] == ["Никого нет"] and t3["holders"] == {"Никого нет": []}
    assert out["total_at_risk"] == 2
