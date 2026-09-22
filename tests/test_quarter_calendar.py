import pytest
from datetime import date
from httpx import ASGITransport, AsyncClient

from src.core.calendar import calculate_quarter_start, get_sprint_dates
from src.domain.models import Task
from src.main import app


def test_quarter_start_calculation():
    # 1) max(planned_end) in Q3 (August 2026) -> Next quarter is Q4 (Oct 1, 2026)
    tasks = [
        Task(task_id="T1", team_id="A", planned_end=date(2026, 8, 1)),
        Task(task_id="T2", team_id="A", planned_end=date(2026, 6, 15)),
    ]
    assert calculate_quarter_start(tasks) == date(2026, 10, 1)

    # 2) max(planned_end) in Q4 (Oct 30, 2026) -> Next quarter is Q1 (Jan 1, 2027)
    tasks_q4 = [Task(task_id="T3", team_id="A", planned_end=date(2026, 10, 30))]
    assert calculate_quarter_start(tasks_q4) == date(2027, 1, 1)

    # 3) Fallback actual_end when no planned_end
    tasks_actual = [Task(task_id="T4", team_id="A", actual_end=date(2026, 5, 20))]
    assert calculate_quarter_start(tasks_actual) == date(2026, 7, 1)

    # 4) Fallback current_date when no dates in tasks
    tasks_nodates = [Task(task_id="T5", team_id="A")]
    assert calculate_quarter_start(tasks_nodates, current_date=date(2026, 2, 10)) == date(2026, 4, 1)


def test_sprint_dates_generation():
    q_start = date(2026, 10, 1)
    s_dates = get_sprint_dates(q_start)
    assert len(s_dates) == 6
    assert s_dates["1"] == {"start": "2026-10-01", "end": "2026-10-14"}
    assert s_dates["2"] == {"start": "2026-10-15", "end": "2026-10-28"}
    assert s_dates["6"] == {"start": "2026-12-10", "end": "2026-12-23"}


@pytest.mark.asyncio
async def test_api_quarter_calendar(auths):
    h = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Import dataset
        await client.post("/api/v1/data/import", headers=h)

        # Generate plan
        gen_resp = await client.post("/api/v1/plans/generate", headers=h)
        assert gen_resp.status_code == 201
        plan_id = gen_resp.json()["plan_id"]

        # GET /plans/{plan_id}
        plan_resp = await client.get(f"/api/v1/plans/{plan_id}", headers=h)
        assert plan_resp.status_code == 200
        pdata = plan_resp.json()

        assert "quarter_start" in pdata
        assert "sprint_dates" in pdata
        assert len(pdata["sprint_dates"]) == 6

        # Check date_forecast in planned tasks
        first_sprint_tasks = pdata["sprints"][0]["tasks"]
        if first_sprint_tasks:
            t = first_sprint_tasks[0]
            assert "date_forecast" in t
            assert "start" in t["date_forecast"]
            assert "end" in t["date_forecast"]

        # POST facts with role_hours_fact
        fact_resp = await client.post(
            f"/api/v1/plans/{plan_id}/sprints/1/facts",
            headers=h,
            json={
                "completed_sp": 15.0,
                "completed_task_ids": [],
                "role_hours_fact": {"Тестировщик": 40.0},
            },
        )
        assert fact_resp.status_code == 200
        assert "new_plan_id" in fact_resp.json()
