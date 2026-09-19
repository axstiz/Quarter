import pytest
from httpx import ASGITransport, AsyncClient

from src.domain.models import Engineer, Task, TeamHistory
from src.main import app
from src.services.metrics import compute_metrics
from src.services.planner import PlannerInput, generate_plan


def test_metric_driven_planner_strategy():
    tasks = [
        Task(task_id="T1", parent_id="BR-1", team_id="Team-L", estimation_sp=5.0, priority=100.0),
        Task(task_id="T2", parent_id="BR-2", team_id="Team-L", estimation_sp=2.0, priority=50.0, planned_in_sprint=True),
    ]
    engineers = [Engineer(engineer_id="E1", team_id="Team-L", role="Разработчик Java")]
    history = [TeamHistory(team_id="Team-L", snapshot_date="2026-01-01", velocity_achieved=20.0, planned_sp=20.0)]

    # Priority strategy (default) -> T2 (priority 50) first
    p_plan = generate_plan(PlannerInput(tasks, engineers, history, []), strategy="priority")
    assert p_plan.sprints[0].items[0].task_id == "T2"

    # Metrics strategy -> T2 (planned_in_sprint=True) customer flag first
    m_plan = generate_plan(PlannerInput(tasks, engineers, history, []), strategy="metrics")
    assert m_plan.sprints[0].items[0].task_id == "T2"


def test_metrics_target_band_and_norm():
    # Quarter completion 100% -> within norm (80..100)
    rep = compute_metrics(
        initial_planned_task_ids=["T1", "T2"],
        done_task_ids=["T1", "T2"],
        planned_sp_by_sprint={1: 10.0},
        done_sp_by_sprint={1: 9.5},
    )
    assert rep.quarter_target_band == [80.0, 100.0]
    assert rep.quarter_within_norm is True
    assert rep.sprint_target_band == [90.0, 105.0]
    assert rep.sprint_within_norm[1] is True


@pytest.mark.asyncio
async def test_api_metric_driven_order_and_reports():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/v1/data/import")

        # 1) Generate plan with metrics strategy
        r_gen = await client.post("/api/v1/plans/generate", json={"strategy": "metrics"})
        assert r_gen.status_code == 201
        pdata = r_gen.json()
        assert pdata["strategy"] == "metrics"
        plan_id = pdata["plan_id"]

        # 2) Reject invalid strategy
        r_bad = await client.post("/api/v1/plans/generate", json={"strategy": "invalid"})
        assert r_bad.status_code == 422

        # 3) GET /plans/{id}/optimization-report
        r_opt = await client.get(f"/api/v1/plans/{plan_id}/optimization-report")
        assert r_opt.status_code == 200
        opt_data = r_opt.json()
        assert opt_data["strategy_used"] == "metrics"
        assert "kpi_summary" in opt_data

        # 4) GET /plans/{id}/staffing-suggestions
        r_stf = await client.get(f"/api/v1/plans/{plan_id}/staffing-suggestions")
        assert r_stf.status_code == 200
        assert "suggestions" in r_stf.json()
