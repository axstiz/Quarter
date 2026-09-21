"""Change 028: solver через очередь arq + деградация без Redis.

Контракт (спека jobs, дельта 028):
- Redis/JOBS_MODE=auto|queue: POST /plans/optimize быстро возвращает queued,
  воркер (run_optimization_job) доводит queued → solving → ready | failed
  с той же семантикой причин; статус опрашивается GET /plans/optimize/{job_id}.
- Деградация: нет Redis или JOBS_MODE=sync — прежний синхронный solve в запросе.
- 409 на параллельный запуск и при queued (ACTIVE_JOB_STATUSES).
"""
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


class FakeQueue:
    """Фейковый arq: enqueue запоминает задачу, «выполнение» вручную."""

    def __init__(self):
        self.enqueued: list[tuple[str, tuple, dict]] = []

    async def enqueue_job(self, name: str, *args, **kwargs):
        self.enqueued.append((name, args, kwargs))


@pytest.fixture()
def fake_queue(monkeypatch):
    from src.ai import jobs_worker

    q = FakeQueue()
    monkeypatch.setattr(jobs_worker, "get_queue", _async_factory(q))
    yield q


def _fake_get_queue(q):
    async def _get():
        return q

    return _get


@pytest.mark.asyncio
async def test_optimize_enqueues_and_worker_completes(auths, monkeypatch):
    """Очередь: ответ queued; воркер-задача доводит до ready (solver-мок)."""
    from src.db.session import SessionLocal
    from tests.test_optimize_jobs import _seed_world, _solver_draft_valid, _generate_plan

    async with SessionLocal() as session:
        await _seed_world(session)

    async def _fake_solve_sidecar(snapshot):  # solver живой — то, что возвращает сайдкар
        return await _solver_draft_valid(snapshot)

    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _fake_solve_sidecar)

    from src.ai import jobs_worker

    q = FakeQueue()
    monkeypatch.setattr(jobs_worker, "get_queue", _fake_get_queue(q))

    auth = auths["editor"]
    plan_id = await _generate_plan(auth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "queued"
        job_id = body["job_id"]
        assert q.enqueued and q.enqueued[0][0] == "run_optimization_job"

        # параметры прав переданы enqueue-полями (editor → no staffing)
        _, _, kwargs = q.enqueued[0]
        assert kwargs.get("require_staffing") is False

        # выполнить задачу воркера вручную (arq-воркер вне теста)
        res = await jobs_worker.run_optimization_job(
            {}, job_id, author_id="admin-test", require_staffing=False)
        assert res["ok"] is True and res["status"] == "ready"

        jr = await ac.get(f"/api/v1/plans/optimize/{job_id}", headers=auth)
        jdata = jr.json()
        assert jdata["status"] == "ready"
        assert jdata["mode"] == "solver" and jdata["plan_id"]


@pytest.mark.asyncio
async def test_optimize_409_while_queued(auths, monkeypatch):
    """Повторный запуск при queued — 409 (ACTIVE_JOB_STATUSES включает queued)."""
    from src.db.session import SessionLocal
    from src.db.models import OptimizationJobORM

    from src.ai import jobs_worker
    from tests.test_optimize_jobs import _seed_world, _generate_plan

    async with SessionLocal() as session:
        await _seed_world(session)
        stuck = OptimizationJobORM(workspace_id="default", plan_id="p",
                                   status="queued")
        session.add(stuck)
        await session.commit()

    apps = auths["editor"]
    plan_id = await _generate_plan(apps)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=apps, json={"plan_id": plan_id})
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_repair_dependencies_shifts_blocked_parts():
    """Repair: зависимые части сдвигаются за конец блокера, за спринт 6 —
    вне квартала (partial_hh); при непрямой цепочке — итеративно."""
    from src.services.optimize_plan import repair_dependencies

    draft = {
        "items": [
            {"task_id": "B", "part": 1, "sprint_no": 2, "step_points_sp": 1.0,
             "team_id": "T", "role_hours": {"dev": 4.0}, "note": ""},
            {"task_id": "C", "part": 1, "sprint_no": 1, "step_points_sp": 1.0,
             "team_id": "T", "role_hours": {"dev": 2.0}, "note": ""},
            {"task_id": "D", "part": 1, "sprint_no": 4, "step_points_sp": 1.0,
             "team_id": "T", "role_hours": {"dev": 20.0}, "note": ""},
        ],
        "partial_hh": {},
    }
    draft = repair_dependencies(draft, deps=[("B", "C"), ("C", "D")])
    by_task = {it["task_id"]: it["sprint_no"] for it in draft["items"]}
    assert by_task["C"] == 3, "C сдвинута за конец B (2) → 3"
    assert by_task["D"] == 4, "цепочка: D стартует после конца C (3) → 4"

    # конец блокера = 6 → зависимая часть уходит вне квартала
    draft2 = {"items": [
        {"task_id": "B", "part": 1, "sprint_no": 6, "step_points_sp": 1.0,
         "team_id": "T", "role_hours": {"dev": 4.0}, "note": ""},
        {"task_id": "C", "part": 1, "sprint_no": 1, "step_points_sp": 1.0,
         "team_id": "T", "role_hours": {"dev": 8.0}, "note": ""},
    ], "partial_hh": {}}
    draft2 = repair_dependencies(draft2, deps=[("B", "C")])
    assert all(it["task_id"] != "C" for it in draft2["items"])
    assert draft2["partial_hh"]["C"] == 8.0
