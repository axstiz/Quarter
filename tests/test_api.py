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
    monkeypatch.setenv("POSTCODE_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 't.db'}")
    from src.db.session import SessionLocal, engine, init_db
    from src.db import session as session_mod
    from src.core.config import settings

    settings.dataset_dir = ROOT / "dataset"
    await init_db()
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        yield ac
    await engine.dispose()


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
