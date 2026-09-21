"""change 022-solver-personalization: pre-split частей в снапшоте и пер-специалистов раскладка.

- §1.1 build_snapshot: задача 190 ч → 3 части (80/80/30), роль-часы и SP пропорциональны;
  40 ч → одна часть.
- §2.1 раскладка по носителям: 100 ч роли / два носителя → 80 + 20.
- §2.2 сдвиг части на следующий спринт при занятых лимитах; не влезло до конца квартала —
  «выполнится частично» (не 422).
- §3.1 solver/эвристика версии пишут assignments — GET /plans/{id} и личный план их видят.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from src.domain.models import Engineer, Task, TeamHistory
from src.services.optimize_plan import _allocate_assignments
from src.services.optimizer_client import build_snapshot
from src.main import app


def _task(task_id: str = "T-1", hh: float = 190.0, sp: float = 10.0,
          roles: dict[str, float] | None = None) -> Task:
    return Task(
        task_id=task_id, parent_id="INI-1", team_id="Team-A", summary="t",
        status="ToDo", priority=10, estimation_sp=sp, estimated_hh=hh,
        role_hours=roles if roles is not None else {"Dev": hh},
    )


def _eng(eid: str = "E-1", rate: float = 1.0) -> Engineer:
    return Engineer(engineer_id=eid, team_id="Team-A", role="Dev", capacity_rate=rate)


def _history(velocity: float = 10.0) -> list[TeamHistory]:
    return [TeamHistory(team_id="Team-A", snapshot_date="2026-01-01",
                        velocity_achieved=velocity, planned_sp=velocity)]


# --- §1.1 pre-split в снапшоте ----------------------------------------------

def test_snapshot_splits_190h_into_80_80_30():
    snap = build_snapshot({"T-1": _task(hh=190.0, sp=10.0)}, [], [], [])
    parts = snap["tasks"][0]["parts"]
    assert [p["part"] for p in parts] == [1, 2, 3]
    assert [p["role_hours"]["dev"] for p in parts] == [80.0, 80.0, 30.0]
    # SP пропорциональны доле части: 10 * (80/190, 80/190, 30/190)
    assert sum(p["story_points"] for p in parts) == pytest.approx(10.0, abs=0.02)
    assert round(parts[0]["story_points"], 2) == round(10.0 * 80 / 190, 2)


def test_snapshot_40h_is_single_part():
    snap = build_snapshot({"T-1": _task(hh=40.0, sp=5.0)}, [], [], [])
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 1 and parts[0]["part"] == 1
    assert parts[0]["role_hours"]["dev"] == 40.0
    assert parts[0]["story_points"] == 5.0


def test_snapshot_split_capped_at_6_parts():
    snap = build_snapshot({"T-1": _task(hh=1000.0, sp=50.0)}, [], [], [])
    assert len(snap["tasks"][0]["parts"]) == 6


# --- §2.1–2.3 пер-специалистов раскладка ------------------------------------

def _draft(items: list[dict]) -> dict:
    return {"items": items, "postponed": [], "staffing_moves": [], "mode": "solver"}


def test_allocate_100h_between_two_holders_80_20():
    tasks = {"T-1": _task(hh=100.0, sp=5.0)}
    draft = _draft([{"task_id": "T-1", "part": 1, "sprint_no": 1,
                     "step_points_sp": 5.0, "role_hours": {"dev": 100.0}, "team_id": "Team-A"}])
    _allocate_assignments(draft, tasks, [_eng("E-1"), _eng("E-2")], _history())
    a = draft["items"][0]["assignments"]
    assert [(x["engineer_id"], x["hours"]) for x in a] == [("E-1", 80.0), ("E-2", 20.0)]
    assert all(x["sprint_no"] == 1 and x["role"] == "Dev" for x in a)


def test_part_shifts_3_to_4_when_holder_busy():
    tasks = {"A": _task(task_id="A", hh=80.0, sp=1.0), "B": _task(task_id="B", hh=80.0, sp=1.0)}
    draft = _draft([
        {"task_id": "A", "part": 1, "sprint_no": 3, "step_points_sp": 1.0,
         "role_hours": {"dev": 80.0}, "team_id": "Team-A"},
        {"task_id": "B", "part": 1, "sprint_no": 3, "step_points_sp": 1.0,
         "role_hours": {"dev": 80.0}, "team_id": "Team-A"},
    ])
    _allocate_assignments(draft, tasks, [_eng("E-1")], _history())
    by_task = {i["task_id"]: i for i in draft["items"]}
    assert by_task["A"]["sprint_no"] == 3
    # занятый спринт 3 → жадный сдвиг на первый свободный
    assert by_task["B"]["sprint_no"] == 4
    assert by_task["B"]["assignments"][0]["sprint_no"] == 4


def test_no_room_until_quarter_end_becomes_partial_not_422():
    tasks = {f"A{i}": _task(task_id=f"A{i}", hh=80.0, sp=0.5) for i in range(1, 7)}
    tasks["B"] = _task(task_id="B", hh=40.0, sp=0.5)
    items = [{"task_id": f"A{i}", "part": 1, "sprint_no": i, "step_points_sp": 0.5,
              "role_hours": {"dev": 80.0}, "team_id": "Team-A"} for i in range(1, 7)]
    items.append({"task_id": "B", "part": 1, "sprint_no": 6, "step_points_sp": 0.5,
                  "role_hours": {"dev": 40.0}, "team_id": "Team-A"})
    draft = _draft(items)
    _allocate_assignments(draft, tasks, [_eng("E-1")], _history())
    b = next(i for i in draft["items"] if i["task_id"] == "B")
    # пер-специалистов невыполнимость → частичность с числом часов, не исключение
    assert b["partial_leftover_hours"] == 40.0
    assert b["assignments"] == []
    assert b["sprint_no"] == 6


def test_partial_role_hours_get_virtual_holder():
    # роль без носителей — виртуальный держатель 80 ч/спринт, часть 50 ч размещается
    tasks = {"T-1": _task(task_id="T-1", hh=50.0, sp=1.0, roles={"Менеджер": 50.0})}
    draft = _draft([{"task_id": "T-1", "part": 1, "sprint_no": 1,
                     "step_points_sp": 1.0, "role_hours": {"менеджер": 50.0}, "team_id": "Team-A"}])
    _allocate_assignments(draft, tasks, [], _history())
    a = draft["items"][0]["assignments"]
    assert len(a) == 1 and a[0]["hours"] == 50.0 and a[0]["engineer_id"].startswith("VIRTUAL-")
    assert a[0]["role"] == "Менеджер"


# --- §3.1/3.2 assignments в версии плана ------------------------------------

async def _seed_world(session) -> None:
    """Как в test_optimize_jobs, но с роль-часами (Dev 20 ч на задачу) —
    без них planner'у нечего раскладывать по носителям."""
    from datetime import date

    from sqlalchemy import delete

    from src.db.models import (
        EngineerORM, RoleRequirementORM, TaskORM, TeamHistoryORM,
    )

    ids = ["T-1", "T-2"]
    await session.execute(delete(RoleRequirementORM).where(RoleRequirementORM.task_id.in_(ids)))
    await session.execute(delete(TaskORM).where(TaskORM.task_id.in_(ids)))
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
                       velocity_achieved=10.0, planned_sp=10.0),
    ])
    await session.flush()  # задачи раньше требований: FK task_role_requirements → tasks
    session.add_all([
        RoleRequirementORM(workspace_id="default", task_id="T-1", role="Dev", hours=20.0),
        RoleRequirementORM(workspace_id="default", task_id="T-2", role="Dev", hours=20.0),
    ])
    await session.commit()


