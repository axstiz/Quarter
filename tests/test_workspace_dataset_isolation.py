"""Change 025: изоляция датасета по workspace — идентичность (workspace_id, biz-id).

Red-фаза: на глобальном PK tasks.task_id тесты 1.1/1.3/1.4 падают,
1.2 падает на дубликатах role_requirements/team_history.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from src.main import app


@pytest.fixture()
def sample_xlsx():
    from pathlib import Path

    xlsx = Path(__file__).resolve().parent.parent / "Датасет_с_правками_основной.xlsx"
    assert xlsx.exists()
    return xlsx


async def _counts(workspace_id: str) -> dict[str, int]:
    import src.db.session as session_mod
    from src.db.models import DependencyORM, EngineerORM, RoleRequirementORM, TaskORM, TeamHistoryORM

    async def n(model):
        q = select(func.count()).select_from(model).where(model.workspace_id == workspace_id)
        return (await s.execute(q)).scalar_one()

    async with session_mod.SessionLocal() as s:
        return {
            "tasks": await n(TaskORM),
            "engineers": await n(EngineerORM),
            "dependencies": await n(DependencyORM),
            "role_requirements": await n(RoleRequirementORM),
            "team_history": await n(TeamHistoryORM),
        }


async def _upload_confirm(client: AsyncClient, xlsx, workspace_id: str) -> dict:
    h = {"X-Workspace-Id": workspace_id}
    r = await client.post("/api/v1/data/upload", files={"file": ("d.xlsx", xlsx.read_bytes())}, headers=h)
    assert r.status_code == 201
    job_id = r.json()["job_id"]
    r = await client.post(f"/api/v1/data/jobs/{job_id}/confirm", headers=h)
    assert r.status_code == 200
    return r.json()["counts"]


async def _new_workspace(client: AsyncClient, name: str) -> str:
    r = await client.post("/workspaces", json={"name": name})
    assert r.status_code == 201
    return r.json()["id"]


@pytest.mark.asyncio
async def test_same_dataset_imports_into_two_workspaces(auths, sample_xlsx):
    """1.1: один датасет в два workspace — независимые копии, первый не меняется."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                           headers=auths["editor"]) as client:
        if (await _counts("default"))["tasks"] == 0:
            r = await client.post("/api/v1/data/import")
            assert r.status_code == 200
        before_a = await _counts("default")

        ws_b = await _new_workspace(client, "isolation-B")
        await _upload_confirm(client, sample_xlsx, ws_b)

        counts_b = await _counts(ws_b)
        # эталон — факты датасета (как в test_data_import_counts), а не ответ confirm
        expected_b = {"tasks": 45 + 7, "engineers": 34, "dependencies": 15,
                      "role_requirements": 307, "team_history": 12}
        assert counts_b == expected_b, f"workspace B получил неполную копию: {counts_b} vs {expected_b}"
        after_a = await _counts("default")
        assert after_a == before_a, f"импорт в B изменил default: {before_a} → {after_a}"


@pytest.mark.asyncio
async def test_reimport_same_workspace_merges_without_duplicates(auths, sample_xlsx):
    """1.2: повторный импорт — merge без дубликатов; manual-записи сохраняются."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                           headers=auths["editor"]) as client:
        ws = await _new_workspace(client, "reimport-merge")
        await _upload_confirm(client, sample_xlsx, ws)

        r = await client.post("/api/v1/tasks", headers={"X-Workspace-Id": ws},
                              json={"task_id": "MAN-1", "summary": "ручная задача", "team_id": "КОР"})
        assert r.status_code == 201, r.text
        first = await _counts(ws)

        await _upload_confirm(client, sample_xlsx, ws)
        second = await _counts(ws)
        assert second == first, f"повторный импорт наплодил дубликаты: {first} → {second}"

        r = await client.get("/api/v1/tasks", headers={"X-Workspace-Id": ws})
        manual = [t for t in r.json() if t["task_id"] == "MAN-1"]
        assert manual and manual[0]["summary"] == "ручная задача"
        import src.db.session as session_mod
        from src.db.models import TaskORM
        async with session_mod.SessionLocal() as s:
            src = (await s.execute(select(TaskORM.source).where(
                TaskORM.workspace_id == ws, TaskORM.task_id == "MAN-1"))).scalar_one()
        assert src == "manual", "повторный импорт затёр manual-задачу"


@pytest.mark.asyncio
async def test_generate_plan_in_second_workspace(auths, sample_xlsx):
    """1.3: после импорта во второй workspace план строится из его данных."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                           headers=auths["editor"]) as client:
        ws_b = await _new_workspace(client, "generate-in-B")
        await _upload_confirm(client, sample_xlsx, ws_b)

        r = await client.post("/api/v1/plans/generate", headers={"X-Workspace-Id": ws_b})
        assert r.status_code == 201, r.text
        plan_id = r.json()["plan_id"]

        plan = (await client.get(f"/api/v1/plans/{plan_id}",
                                 headers={"X-Workspace-Id": ws_b})).json()
        planned_ids = {t["task_id"] for s in plan["sprints"] for t in s["tasks"]}
        b_ids = {t["task_id"] for t in
                 (await client.get("/api/v1/tasks", headers={"X-Workspace-Id": ws_b})).json()}
        assert planned_ids, "план пустой"
        assert planned_ids <= b_ids, "в плане задачи не из workspace B"


@pytest.mark.asyncio
async def test_reset_one_workspace_keeps_other(auths):
    """1.4: /data/import во втором workspace не трогает задачи и планы первого."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                           headers=auths["editor"]) as client:
        r = await client.post("/api/v1/data/import")
        assert r.status_code == 200
        before_a = await _counts("default")
        plans_a = len((await client.get("/api/v1/plans")).json())

        ws_b = await _new_workspace(client, "reset-isolation")
        r = await client.post("/api/v1/data/import", headers={"X-Workspace-Id": ws_b})
        assert r.status_code == 200
        assert (await _counts(ws_b))["tasks"] > 0
        assert await _counts("default") == before_a
        assert len((await client.get("/api/v1/plans")).json()) == plans_a
