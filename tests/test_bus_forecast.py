"""change 023: прогноз bus factor по плановой загрузке (unit + API)."""
import pytest
from httpx import ASGITransport, AsyncClient

from src.domain.models import Assignment, Engineer, Plan, PlanDecision, PlanItem, SprintPlan
from src.services.bus_factor import plan_bus_forecast
from src.main import app


def _task(task_id: str, sp: float = 5.0, hh: float = 60.0, role: str = "Dev") -> dict:
    return {
        "task_id": task_id,
        "parent_id": None,
        "team_id": "Team-A",
        "summary": f"task {task_id}",
        "status": "ToDo",
        "estimation_sp": sp,
        "estimated_hh": hh,
        "role_hours": {role: hh},
    }


def _item(task_id: str, sprint_no: int, assignments: list[tuple[str, str, float]]) -> PlanItem:
    return PlanItem(
        task_id=task_id, decision=PlanDecision.planned, sprint_no=sprint_no, reason="",
        step_points_sp=5.0,
        assignments=[Assignment(task_id=task_id, role=role, engineer_id=eid,
                                sprint_no=sprint_no, hours=hours)
                     for eid, role, hours in assignments],
    )


def _plan(items: list[PlanItem]) -> Plan:
    by_sprint: dict[int, list[PlanItem]] = {}
    for it in items:
        by_sprint.setdefault(it.sprint_no, []).append(it)
    return Plan(plan_id="p-test", sprints=[SprintPlan(sprint_no=n, items=its) for n, its in sorted(by_sprint.items())])


def _eng(eid: str = "ENG-1", rate: float = 1.0) -> Engineer:
    return Engineer(engineer_id=eid, team_id="Team-A", role="Dev", capacity_rate=rate)


def test_single_holder_with_volume_is_high():
    tasks = {"T-1": _task("T-1"), "T-2": _task("T-2"), "T-3": _task("T-3"), "T-4": _task("T-4")}
    engineers = [_eng("ENG-1")]
    plan = _plan([
        _item("T-1", 2, [("ENG-1", "Dev", 30)]),
        _item("T-2", 3, [("ENG-1", "Dev", 30)]),
        _item("T-3", 3, [("ENG-1", "Dev", 30)]),
        _item("T-4", 4, [("ENG-1", "Dev", 30)]),
    ])
    out = plan_bus_forecast(plan, tasks, engineers)
    p = out["people"][0]
    assert p["engineer_id"] == "ENG-1"
    # единственный носитель + 4 задачи / 120 ч → high
    assert p["risk"]["level"] == "high"
    assert p["critical_roles"] == ["Dev"]
    assert p["risk"]["affected_tasks"] == 4 and p["risk"]["affected_hours"] == 120.0
    assert "единственный носитель" in p["risk"]["basis"]


def test_well_staffed_role_is_not_high():
    tasks = {"T-1": _task("T-1")}
    engineers = [_eng("ENG-1"), _eng("ENG-2"), _eng("ENG-3"), _eng("ENG-4")]
    plan = _plan([_item("T-1", 1, [("ENG-1", "Dev", 60)])])
    out = plan_bus_forecast(plan, tasks, engineers)
    p = next(x for x in out["people"] if x["engineer_id"] == "ENG-1")
    assert p["critical_roles"] == []
    assert p["risk"]["level"] == "low"


def test_overloaded_sprint_flags_medium():
    tasks = {"T-1": _task("T-1", hh=100.0, role="QA")}
    # один носитель роли, но объём ниже порога high (задач 1 < 3, часов 100 ≥ 80 —
    # фактически это high-порог; проверяем через роль, где носителей несколько)
    engineers = [_eng("ENG-1", rate=0.5), _eng("ENG-5"), _eng("ENG-6")]
    from src.domain.models import Engineer as E

    engineers[1] = Engineer(engineer_id="ENG-5", team_id="Team-A", role="QA", capacity_rate=1.0)
    engineers[2] = Engineer(engineer_id="ENG-6", team_id="Team-A", role="QA", capacity_rate=1.0)
    plan = _plan([_item("T-1", 2, [("ENG-1", "QA", 100)])])  # перегруз: 100 > 40 ч лимита
    out = plan_bus_forecast(plan, tasks, engineers)
    p = out["people"][0]
    assert p["limit_hours_per_sprint"] == 40.0
    assert p["overloaded_sprints"] == ["2"]
    assert p["critical_roles"] == []  # QA носят трое
    assert p["risk"]["level"] == "medium"  # перегруз + загрузка ≥ 80 ч
    assert "перегруз" in p["risk"]["basis"]


def test_virtual_holders_and_idle_engineers_excluded():
    tasks = {"T-1": _task("T-1")}
    engineers = [_eng("ENG-1")]
    plan = _plan([_item("T-1", 1, [("VIRTUAL-PM-0", "Менеджер", 20)])])
    out = plan_bus_forecast(plan, tasks, engineers)
    ids = [x["engineer_id"] for x in out["people"]]
    assert ids == []
    assert out["methodology"]


def test_people_sorted_by_risk_then_volume():
    tasks = {"T-1": _task("T-1"), "T-2": _task("T-2"), "T-3": _task("T-3"), "T-4": _task("T-4")}
    engineers = [_eng("ENG-1"), _eng("ENG-2"), _eng("ENG-3"), _eng("ENG-4")]
    plan = _plan([
        _item("T-1", 1, [("ENG-1", "Dev", 30)]),
        _item("T-2", 1, [("ENG-2", "Dev", 30)]),
        _item("T-3", 2, [("ENG-2", "Dev", 30)]),
        _item("T-4", 3, [("ENG-2", "Dev", 30)]),
    ])
    out = plan_bus_forecast(plan, tasks, engineers)
    # ENG-2 — 3 задачи; ENG-1 — 1 задача; оба unitary... нет: Dev носят четверо → у
    # ENG-2 объём 3 задачи/90 ч, но роль не единственная → оценка по уровню low.
    # ENG-1 — low. Порядок: по уровню, затем по объёму убыв.
    assert [p["engineer_id"] for p in out["people"]][:2] == ["ENG-2", "ENG-1"]


# --- API ---------------------------------------------------------------------

@pytest.mark.asyncio
async def test_forecast_endpoint_404_without_plan(auths):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/plans/nope/bus-forecast", headers=auths["editor"])
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_forecast_endpoint_on_demo_dataset(auths):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        h = auths["editor"]
        await ac.post("/api/v1/data/import", headers=h)
        gen = await ac.post("/api/v1/plans/generate", headers=h)
        plan_id = gen.json()["plan_id"]
        r = await ac.get(f"/api/v1/plans/{plan_id}/bus-forecast", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["plan_id"] == plan_id
        assert body["methodology"]
        people = body["people"]
        assert people, "в демо-плане есть загрузка"
        assert all(p["risk"]["level"] in ("high", "medium", "low") for p in people)
        levels = [p["risk"]["level"] for p in people]
        assert levels == sorted(levels, key={"high": 0, "medium": 1, "low": 2}.get)
        assert all(p["total_hours"] > 0 for p in people)
