"""change 019: правки данных редактором — role-hours, защита ключей, source=manual."""
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app

WS = "default"
TASK_ID = "TW-1"
ENG_ID = "EN-1"


async def _seed(session) -> None:
    from datetime import date

    from sqlalchemy import delete

    from src.db.models import (
        DependencyORM, EngineerORM, RoleRequirementORM, TaskORM, TeamHistoryORM,
    )

    for model in (DependencyORM, RoleRequirementORM, TaskORM, EngineerORM, TeamHistoryORM):
        await session.execute(delete(model).where(model.workspace_id == WS))
    session.add_all([
        TaskORM(task_id=TASK_ID, workspace_id=WS, parent_id=None, team_id="Team-A", summary="t1",
                status="ToDo", estimation_sp=5.0, estimated_hh=20.0, source="imported"),
        EngineerORM(engineer_id=ENG_ID, workspace_id=WS, team_id="Team-A", role="Dev",
                    grade="senior", skills_declared="", capacity_rate=1.0, source="imported"),
        TeamHistoryORM(workspace_id=WS, team_id="Team-A", snapshot_date=date(2026, 1, 1),
                       velocity_achieved=10.0, planned_sp=10.0),
    ])
    await session.commit()


async def _cleanup(session) -> None:
    from datetime import date

    from sqlalchemy import delete

    from src.db.models import (
        DependencyORM, EngineerORM, RoleRequirementORM, TaskORM, TeamHistoryORM,
    )

    snap = date(2026, 1, 1)
    await session.execute(delete(RoleRequirementORM).where(RoleRequirementORM.task_id == TASK_ID))
    await session.execute(delete(TaskORM).where(TaskORM.task_id == TASK_ID))
    await session.execute(delete(EngineerORM).where(EngineerORM.engineer_id == ENG_ID))
    await session.execute(delete(TeamHistoryORM).where(
        TeamHistoryORM.workspace_id == WS, TeamHistoryORM.team_id == "Team-A",
        TeamHistoryORM.snapshot_date == snap))
    await session.commit()


@pytest.mark.asyncio
async def test_role_hours_replacement(auths):
    """PUT role-hours заменяет набор, нулевые отбрасываются, записи → manual."""
    from sqlalchemy import delete, select

    from src.db.models import RoleRequirementORM
    from src.db.session import SessionLocal

    async with SessionLocal() as session:
        await _seed(session)
    h = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.put(f"/api/v1/tasks/{TASK_ID}/role-hours", headers=h,
                         json={"role_hours": {"Dev": 30, "Тестировщик": 10, "QA": 0}})
        assert r.status_code == 200, r.text
        assert set(r.json()["role_hours"]) == {"Dev", "Тестировщик"}
    async with SessionLocal() as session:
        rows = (await session.execute(select(RoleRequirementORM).where(RoleRequirementORM.task_id == TASK_ID))).scalars().all()
        assert sorted(x.role for x in rows) == ["Dev", "Тестировщик"]
        assert all(x.source == "manual" for x in rows)
    async with SessionLocal() as session:
        await _cleanup(session)


@pytest.mark.asyncio
async def test_task_key_change_rejected_409(auths):
    from src.db.session import SessionLocal

    async with SessionLocal() as session:
        await _seed(session)
    h = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.put(f"/api/v1/tasks/{TASK_ID}", headers=h, json={"task_id": "TW-2", "summary": "x"})
        assert r.status_code == 409, r.text
        assert "task_id" in r.json()["detail"]
        r = await ac.put(f"/api/v1/engineers/{ENG_ID}", headers=h, json={"engineer_id": "EN-2", "grade": "lead"})
        assert r.status_code == 409, r.text
        assert "engineer_id" in r.json()["detail"]
    async with SessionLocal() as session:
        await _cleanup(session)


@pytest.mark.asyncio
async def test_task_imported_edit_makes_manual(auths):
    from sqlalchemy import select

    from src.db.models import TaskORM
    from src.db.session import SessionLocal

    async with SessionLocal() as session:
        await _seed(session)
    h = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.put(f"/api/v1/tasks/{TASK_ID}", headers=h, json={"estimated_hh": 50.0, "summary": "правка"})
        assert r.status_code == 200, r.text
    async with SessionLocal() as session:
        task = (await session.execute(select(TaskORM).where(TaskORM.task_id == TASK_ID))).scalar_one()
        assert task.estimated_hh == 50.0 and task.source == "manual"
    async with SessionLocal() as session:
        await _cleanup(session)


@pytest.mark.asyncio
async def test_engineer_imported_edit_makes_manual(auths):
    from sqlalchemy import select

    from src.db.models import EngineerORM
    from src.db.session import SessionLocal

    async with SessionLocal() as session:
        await _seed(session)
    h = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.put(f"/api/v1/engineers/{ENG_ID}", headers=h, json={"skills_declared": "python, sql"})
        assert r.status_code == 200, r.text
    async with SessionLocal() as session:
        eng = (await session.execute(select(EngineerORM).where(EngineerORM.engineer_id == ENG_ID))).scalar_one()
        assert eng.skills_declared == "python, sql" and eng.source == "manual"
    async with SessionLocal() as session:
        await _cleanup(session)
