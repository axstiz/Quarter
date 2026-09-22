"""change 025: идемпотентность повторного импорта — без дублей требований и истории."""
import pytest

from src.db.models import EngineerORM, RoleRequirementORM, TaskORM, TeamHistoryORM
from src.db.staging import stage_import


class _StubJob:
    """Минимальный job для stage_import: rows_by_entity как в normalization."""

    def __init__(self, rows: dict[str, list[dict]]):
        self.rows_by_entity = rows


def _rows():
    return {
        "task": [{"task_id": "TW-025", "summary": "x", "team_id": "Team-A", "status": "ToDo", "estimation_sp": 5, "estimated_hh": 20}],
        "engineer": [{"engineer_id": "E-025", "team_id": "Team-A", "role": "Dev", "grade": "senior", "skills_declared": "", "capacity_rate": 1.0}],
        "team_history": [
            {"team_id": "Team-A", "snapshot_date": "2026-09-01", "velocity_achieved": 10, "planned_sp": 10},
        ],
        "role_requirement": [{"task_id": "TW-025", "role_hours": {"Dev": 20.0}}],
    }


@pytest.mark.asyncio
async def test_stage_import_idempotent_requirements_and_history(auth):
    """Два идентичных импорта подряд: часы ролей и velocity не удваиваются (bugfix 025)."""
    from sqlalchemy import delete, select

    from src.db.session import SessionLocal

    ws = "ws-regr-025"
    job = _StubJob(_rows())
    async with SessionLocal() as session:
        for _ in range(2):
            await stage_import(session, job, workspace_id=ws)
        reqs = (await session.execute(select(RoleRequirementORM).where(RoleRequirementORM.workspace_id == ws))).scalars().all()
        assert len(reqs) == 1
        assert reqs[0].hours == pytest.approx(20.0)  # не 40
        hist = (await session.execute(select(TeamHistoryORM).where(TeamHistoryORM.workspace_id == ws))).scalars().all()
        assert len(hist) == 1
        assert hist[0].velocity_achieved == pytest.approx(10.0)  # не 20

    # чистим за собой (БД общая для всех тестов)
    async with SessionLocal() as session:
        for model in (RoleRequirementORM, TeamHistoryORM, EngineerORM, TaskORM):
            await session.execute(delete(model).where(model.workspace_id == ws))
        await session.commit()
