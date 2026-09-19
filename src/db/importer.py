from __future__ import annotations

import csv
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import (
    DependencyORM,
    EngineerORM,
    ReferenceValueORM,
    RoleRequirementORM,
    TaskORM,
    TaskRoleHoursORM,
    TeamHistoryORM,
)

EXCEL_EPOCH = date(1899, 12, 30)

FILES = {
    "tasks.csv",
    "task_role_hours.csv",
    "task_role_requirements.csv",
    "task_dependencies.csv",
    "engineers_profiles.csv",
    "team_history.csv",
    "reference_values.csv",
}


def _f(value: str) -> float:
    if not value:
        return 0.0
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return 0.0


def _date(value: str) -> date | None:
    if not value:
        return None
    try:
        y, m, d = value.split("-")
        return date(int(y), int(m), int(d))
    except (ValueError, AttributeError):
        return None


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


async def reset_dataset_tables(session: AsyncSession) -> None:
    """Повторный импорт очищает только импортные, не затирает ручные записи
    (source == manual, спека data). Планы и факты сохраняются (спека architecture)."""
    for model in (RoleRequirementORM, DependencyORM, EngineerORM, TeamHistoryORM, TaskORM, ReferenceValueORM, TaskRoleHoursORM):
        if "source" in model.__table__.c:
            await session.execute(
                model.__table__.delete().where(model.__table__.c.source != "manual")
            )
        else:
            await session.execute(model.__table__.delete())


async def import_dataset(session: AsyncSession, dataset_dir: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    missing = FILES - {p.name for p in dataset_dir.iterdir()}
    if missing:
        raise FileNotFoundError(f"dataset не полный: {missing}")

    existing_ids = {
        r.task_id for r in (await session.execute(select(TaskORM))).scalars().all()
    }
    tasks_rows = read_csv(dataset_dir / "tasks.csv")
    for i, row in enumerate(tasks_rows):
        if row["task_id"] in existing_ids:
            continue  # ручная запись (source=manual) приоритетна, спека data
        session.add(TaskORM(
            task_id=row["task_id"],
            parent_id=row.get("parent_id") or None,
            team_id=row.get("team_id", ""),
            summary=row.get("summary", ""),
            status=row.get("status", "ToDo"),
            estimation_sp=_f(row.get("estimation_sp", "")),
            estimated_hh=_f(row.get("estimated_hh", "")),
            spent_time=_f(row.get("spent_time", "")),
            priority=(10 if row.get("planned_in_sprint", "") == "Да" else 100 + i),
            planned_in_sprint=row.get("planned_in_sprint", "") == "Да",
            planned_start=_date(row.get("planned_start", "")),
            planned_end=_date(row.get("planned_end", "")),
            actual_start=_date(row.get("actual_start", "")),
            actual_end=_date(row.get("actual_end", "")),
        ))
    counts["tasks"] = len(tasks_rows) - len(existing_ids & {r["task_id"] for r in tasks_rows})

    seen_deps = set()
    for row in read_csv(dataset_dir / "task_dependencies.csv"):
        key = (row["blocking_task_id"], row["blocked_task_id"])
        if key in seen_deps or not all(key):
            continue
        seen_deps.add(key)
        session.add(DependencyORM(
            blocking_task_id=row["blocking_task_id"],
            blocked_task_id=row["blocked_task_id"],
            dependency_type=row.get("dependency_type", ""),
        ))
    counts["dependencies"] = len(seen_deps)

    for row in read_csv(dataset_dir / "task_role_requirements.csv"):
        session.add(RoleRequirementORM(
            task_id=row["task_id"],
            role=row["role"],
            hours=_f(row.get("hours", "")),
        ))
    counts["role_requirements"] = len(read_csv(dataset_dir / "task_role_requirements.csv"))

    for row in read_csv(dataset_dir / "engineers_profiles.csv"):
        session.add(EngineerORM(
            engineer_id=row["engineer_id"],
            team_id=row["team_id"],
            role=row["role"],
            grade=row.get("grade", ""),
            skills_declared=row.get("skills_declared", ""),
            capacity_rate=_f(row.get("capacity_rate", "") or "1.0"),
        ))
    counts["engineers"] = len(read_csv(dataset_dir / "engineers_profiles.csv"))

    n_hist = 0
    for row in read_csv(dataset_dir / "team_history.csv"):
        d = _date(row.get("snapshot_date", ""))
        if not d:
            continue
        session.add(TeamHistoryORM(
            snapshot_date=d,
            team_id=row["team_id"],
            velocity_achieved=_f(row.get("velocity_achieved", "")),
            planned_sp=_f(row.get("planned_sp", "")),
        ))
        n_hist += 1
    counts["team_history"] = n_hist

    ref_rows = read_csv(dataset_dir / "reference_values.csv")
    for row in ref_rows:
        session.add(ReferenceValueORM(
            category=row.get("category", ""),
            value=row.get("value", ""),
        ))
    counts["reference_values"] = len(ref_rows)

    hours_rows = read_csv(dataset_dir / "task_role_hours.csv")
    hours_count = 0
    for row in hours_rows:
        tid = row.get("task_id", "")
        for col, val_str in row.items():
            if col in ("task_id", "исходное_время"):
                continue
            val = _f(val_str)
            if val > 0:
                session.add(TaskRoleHoursORM(
                    task_id=tid,
                    role=col,
                    hours=val,
                ))
                hours_count += 1
    counts["task_role_hours"] = hours_count

    await session.commit()
    return counts
