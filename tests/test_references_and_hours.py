import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.services.reasons import KIND_TO_REASON, deviation_reason_for


def test_kind_to_deviation_reason_mapping():
    cats = ["Не оценивалась", "Отсутствие ресурсов", "Отсутствует готовность смежных команд",
            "Превышение плана", "Изменились требования"]
    assert deviation_reason_for("role_deficit", cats) == "Отсутствие ресурсов"
    assert deviation_reason_for("grade_deficit", cats) == "Отсутствие ресурсов"
    assert deviation_reason_for("deadline_overflow", cats) == "Превышение плана"
    assert deviation_reason_for("dependency_shift", cats) == "Отсутствует готовность смежных команд"
    assert deviation_reason_for("composition_change", cats) == "Изменились требования"
    assert deviation_reason_for("unknown_kind", cats) is None
    # виды без носителя в KIND_TO_REASON или вне справочника — без причины
    assert "role_deficit" in KIND_TO_REASON
    assert deviation_reason_for("role_deficit", ["Не оценивалась"]) is None


@pytest.mark.asyncio
async def test_import_references_and_hours(auths):
    h = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        imp_resp = await client.post("/api/v1/data/import", headers=h)
        assert imp_resp.status_code == 200
        counts = imp_resp.json()["counts"]
        assert counts["reference_values"] == 19
        assert counts["task_role_hours"] == 24

        # Task with actual hours in task_role_hours.csv (e.g., SRV-4041)
        task_resp = await client.get("/api/v1/tasks/SRV-4041", headers=h)
        assert task_resp.status_code == 200
        t_data = task_resp.json()
        assert "role_hours_actual" in t_data
        assert isinstance(t_data["role_hours_actual"], dict)
        assert t_data["role_hours_actual"]["аналитик"] == 80.0

        # Task without actual hours
        task_no_actual = await client.get("/api/v1/tasks/ONK-2475", headers=h)
        assert task_no_actual.status_code == 200
        assert "role_hours_actual" not in task_no_actual.json()

        # Причины предупреждений берутся из справочника (change 011, tasks 3.1/3.2)
        gen_resp = await client.post("/api/v1/plans/generate", headers=h)
        assert gen_resp.status_code == 201
        plan_id = gen_resp.json()["plan_id"]
        w_resp = await client.get(f"/api/v1/plans/{plan_id}/warnings", headers=h)
        assert w_resp.status_code == 200
        warnings = w_resp.json()
        valid = {"Не оценивалась", "Отсутствие ресурсов", "Отсутствует готовность смежных команд",
                 "Превышение плана", "Изменились требования"}
        for w in warnings:
            kind = w["kind"]
            if kind in KIND_TO_REASON:
                assert w["reference_category"] in valid
                assert "причина по справочнику" in w["message"]
