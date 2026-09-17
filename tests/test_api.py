import os
import pathlib

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

ROOT = pathlib.Path(__file__).resolve().parent.parent


@pytest.fixture()
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture()
async def client(tmp_path, monkeypatch):
    from src.core.config import settings
    from src.db.session import init_db
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    import src.db.session as session_mod

    # патчим singleton напрямую: setenv не работает — settings создан при первом импорте;
    # изоляция по-тестовая СВОЯ tmp-БД (раньше маскировалась destructive reset'ом)
    dsn = f"sqlite+aiosqlite:///{tmp_path / 't.db'}"
    monkeypatch.setattr(settings, "database_url", dsn)
    settings.dataset_dir = ROOT / "dataset"

    # каждый тест получает свой engine под свой tmp-DSN
    session_mod.engine = create_async_engine(settings.database_url, echo=False)
    session_mod.SessionLocal = async_sessionmaker(session_mod.engine, expire_on_commit=False)
    await init_db()
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        yield ac
    await session_mod.engine.dispose()


@pytest.mark.asyncio
async def test_healthz(client):
    r = await client.get("/healthz")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_import_generated_facts_cycle(client):
    r = await client.post("/api/v1/data/import")
    assert r.status_code == 200
    counts = r.json()["counts"]
    assert counts["tasks"] == 45
    assert counts["engineers"] == 34

    r = await client.post("/api/v1/plans/generate")
    assert r.status_code == 201
    plan_id = r.json()["plan_id"]

    r = await client.post(f"/api/v1/plans/{plan_id}/sprints/1/facts",
                          json={"completed_sp": 10.0, "completed_task_ids": []})
    assert r.status_code == 200
    r = await client.post(f"/api/v1/plans/{plan_id}/sprints/1/facts", json={"completed_sp": 1.0})
    assert r.status_code == 409

    r = await client.get(f"/api/v1/plans/{plan_id}/warnings")
    assert r.status_code == 200
    kinds = {w["kind"] for w in r.json()}
    assert "composition_change" in kinds

    r = await client.get(f"/api/v1/plans/{plan_id}/metrics")
    assert r.status_code == 200
    m = r.json()
    assert m["quarter_completion_is_forecast"] is True


@pytest.mark.asyncio
async def test_plan_404(client):
    r = await client.get("/api/v1/plans/nonexistent")
    assert r.status_code == 404
    r = await client.get("/api/v1/plans/nonexistent/tasks/X/explanation")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_bus_factor_and_starmap(client):
    r = await client.post("/api/v1/data/import")
    assert r.status_code == 200
    r = await client.get("/api/v1/bus-factor")
    assert r.status_code == 200
    body = r.json()
    assert body["methodology"]
    items = body["items"]
    assert any(i["factor"] == 1 for i in items)
    r = await client.get("/api/v1/star-map/summary")
    assert r.status_code == 200
    summary = r.json()
    assert summary["teams"]
    r = await client.get("/api/v1/teams")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_data_import_counts(client):
    r = await client.post("/api/v1/data/import")
    assert r.status_code == 200
    counts = r.json()["counts"]
    assert counts["tasks"] == 45
    assert counts["role_requirements"] == 307
    assert counts["team_history"] == 12


@pytest.mark.asyncio
async def test_plans_versions_and_facts(client, sample_xlsx):
    """Change 002b: GET /plans (версии), GET /plans/{id}/facts, parent_plan_id в GET plans/{id}."""
    r = await client.post("/api/v1/data/upload", files={"file": ("d.xlsx", sample_xlsx.read_bytes())})
    assert r.status_code == 201
    body = r.json()
    job_id = body["job_id"]
    r = await client.post(f"/api/v1/data/jobs/{job_id}/confirm")
    assert r.status_code == 200

    r = await client.post("/api/v1/plans/generate")
    pid = r.json()["plan_id"]

    r = await client.get("/api/v1/plans")
    assert r.status_code == 200
    plans = r.json()
    assert len(plans) == 1 and plans[0]["is_initial"]

    r = await client.post(f"/api/v1/plans/{pid}/sprints/1/facts", json={"completed_sp": 10.0, "completed_task_ids": []})
    assert r.status_code == 200
    new_pid = r.json()["new_plan_id"]
    assert new_pid != pid

    r = await client.get("/api/v1/plans")
    plans = r.json()
    assert len(plans) == 2
    child = next(p for p in plans if p["plan_id"] == new_pid)
    assert not child["is_initial"] and child["parent_plan_id"] == pid

    r = await client.get(f"/api/v1/plans/{new_pid}/facts")
    assert r.status_code == 200
    facts = r.json()
    assert len(facts) == 1 and facts[0]["sprint_no"] == 1 and facts[0]["completed_sp"] == 10.0

    r = await client.get(f"/api/v1/plans/{new_pid}")
    assert r.status_code == 200
    assert r.json()["parent_plan_id"] == pid


@pytest.mark.asyncio
async def test_reimport_preserves_plans(client):
    """Фикс reset_dataset_tables: повторный импорт не затирает планы и факты."""
    r = await client.post("/api/v1/data/import")
    assert r.status_code == 200
    r = await client.post("/api/v1/plans/generate")
    assert r.status_code == 201
    plan_id = r.json()["plan_id"]
    r = await client.post(f"/api/v1/plans/{plan_id}/sprints/1/facts",
                          json={"completed_sp": 5.0, "completed_task_ids": []})
    assert r.status_code == 200

    r = await client.post("/api/v1/data/import")
    assert r.status_code == 200
    counts = r.json()["counts"]
    assert counts["tasks"] == 45

    r = await client.get("/api/v1/plans")
    plans = r.json()
    assert len(plans) >= 2
    r = await client.get(f"/api/v1/plans/{plan_id}")
    assert r.status_code == 200 and r.json()["plan_id"] == plan_id
    r = await client.get(f"/api/v1/plans/{plan_id}/facts")
    facts = r.json()
    assert any(f["sprint_no"] == 1 and f["completed_sp"] == 5.0 for f in facts)


@pytest.mark.asyncio
async def test_manual_records_survive_reimport(client):
    """Спека data: повторный импорт не затирает source=manual (fix-manual-records-survive-reimport)."""
    r = await client.post("/api/v1/data/import")
    assert r.status_code == 200

    r = await client.post("/api/v1/engineers", json={
        "engineer_id": "ENG-MANUAL", "team_id": "Team-L", "role": "Ручная роль",
    })
    assert r.status_code == 201
    r = await client.post("/api/v1/tasks",
                          json={"task_id": "MAN-1", "team_id": "Team-L", "summary": "Ручная задача"})
    assert r.status_code == 201

    # повторный импорт — ручные записи выживают, импортные перезагружаются
    r = await client.post("/api/v1/data/import")
    assert r.status_code == 200
    assert r.json()["counts"]["tasks"] == 45

    r = await client.get("/api/v1/engineers/ENG-MANUAL")
    assert r.status_code == 200
    r = await client.get("/api/v1/tasks/MAN-1")
    assert r.status_code == 200 and r.json()["summary"] == "Ручная задача"
    r = await client.get("/api/v1/tasks", params={"team_id": "Team-L"})
    ids = {t["task_id"] for t in r.json()}
    assert "MAN-1" in ids
    # импортная задача тоже на месте (перезагружена, не manual)
    r = await client.get("/api/v1/tasks/ONK-2475")
    assert r.status_code == 200


@pytest.fixture()
def sample_xlsx():
    from pathlib import Path as _P
    xlsx = _P(__file__).resolve().parent.parent / "Датасет_с_правками_основной.xlsx"
    assert xlsx.exists()
    return xlsx
