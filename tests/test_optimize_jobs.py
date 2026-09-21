"""change 018, задачи 2.1–2.5: персистентный job оптимизации плана.

Контракт (спека api):
- POST /api/v1/plans/optimize: editor запускает job (queued → solving → ready | failed);
  ready возвращает plan_id новой версии; 409 на параллельный запуск; 403 reader;
  404 без плана; 422 при невалидном черновике solver; 403 при переносах людей без admin.
- GET /api/v1/plans/optimize/{job_id}: статус + причина/отчёт/переносы; 404 чужой workspace.
- Деградация: sidecar недоступен → режим «эвристика», ошибки нет.
"""

import pytest
from datetime import date
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from src.db.models import EngineerORM, OptimizationJobORM, TeamHistoryORM, TaskORM
from src.main import app


async def _seed_world(session, velocity: float = 10.0) -> None:
    """Два ToDo-задачи по 5 SP (роль Dev 20 ч), один Dev-инженер, история скорости.

    Идемпотентно: БД общая для всех тестов, строки-фикстуры пересоздаются.
    """
    await session.execute(delete(OptimizationJobORM).where(OptimizationJobORM.workspace_id == "default"))
    await session.execute(delete(TaskORM).where(TaskORM.task_id.in_(["T-1", "T-2"])))
    await session.execute(delete(EngineerORM).where(EngineerORM.engineer_id.in_(["E-1", "E-2"])))
    await session.execute(delete(TeamHistoryORM).where(TeamHistoryORM.team_id == "Team-A"))
    session.add_all([
        TaskORM(task_id="T-1", workspace_id="default", parent_id="INI-1", team_id="Team-A",
                status="ToDo", priority=10, estimation_sp=5.0, estimated_hh=20.0,
                planned_in_sprint=True),
        TaskORM(task_id="T-2", workspace_id="default", parent_id="INI-1", team_id="Team-A",
                status="ToDo", priority=20, estimation_sp=5.0, estimated_hh=20.0,
                planned_in_sprint=False),
        EngineerORM(engineer_id="E-1", workspace_id="default", team_id="Team-A",
                    role="Dev", capacity_rate=1.0),
        EngineerORM(engineer_id="E-2", workspace_id="default", team_id="Team-A",
                    role="Dev", capacity_rate=1.0),
        TeamHistoryORM(team_id="Team-A", workspace_id="default", snapshot_date=date(2026, 1, 1),
                       velocity_achieved=velocity, planned_sp=velocity),
    ])
    await session.commit()


async def _generate_plan(auth) -> str:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/generate", headers=auth)
        assert r.status_code == 201, r.text
        return r.json()["plan_id"]


async def _solver_draft_valid(snapshot: dict) -> dict:
    """Валидный черновик: по одному #1-части в отдельные спринты (ёмкость 8 SP на спринт)."""
    assignments = []
    for idx, task in enumerate(snapshot["tasks"], start=1):
        assignments.append({
            "part_id": f"{task['task_id']}#1",
            "task_id": task["task_id"],
            "part": 1,
            "sprint": idx,
            "team_id": task["team_id"],
        })
    return {
        "assignments": assignments,
        "staffing_moves": [],
        "score": {"hard": 0, "soft": 100},
        "score_breakdown": [{"constraint": "initiativeCompletedReward", "weight": 100000}],
    }


async def _draft_violating_sp_gate(snapshot: dict) -> dict:
    """Обе задачи в спринт 1: 10 SP > ёмкость 8 SP → 422."""
    return {
        "assignments": [
            {"part_id": "T-1#1", "task_id": "T-1", "part": 1, "sprint": 1, "team_id": "Team-A"},
            {"part_id": "T-2#1", "task_id": "T-2", "part": 1, "sprint": 1, "team_id": "Team-A"},
        ],
        "staffing_moves": [],
        "score": {"hard": 0, "soft": 50},
        "score_breakdown": [],
    }


async def _solver_draft_with_move(snapshot: dict) -> dict:
    draft = await _solver_draft_valid(snapshot)
    draft["staffing_moves"] = [
        {"engineer_id": "E-1", "from_team_id": "Team-A", "to_team_id": "Team-B"},
    ]
    return draft


async def _setup_job(session, workspace_id: str = "default", status: str = "solving") -> str:
    job = OptimizationJobORM(workspace_id=workspace_id, plan_id="p", status=status)
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job.job_id


@pytest.mark.asyncio
async def test_optimize_reader_forbidden(auths, monkeypatch):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auths["reader"], json={"plan_id": "x"})
        assert r.status_code == 403
        assert "plans_optimize" in r.json()["detail"]


