"""change 022, задачи 3.1–3.2: solver-версии несут assignments (016-совместимость).

После optimize plan items содержат назначения task × role × engineer × sprint;
GET /plans/{id} показывает engineer_id; личный план people/{engineer_id} видит
solver-версию, включая «выполнится частично» с причиной.
"""

import pytest
from datetime import date
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from src.db.models import EngineerORM, OptimizationJobORM, RoleRequirementORM, TaskORM, TeamHistoryORM
from src.main import app


async def _seed(session) -> None:
    """T-BIG 190 ч (Dev, 3 части после pre-split) + T-SMALL 40 ч; два Dev-инженера."""
    await session.execute(delete(OptimizationJobORM).where(OptimizationJobORM.workspace_id == "default"))
    await session.execute(delete(RoleRequirementORM).where(RoleRequirementORM.task_id.in_(["T-BIG", "T-SMALL"])))
    await session.execute(delete(TaskORM).where(TaskORM.task_id.in_(["T-BIG", "T-SMALL"])))
    await session.execute(delete(EngineerORM).where(EngineerORM.engineer_id.in_(["E-1", "E-2"])))
    await session.execute(delete(TeamHistoryORM).where(TeamHistoryORM.team_id == "Team-A"))
    session.add_all([
        TaskORM(task_id="T-BIG", workspace_id="default", parent_id="INI-1", team_id="Team-A",
                status="ToDo", priority=10, estimation_sp=19.0, estimated_hh=190.0,
                planned_in_sprint=True),
        TaskORM(task_id="T-SMALL", workspace_id="default", parent_id="INI-1", team_id="Team-A",
                status="ToDo", priority=20, estimation_sp=4.0, estimated_hh=40.0,
                planned_in_sprint=False),
        EngineerORM(engineer_id="E-1", workspace_id="default", team_id="Team-A",
                    role="Dev", capacity_rate=1.0),
        EngineerORM(engineer_id="E-2", workspace_id="default", team_id="Team-A",
                    role="Dev", capacity_rate=1.0),
        TeamHistoryORM(team_id="Team-A", workspace_id="default", snapshot_date=date(2026, 1, 1),
                       velocity_achieved=100.0, planned_sp=100.0),
    ])
    await session.flush()
    session.add_all([
        RoleRequirementORM(workspace_id="default", task_id="T-BIG", role="Dev", hours=190.0),
        RoleRequirementORM(workspace_id="default", task_id="T-SMALL", role="Dev", hours=40.0),
    ])
    await session.commit()


async def _solver_draft_all(snapshot: dict) -> dict:
    """Solver «размещает» все части тестовых задач: T-BIG части 1..3 в спринты 1,2,3,
    T-SMALL — в спринт 1."""
    assignments = []
    for task in snapshot["tasks"]:
        if task["task_id"] not in {"T-BIG", "T-SMALL"}:
            continue
        for p in task["parts"]:
            sprint = p["part"] if task["task_id"] == "T-BIG" else 1
            assignments.append({
                "part_id": f"{task['task_id']}#{p['part']}",
                "task_id": task["task_id"],
                "part": p["part"],
                "sprint": sprint,
                "team_id": task["team_id"],
            })
    return {"assignments": assignments, "staffing_moves": [],
            "score": {"hard": 0, "soft": 100}, "score_breakdown": []}


@pytest.mark.asyncio
async def test_solver_version_has_engineer_assignments(auths, monkeypatch):
    """3.1: GET /plans/{id} после optimize показывает engineer_id на частях."""
    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _solver_draft_all)
    auth = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/generate", headers=auth)
        plan_id = r.json()["plan_id"]
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 200, r.text
        new_plan = r.json()["plan_id"]

        plan = (await ac.get(f"/api/v1/plans/{new_plan}", headers=auth)).json()
        items = [t for s in plan["sprints"] for t in s["tasks"]
                 if t["task_id"] in {"T-BIG", "T-SMALL"}]
        assert items, "тестовые задачи запланированы"
        with_ass = [i for i in items if i.get("assignments")]
        assert with_ass, "solver-версия содержит assignments"
        for i in with_ass:
            for a in i["assignments"]:
                assert a["engineer_id"] in {"E-1", "E-2"}
                assert a["sprint_no"] == i["sprint_no"]
                assert a["hours"] > 0
        big_sprints = sorted(i["sprint_no"] for i in items if i["task_id"] == "T-BIG")
        assert big_sprints == [1, 2, 3], f"T-BIG растянута по 3 спринтам: {big_sprints}"


@pytest.mark.asyncio
async def test_person_plan_shows_solver_version(auths, monkeypatch):
    """3.2: личный план инженера видит назначения solver-версии."""
    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _solver_draft_all)
    auth = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        plan_id = (await ac.post("/api/v1/plans/generate", headers=auth)).json()["plan_id"]
        new_plan = (await ac.post("/api/v1/plans/optimize", headers=auth,
                                  json={"plan_id": plan_id})).json()["plan_id"]

        r = await ac.get(f"/api/v1/plans/{new_plan}/people/E-1", headers=auth)
        assert r.status_code == 200, r.text
        schedules = r.json()["schedules"]
        assert schedules, "личный план E-1 не пуст в solver-версии"
        total = sum(item["hours"] for items in schedules.values() for item in items)
        assert 0 < total <= 6 * 80.0
        assert all(item["task_id"] in {"T-BIG", "T-SMALL"}
                   for items in schedules.values() for item in items)


@pytest.mark.asyncio
async def test_solver_version_partial_reason(auths, monkeypatch):
    """3.2: непоместившиеся часы помечаются «выполнится частично» с причиной."""

    async def _draft_partial(snapshot: dict) -> dict:
        # solver размещает только 2 из 3 частей T-BIG; T-SMALL целиком
        resp = await _solver_draft_all(snapshot)
        resp["assignments"] = [
            a for a in resp["assignments"]
            if not (a["task_id"] == "T-BIG" and a["part"] == 3)
        ]
        return resp

    from src.db.session import SessionLocal
    async with SessionLocal() as session:
        await _seed(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _draft_partial)
    auth = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        plan_id = (await ac.post("/api/v1/plans/generate", headers=auth)).json()["plan_id"]
        new_plan = (await ac.post("/api/v1/plans/optimize", headers=auth,
                                  json={"plan_id": plan_id})).json()["plan_id"]
        plan = (await ac.get(f"/api/v1/plans/{new_plan}", headers=auth)).json()
        big = [t for s in plan["sprints"] for t in s["tasks"] if t["task_id"] == "T-BIG"]
        assert big and any("выполнится частично" in (t["reason"] or "") for t in big), \
            f"ожидалась причина частичного выполнения: {[t['reason'] for t in big]}"
