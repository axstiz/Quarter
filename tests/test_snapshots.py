"""Change 007/003: факт спринта → новая версия плана (parent-цепочка);
метрики всегда считаются от is_initial-плана."""
import pathlib

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

ROOT = pathlib.Path(__file__).resolve().parent.parent
XLSX = ROOT / "Датасет_с_правками_основной.xlsx"


@pytest.fixture()
def sample_xlsx():
    assert XLSX.exists()
    return XLSX


@pytest_asyncio.fixture()
async def client(tmp_path, monkeypatch):
    from src.core.config import settings
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{tmp_path / 't.db'}")
    from src.db.session import engine, init_db

    settings.dataset_dir = ROOT / "dataset"
    await init_db()
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        yield ac
    await engine.dispose()


@pytest.mark.asyncio
async def test_fact_creates_snapshot_and_initial_metrics(client, sample_xlsx):
    r = await client.post("/api/v1/data/upload", files={"file": ("d.xlsx", sample_xlsx.read_bytes())})
    body = r.json()
    job_id = body["job_id"]
    r = await client.post(f"/api/v1/data/jobs/{job_id}/confirm")
    assert r.status_code == 200

    r = await client.post("/api/v1/plans/generate")
    assert r.status_code == 201
    pid = r.json()["plan_id"]

    fact_body = {"completed_sp": 10.0, "completed_task_ids": []}
    r = await client.post(f"/api/v1/plans/{pid}/sprints/1/facts", json=fact_body)
    assert r.status_code == 200
    new_pid = r.json()["new_plan_id"]
    assert new_pid and new_pid != pid

    # повторный факт того же спринта — 409
    r = await client.post(f"/api/v1/plans/{pid}/sprints/1/facts", json=fact_body)
    assert r.status_code == 409

    # кнопка «Пересчитать» на новой версии
    r = await client.post(f"/api/v1/plans/{new_pid}/recompute", json={"after_sprint": 2})
    assert r.status_code == 200
    third_pid = r.json()["new_plan_id"]
    assert third_pid != new_pid

    # метрики новой версии от initial-плана
    r = await client.get(f"/api/v1/plans/{new_pid}/metrics")
    assert r.status_code == 200
    m = r.json()
    assert m["quarter_completion_is_forecast"] is True
    assert m["quarter_completion_pct"] is not None

    # warnings на новой версии
    r = await client.get(f"/api/v1/plans/{new_pid}/warnings")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