@pytest.mark.asyncio
async def test_optimize_404_without_plan(auths, monkeypatch):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auths["editor"], json={"plan_id": "nope"})
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_optimize_solver_creates_version(auths, monkeypatch):
    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed_world(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _solver_draft_valid)
    auth = auths["editor"]
    plan_id = await _generate_plan(auth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 200, r.text
        job = r.json()
        assert job["status"] == "ready"
        assert job["mode"] == "solver"
        assert job["plan_id"]
        assert job["plan_id"] != plan_id

        jr = await ac.get(f"/api/v1/plans/optimize/{job['job_id']}", headers=auth)
        assert jr.status_code == 200
        jdata = jr.json()
        assert jdata["status"] == "ready"
        assert jdata["mode"] == "solver"
        assert jdata["plan_id"] == job["plan_id"]
        assert jdata["report"]["mode"] == "solver"
        assert jdata["score_breakdown"] and "constraint" in jdata["score_breakdown"][0]

        history = await ac.get("/api/v1/plans", headers=auth)
        versions = history.json()
        new_ver = next(v for v in versions if v["plan_id"] == job["plan_id"])
        assert new_ver["strategy"] == "optimization"
        assert new_ver["parent_plan_id"] == plan_id

        plan = await ac.get(f"/api/v1/plans/{job['plan_id']}", headers=auth)
        items = [t for s in plan.json()["sprints"] for t in s["tasks"]]
        assert {i["task_id"] for i in items} == {"T-1", "T-2"}
        assert all("оптимизаци" in (i["reason"] or "") for i in items)


@pytest.mark.asyncio
async def test_optimize_concurrent_409(auths, monkeypatch):
    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed_world(session)
        await _setup_job(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _solver_draft_valid)
    auth = auths["editor"]
    plan_id = await _generate_plan(auth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_optimize_job_404_foreign_and_missing(auths, monkeypatch):
    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed_world(session)
        foreign = await _setup_job(session, workspace_id="other-workspace")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/plans/optimize/nope", headers=auths["editor"])
        assert r.status_code == 404
        r = await ac.get(f"/api/v1/plans/optimize/{foreign}", headers=auths["editor"])
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_optimize_invalid_draft_422_no_version(auths, monkeypatch):
    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed_world(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _draft_violating_sp_gate)
    auth = auths["editor"]
    plan_id = await _generate_plan(auth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 422, r.text
        detail = r.json()["detail"]
        assert "валидаци" in detail["error"]

        history = await ac.get("/api/v1/plans", headers=auth)
        assert not any(v.get("parent_plan_id") == plan_id for v in history.json())  # версия не создана

        jobs = (await ac.get(f"/api/v1/plans/optimize/{detail['job_id']}", headers=auth)).json()
        assert jobs["status"] == "failed"
        assert "валидаци" in (jobs.get("error") or "")


@pytest.mark.asyncio
async def test_optimize_staffing_requires_admin(auths, monkeypatch):
    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed_world(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _solver_draft_with_move)
    auth = auths["editor"]
    plan_id = await _generate_plan(auth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 403, r.text
        assert "plans_optimize_staffing" in r.json()["detail"]


@pytest.mark.asyncio
async def test_optimize_admin_applies_staffing_moves(auths, monkeypatch):
    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed_world(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _solver_draft_with_move)
    auth = auths["admin"]
    plan_id = await _generate_plan(auth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 200, r.text
        job = r.json()
        assert job["status"] == "ready"
        assert job["mode"] == "solver"

        # применённые переносы сохранены в job.result и видны в отчёте
        jr = await ac.get(f"/api/v1/plans/optimize/{job['job_id']}", headers=auth)
        jdata = jr.json()
        assert jdata["staffing_moves"] == [
            {"engineer_id": "E-1", "from_team_id": "Team-A", "to_team_id": "Team-B"}]

        # применённые переносы сохранены в версии плана (таблица plan_staffing_moves)
        from src.db.models import StaffingMoveORM
        async with SessionLocal() as session:
            rows = (await session.execute(select(StaffingMoveORM).where(
                StaffingMoveORM.plan_id == job["plan_id"]))).scalars().all()
            assert [(r.engineer_id, r.from_team_id, r.to_team_id) for r in rows] == [
                ("E-1", "Team-A", "Team-B")]


@pytest.mark.asyncio
async def test_optimize_heuristic_fallback(auths, monkeypatch):
    from src.db.session import SessionLocal
    from src.services.optimizer_client import SolverUnavailable

    async def _unavailable(snapshot) -> dict:
        raise SolverUnavailable("стор сервис недоступен в тесте")

    async with SessionLocal() as session:
        await _seed_world(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _unavailable)
    auth = auths["editor"]
    plan_id = await _generate_plan(auth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 200, r.text
        job = r.json()
        assert job["status"] == "ready"
        assert job["mode"] == "heuristic"
        assert job["plan_id"] != plan_id
        jr = await ac.get(f"/api/v1/plans/optimize/{job['job_id']}", headers=auth)
        assert jr.json()["report"]["mode"] == "heuristic"