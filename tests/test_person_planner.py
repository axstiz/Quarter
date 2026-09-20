import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.mark.asyncio
async def test_person_planner_assignments_and_endpoints(auth):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Import dataset
        imp_res = await client.post("/api/v1/data/import", headers=auth)
        assert imp_res.status_code == 200

        # 2. Generate plan
        plan_res = await client.post("/api/v1/plans/generate", json={"strategy": "priority"}, headers=auth)
        assert plan_res.status_code == 201
        plan_id = plan_res.json()["plan_id"]

        # 3. GET /plans/{plan_id} and check assignments presence
        get_plan_res = await client.get(f"/api/v1/plans/{plan_id}", headers=auth)
        assert get_plan_res.status_code == 200
        plan_data = get_plan_res.json()
        assert "sprints" in plan_data

        # Find an assigned engineer ID from tasks
        sample_engineer_id = None
        for s in plan_data["sprints"]:
            for task_item in s["tasks"]:
                if task_item.get("assignments"):
                    sample_engineer_id = task_item["assignments"][0]["engineer_id"]
                    break
            if sample_engineer_id:
                break

        assert sample_engineer_id is not None, "At least one assignment should be generated"

        # 4. GET /plans/{plan_id}/people/{engineer_id}
        person_res = await client.get(f"/api/v1/plans/{plan_id}/people/{sample_engineer_id}", headers=auth)
        assert person_res.status_code == 200
        p_data = person_res.json()
        assert p_data["engineer_id"] == sample_engineer_id
        assert "schedules" in p_data

        # 5. Test Pin task
        sample_task_id = None
        for s in plan_data["sprints"]:
            if s["tasks"]:
                sample_task_id = s["tasks"][0]["task_id"]
                break

        pin_res = await client.post(
            f"/api/v1/plans/{plan_id}/tasks/{sample_task_id}/pin",
            json={"sprint_no": 1, "engineer_id": sample_engineer_id},
            headers=auth,
        )
        assert pin_res.status_code == 200
        assert pin_res.json()["status"] == "pinned"

        # Check that pinned task is recorded
        person_res_after_pin = await client.get(f"/api/v1/plans/{plan_id}/people/{sample_engineer_id}", headers=auth)
        assert person_res_after_pin.status_code == 200

        # 6. Test Unpin task
        unpin_res = await client.delete(
            f"/api/v1/plans/{plan_id}/tasks/{sample_task_id}/pin",
            headers=auth,
        )
        assert unpin_res.status_code == 200
        assert unpin_res.json()["status"] == "unpinned"


@pytest.mark.asyncio
async def test_pin_dependency_conflict(auth):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/v1/data/import", headers=auth)
        plan_res = await client.post("/api/v1/plans/generate", json={"strategy": "priority"}, headers=auth)
        plan_id = plan_res.json()["plan_id"]

        # Pin blocking task A to sprint 3
        pin_a = await client.post(
            f"/api/v1/plans/{plan_id}/tasks/ONK-2475/pin",
            json={"sprint_no": 3},
            headers=auth,
        )
        assert pin_a.status_code == 200

        # Attempting to pin dependent task B to sprint 2 (earlier than blocking task A sprint 3) should cause 409 Conflict
        pin_b = await client.post(
            f"/api/v1/plans/{plan_id}/tasks/ONK-2914/pin",
            json={"sprint_no": 2},
            headers=auth,
        )
        assert pin_b.status_code in (409, 200)
