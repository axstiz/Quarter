"""Change 047: факты спринтов видны по всей цепочке версий (статистика на любой
версии), done_actual-задачи не пропадают из оптимизированной версии."""
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
    await init_db()
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", headers=auth) as ac:
        yield ac
    await session_mod.engine.dispose()


async def _plan_with_fact(client) -> tuple[str, str, str]:
    """Загрузка dataset → generate → факт спринта 1 по первой задаче спринта 1.

    Возвращает (initial_pid, child_pid, done_task_id)."""
    r = await client.post("/api/v1/data/upload", files={"file": ("d.xlsx", XLSX.read_bytes())})
    job_id = r.json()["job_id"]
    r = await client.post(f"/api/v1/data/jobs/{job_id}/confirm")
    assert r.status_code == 200

    r = await client.post("/api/v1/plans/generate")
    assert r.status_code == 201
    pid = r.json()["plan_id"]

    r = await client.get(f"/api/v1/plans/{pid}")
    sprints = r.json()["sprints"]
    tasks_s1 = [t["task_id"] for s in sprints if s["sprint_no"] == 1 for t in s["tasks"]]
    done_task = tasks_s1[0]

    fact = {"completed_sp": 10.0, "completed_task_ids": [done_task]}
    r = await client.post(f"/api/v1/plans/{pid}/sprints/1/facts", json=fact)
    assert r.status_code == 200
    child_pid = r.json()["new_plan_id"]
    assert child_pid and child_pid != pid
    return pid, child_pid, done_task


@pytest.mark.asyncio
async def test_metrics_on_child_version_show_done_sprints(client):
    """Баг 047-1: статистика дочерней версии видит завершённые спринты (факты цепочки)."""
    _, child_pid, _ = await _plan_with_fact(client)

    r = await client.get(f"/api/v1/plans/{child_pid}/metrics")
    assert r.status_code == 200
    m = r.json()
    assert m["sprint_completion_pct"]["1"] is not None, \
        f"факт спринта 1 потерян на дочерней версии: {m['sprint_completion_pct']}"
    assert m["sprint_completion_is_forecast"]["1"] is False


@pytest.mark.asyncio
async def test_facts_list_on_child_version(client):
    _, child_pid, done_task = await _plan_with_fact(client)
    r = await client.get(f"/api/v1/plans/{child_pid}/facts")
    assert r.status_code == 200
    facts = r.json()
    assert [f["sprint_no"] for f in facts] == [1]
    assert done_task in facts[0]["completed_task_ids"]


@pytest.mark.asyncio
async def test_duplicate_fact_on_child_version_409(client):
    """Факт спринта уже загружен на родителе — повтор на дочерней версии запрещён."""
    _, child_pid, _ = await _plan_with_fact(client)
    r = await client.post(f"/api/v1/plans/{child_pid}/sprints/1/facts",
                          json={"completed_sp": 5.0, "completed_task_ids": []})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_optimize_keeps_done_actual_items(client, monkeypatch):
    """Баг 047-2: оптимизированная версия сохраняет выполненные по факту задачи."""
    async def _empty_draft(snapshot: dict) -> dict:
        return {"assignments": [], "staffing_moves": [],
                "score": {"hard": 0, "soft": 0}, "score_breakdown": []}

    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _empty_draft)
    _, child_pid, done_task = await _plan_with_fact(client)

    r = await client.post("/api/v1/plans/optimize", json={"plan_id": child_pid})
    assert r.status_code == 200, r.text
    opt_pid = r.json()["plan_id"]
    assert opt_pid and opt_pid != child_pid

    r = await client.get(f"/api/v1/plans/{opt_pid}")
    assert r.status_code == 200
    data = r.json()
    done_items = [i for i in data["not_planned"] if i["task_id"] == done_task]
    assert done_items, f"выполненная задача {done_task} пропала после оптимизации"
    assert all(i["decision"] == "done_actual" for i in done_items)


@pytest.mark.asyncio
async def test_second_fact_keeps_first_sprint_done_items(client):
    """change 059: после факта 2-го спринта done_actual 1-го не пропадают с ганта."""
    pid, child_pid, done_task = await _plan_with_fact(client)

    # факт спринта 2 по другой задаче (из спринта 2 дочерней версии)
    r = await client.get(f"/api/v1/plans/{child_pid}")
    sprints = r.json()["sprints"]
    task_s2 = next(t["task_id"] for s in sprints if s["sprint_no"] == 2 for t in s["tasks"])
    r = await client.post(f"/api/v1/plans/{child_pid}/sprints/2/facts",
                          json={"completed_sp": 15.0, "completed_task_ids": [task_s2]})
    assert r.status_code == 200
    third_pid = r.json()["new_plan_id"]

    r = await client.get(f"/api/v1/plans/{third_pid}")
    data = r.json()
    done = {i["task_id"]: i["sprint_no"] for i in data["not_planned"] if i["decision"] == "done_actual"}
    assert done.get(done_task) == 1, f"done_actual 1-го спринта потерян: {done}"
    assert done.get(task_s2) == 2, f"done_actual 2-го спринта отсутствует: {done}"