@pytest.mark.asyncio
async def test_heuristic_version_writes_assignments(auths):
    from src.db.session import SessionLocal

    async with SessionLocal() as session:
        await _seed_world(session)
    auth = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/generate", headers=auth)
        assert r.status_code == 201, r.text
        plan_id = r.json()["plan_id"]
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 200, r.text
        job = r.json()
        assert job["mode"] == "heuristic"
        r = await ac.get(f"/api/v1/plans/{job['plan_id']}", headers=auth)
        planned = [t for s in r.json()["sprints"] for t in s["tasks"] if t["decision"] == "planned"]
        assert planned
        for t in planned:
            assert any(a.get("engineer_id") for a in (t.get("assignments") or [])), t


@pytest.mark.asyncio
async def test_solver_version_writes_assignments(auths, monkeypatch):
    from src.db.session import SessionLocal
    from tests.test_optimize_jobs import _generate_plan, _solver_draft_valid

    async with SessionLocal() as session:
        await _seed_world(session)
    monkeypatch.setattr("src.services.optimize_plan.solve_sidecar", _solver_draft_valid)
    auth = auths["editor"]
    plan_id = await _generate_plan(auth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/v1/plans/optimize", headers=auth, json={"plan_id": plan_id})
        assert r.status_code == 200, r.text
        job = r.json()
        assert job["mode"] == "solver"
        r = await ac.get(f"/api/v1/plans/{job['plan_id']}", headers=auth)
        planned = [t for s in r.json()["sprints"] for t in s["tasks"] if t["decision"] == "planned"]
        assert planned
        for t in planned:
            assert any(a.get("engineer_id") for a in (t.get("assignments") or [])), t
