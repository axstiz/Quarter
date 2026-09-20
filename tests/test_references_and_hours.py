import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.mark.asyncio
async def test_import_references_and_hours():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        imp_resp = await client.post("/api/v1/data/import")
        assert imp_resp.status_code == 200
        counts = imp_resp.json()["counts"]
        assert counts["reference_values"] == 19
        assert counts["task_role_hours"] == 24

        # Task with actual hours in task_role_hours.csv (e.g., SRV-4041)
        task_resp = await client.get("/api/v1/tasks/SRV-4041")
        assert task_resp.status_code == 200
        t_data = task_resp.json()
        assert "role_hours_actual" in t_data
        assert isinstance(t_data["role_hours_actual"], dict)
        assert t_data["role_hours_actual"]["аналитик"] == 80.0

        # Task without actual hours
        task_no_actual = await client.get("/api/v1/tasks/ONK-2475")
        assert task_no_actual.status_code == 200
        assert "role_hours_actual" not in task_no_actual.json()
