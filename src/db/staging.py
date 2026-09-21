"""Импорт staged-данных (из job пайплайна) с merge-правилами спеки data/onboarding:
- записи с source='manual' не затираются;
- при совпадении ключей обновляются только записи с source='imported'.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import DependencyORM, EngineerORM, RoleRequirementORM, TaskORM, TeamHistoryORM

EXCEL_EPOCH = date(1899, 12, 30)
TASK_ID_RE = re.compile(r"^[A-Za-z]{2,8}[-_]?[0-9]{2,6}$")


def _f(value, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value or "").replace(",", "."))
    except ValueError:
        return default


def _date_conv(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    if re.match(r"^\d+(\.\d+)?$", s):
        try:
            return EXCEL_EPOCH + timedelta(days=float(s))
        except Exception:
            return None
    return None


async def _upsert_task(session: AsyncSession, tid: str, row: dict, order_index: int = 100,
                       workspace_id: str = "default") -> bool:
    existing = (await session.execute(select(TaskORM).where(
        TaskORM.task_id == tid, TaskORM.workspace_id == workspace_id))).scalar_one_or_none()
    if existing:
        if existing.source == "manual":
            return False
        existing.summary = str(row.get("summary") or existing.summary)
        existing.status = str(row.get("status") or existing.status)
        existing.parent_id = str(row.get("parent_id") or "") or existing.parent_id
        existing.team_id = str(row.get("team_id") or "") or existing.team_id
        existing.estimation_sp = _f(row.get("estimation_sp"), existing.estimation_sp)
        existing.estimated_hh = _f(row.get("estimated_hh"), existing.estimated_hh)
        existing.spent_time = _f(row.get("spent_time"), existing.spent_time)
        existing.source = "imported"
        return False
    session.add(TaskORM(
        task_id=tid,
        workspace_id=workspace_id,
        parent_id=str(row.get("parent_id") or "") or None,
        team_id=str(row.get("team_id") or ""),
        summary=str(row.get("summary") or ""),
        status=str(row.get("status") or "ToDo"),
        estimation_sp=_f(str(row.get("estimation_sp") or "")),
        estimated_hh=_f(str(row.get("estimated_hh") or "")),
        spent_time=_f(row.get("spent_time")),
        priority=(10 if row.get("planned_in_sprint") == "Да" else 100 + order_index),
        source="imported",
    ))
    return True


async def _upsert_role_req(session: AsyncSession, workspace_id: str, tid: str, role: str, hours: float) -> bool:
    existing = (await session.execute(select(RoleRequirementORM).where(
        RoleRequirementORM.workspace_id == workspace_id,
        RoleRequirementORM.task_id == tid, RoleRequirementORM.role == role))).scalars().first()
    if existing:
        if existing.source == "manual":
            return False
        existing.hours = hours
        existing.source = "imported"
    else:
        session.add(RoleRequirementORM(
            workspace_id=workspace_id, task_id=tid, role=role, hours=hours, source="imported"))
    return True


async def stage_import(session: AsyncSession, job, workspace_id: str = "default") -> dict[str, int]:
    counts: dict[str, int] = {}
    tasks = job.rows_by_entity.get("task", [])
    engineers = job.rows_by_entity.get("engineer", [])
    dependencies = job.rows_by_entity.get("dependency", [])
    history = job.rows_by_entity.get("team_history", [])
    role_reqs = job.rows_by_entity.get("role_requirement", [])

    by_task_id: dict[str, dict] = {}
    for row in tasks:
        tid = str(row.get("task_id") or "").strip()
        if not tid or not TASK_ID_RE.match(tid):
            continue
        # полнота записи: отсекаем блоки-"<task_id> only" (пустые записи из матрицы)
        cur = by_task_id.get(tid)
        if cur is None or sum(bool(v) for v in row.values()) > sum(bool(v) for v in cur):
            by_task_id[tid] = row
    for i, (tid, row) in enumerate(by_task_id.items()):
        await _upsert_task(session, tid, row, order_index=i, workspace_id=workspace_id)
    counts["tasks"] = len(by_task_id)

    # Политика автодополнения (как в importer.py): задача, упомянутая в сметах/
    # зависимостях, но отсутствующая в списке задач, считается выполненной (Done).
    existing_ids = {
        r for r in (await session.execute(select(TaskORM.task_id).where(
            TaskORM.workspace_id == workspace_id))).scalars().all()
    }
    known = set(by_task_id) | existing_ids
    referenced = (
        {str(r.get("blocking_task_id") or "") for r in dependencies}
        | {str(r.get("blocked_task_id") or "") for r in dependencies}
    )
    for rr in role_reqs:
        if isinstance(rr.get("rows"), dict) and rr.get("role") and not str(rr["role"]).lower().startswith("итого"):
            referenced |= {str(t) for t in rr["rows"]}
        elif rr.get("task_id"):
            referenced.add(str(rr["task_id"]))
    orphans = sorted(t for t in referenced - known if t)
    for tid in orphans:
        await _upsert_task(session, tid, {"status": "Done",
                                          "summary": f"(задача {tid} отсутствует в списке; считается выполненной)"},
                           order_index=0, workspace_id=workspace_id)
    if orphans:
        counts["tasks_auto_done"] = len(orphans)
    valid_task_ids = known | set(orphans)

    seen_engineer: set[tuple[str, str, str]] = set()
    n_eng = 0
    for row in engineers:
        eid = str(row.get("engineer_id") or "").strip()
        if not eid:
            continue
        team = str(row.get("team_id") or "")
        role = str(row.get("role") or "")
        key = (eid, team, role)
        if key in seen_engineer:
            continue
        seen_engineer.add(key)
        existing = (await session.execute(select(EngineerORM).where(
            EngineerORM.workspace_id == workspace_id,
            EngineerORM.engineer_id == eid, EngineerORM.team_id == team, EngineerORM.role == role))).scalars().first()
        if existing and existing.source == "manual":
            continue
        if existing:
            existing.grade = str(row.get("grade") or existing.grade)
            existing.skills_declared = str(row.get("skills_declared") or existing.skills_declared)
            existing.capacity_rate = _f(row.get("capacity_rate"), existing.capacity_rate)
            existing.source = "imported"
        else:
            session.add(EngineerORM(
                workspace_id=workspace_id,
                engineer_id=eid, team_id=team, role=role,
                grade=str(row.get("grade") or ""),
                skills_declared=str(row.get("skills_declared") or ""),
                capacity_rate=_f(row.get("capacity_rate"), 1.0),
                source="imported",
            ))
        n_eng += 1
    counts["engineers"] = n_eng

    seen_dep: set[tuple[str, str]] = set()
    for row in dependencies:
        a = str(row.get("blocking_task_id") or "")
        b = str(row.get("blocked_task_id") or "")
        if not a or not b:
            continue
        key = (a, b)
        if key in seen_dep:
            continue
        seen_dep.add(key)
        existing = (await session.execute(select(DependencyORM).where(
            DependencyORM.workspace_id == workspace_id,
            DependencyORM.blocking_task_id == a, DependencyORM.blocked_task_id == b))).scalars().first()
        if existing:
            if existing.source == "manual":
                continue
            existing.dependency_type = str(row.get("dependency_type") or existing.dependency_type)
            existing.source = "imported"
        else:
            session.add(DependencyORM(
                workspace_id=workspace_id,
                blocking_task_id=a, blocked_task_id=b,
                dependency_type=str(row.get("dependency_type") or ""), source="imported",
            ))
    counts["dependencies"] = len(seen_dep)

    history_rows = 0
    seen_history: set[tuple[str, date]] = set()
    for row in history:
        team = str(row.get("team_id") or "")
        snapshot = _date_conv(row.get("snapshot_date"))
        if not team or not snapshot:
            continue
        if (team, snapshot) in seen_history:
            continue
        seen_history.add((team, snapshot))
        existing = (await session.execute(select(TeamHistoryORM).where(
            TeamHistoryORM.workspace_id == workspace_id,
            TeamHistoryORM.team_id == team, TeamHistoryORM.snapshot_date == snapshot))).scalars().first()
        if existing:
            if existing.source == "manual":
                continue
            existing.velocity_achieved = _f(row.get("velocity_achieved"))
            existing.planned_sp = _f(row.get("planned_sp"))
            existing.source = "imported"
        else:
            session.add(TeamHistoryORM(
                workspace_id=workspace_id,
                team_id=team,
                snapshot_date=snapshot,
                velocity_achieved=_f(row.get("velocity_achieved")),
                planned_sp=_f(row.get("planned_sp")),
            ))
        history_rows += 1
    counts["team_history"] = history_rows

    n_req = 0
    seen_role_req: set[tuple[str, str]] = set()
    for rr in role_reqs:
        if isinstance(rr.get("rows"), dict) and rr.get("role") and not str(rr["role"]).lower().startswith("итого"):
            for tid, hours in rr["rows"].items():
                hours_num = _f(str(hours or ""))
                key = (tid, str(rr["role"]))
                if hours_num <= 0 or not tid or tid not in valid_task_ids or key in seen_role_req:
                    continue
                seen_role_req.add(key)
                n_req += await _upsert_role_req(session, workspace_id, tid, str(rr["role"]), hours_num)
            continue
        if isinstance(rr.get("role_hours"), dict) and rr.get("task_id"):
            for role, hours in rr["role_hours"].items():
                hours_num = _f(str(hours or ""))
                key = (str(rr["task_id"]), role)
                if hours_num <= 0 or str(rr["task_id"]) not in valid_task_ids or key in seen_role_req:
                    continue
                seen_role_req.add(key)
                n_req += await _upsert_role_req(session, workspace_id, str(rr["task_id"]), role, hours_num)
        elif rr.get("role") is None and rr.get("task_id"):
            hours = _f(str(rr.get("hours") or ""))
            key = (str(rr["task_id"]), str(rr.get("role") or ""))
            if hours <= 0 or str(rr["task_id"]) not in valid_task_ids or key in seen_role_req:
                continue
            seen_role_req.add(key)
            n_req += await _upsert_role_req(session, workspace_id, str(rr["task_id"]), str(rr.get("role") or ""), hours)
    counts["role_requirements"] = n_req

    await session.commit()
    return counts
