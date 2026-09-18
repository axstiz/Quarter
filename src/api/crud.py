"""CRUD-ручки онбординга: полный CRUD, поля опциональны (спека onboarding)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.context import Context, require_context
from src.api.permissions import require_permission
from src.db.models import DependencyORM, EngineerORM, TaskORM, TeamHistoryORM, TeamORM
from src.db.session import get_session

router = APIRouter(prefix="/api/v1", tags=["onboarding-crud"])


class EngineerIn(BaseModel):
    engineer_id: str | None = None
    team_id: str | None = None
    role: str | None = None
    grade: str | None = None
    skills_declared: str | None = None
    capacity_rate: float | None = None


class TaskIn(BaseModel):
    task_id: str
    team_id: str | None = None
    summary: str | None = None
    status: str | None = None
    estimation_sp: float | None = None
    estimated_hh: float | None = None
    planned_result: str | None = None


class DependencyIn(BaseModel):
    blocking_task_id: str
    blocked_task_id: str
    dependency_type: str | None = None


class DependencyTypeIn(BaseModel):
    dependency_type: str | None = None


class TeamIn(BaseModel):
    team_id: str | None = None
    name: str | None = None


@router.post("/engineers", status_code=201)
async def create_engineer(body: EngineerIn, ctx: Context = Depends(require_permission("crud_engineers"))):
    eid = body.engineer_id
    if not eid:
        raise HTTPException(status_code=422, detail="engineer_id обязателен")
    existing = (await ctx.session.execute(select(EngineerORM).where(
        EngineerORM.workspace_id == ctx.workspace_id,
        EngineerORM.engineer_id == eid, EngineerORM.team_id == body.team_id,
        EngineerORM.role == body.role))).scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail="инженер уже существует")
    eng = EngineerORM(
        workspace_id=ctx.workspace_id,
        engineer_id=eid,
        team_id=body.team_id or "",
        role=body.role or "",
        grade=body.grade or "",
        skills_declared=body.skills_declared or "",
        capacity_rate=body.capacity_rate if body.capacity_rate is not None else 1.0,
        source="manual",
    )
    ctx.session.add(eng)
    await ctx.session.commit()
    return {"status": "created", "engineer_id": eid, "source": "manual"}


@router.put("/engineers/{engineer_id}")
async def update_engineer(engineer_id: str, body: EngineerIn, ctx: Context = Depends(require_permission("crud_engineers"))):
    rows = (await ctx.session.execute(select(EngineerORM).where(
        EngineerORM.engineer_id == engineer_id, EngineerORM.workspace_id == ctx.workspace_id))).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="не найден")
    for eng in rows:
        if eng.source == "manual":
            for field in ("team_id", "role", "grade", "skills_declared", "capacity_rate"):
                if getattr(body, field) is not None:
                    setattr(eng, field, getattr(body, field))
    await ctx.session.commit()
    return {"status": "updated", "engineer_id": engineer_id}


@router.delete("/engineers/{engineer_id}")
async def delete_engineer(engineer_id: str, ctx: Context = Depends(require_permission("crud_engineers"))):
    await ctx.session.execute(delete(EngineerORM).where(
        EngineerORM.engineer_id == engineer_id, EngineerORM.workspace_id == ctx.workspace_id))
    await ctx.session.commit()
    return {"status": "deleted"}


@router.post("/tasks", status_code=201)
async def create_task(body: TaskIn, ctx: Context = Depends(require_permission("crud_tasks"))):
    existing = (await ctx.session.execute(select(TaskORM).where(
        TaskORM.task_id == body.task_id, TaskORM.workspace_id == ctx.workspace_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="задача уже существует")
    task = TaskORM(
        workspace_id=ctx.workspace_id,
        task_id=body.task_id,
        parent_id=None,
        team_id=body.team_id or "",
        summary=body.summary or "",
        status=body.status or "ToDo",
        estimation_sp=body.estimation_sp or 0.0,
        estimated_hh=body.estimated_hh or 0.0,
        source="manual",
    )
    ctx.session.add(task)
    await ctx.session.commit()
    return {"status": "created", "task_id": body.task_id}


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskIn, ctx: Context = Depends(require_permission("crud_tasks"))):
    task = (await ctx.session.execute(select(TaskORM).where(
        TaskORM.task_id == task_id, TaskORM.workspace_id == ctx.workspace_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="не найдена")
    for field in ("team_id", "summary", "status", "estimation_sp", "estimated_hh"):
        val = getattr(body, field)
        if val is not None:
            setattr(task, field, val)
    task.source = "manual"
    await ctx.session.commit()
    return {"status": "updated", "task_id": task_id}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, ctx: Context = Depends(require_permission("crud_tasks"))):
    await ctx.session.execute(delete(TaskORM).where(
        TaskORM.task_id == task_id, TaskORM.workspace_id == ctx.workspace_id))
    await ctx.session.commit()
    return {"status": "deleted"}


@router.post("/dependencies", status_code=201)
async def create_dependency(body: DependencyIn, ctx: Context = Depends(require_permission("crud_tasks"))):
    dep = DependencyORM(
        workspace_id=ctx.workspace_id,
        blocking_task_id=body.blocking_task_id,
        blocked_task_id=body.blocked_task_id,
        dependency_type=body.dependency_type or "depends on",
        source="manual",
    )
    ctx.session.add(dep)
    await ctx.session.commit()
    return {"status": "created"}


@router.post("/teams", status_code=201)
async def create_team(body: TeamIn, ctx: Context = Depends(require_permission("crud_engineers"))):
    if not body.team_id:
        raise HTTPException(status_code=422, detail="team_id обязателен")
    existing = (await ctx.session.execute(select(TeamORM).where(
        TeamORM.team_id == body.team_id, TeamORM.workspace_id == ctx.workspace_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="команда уже существует")
    ctx.session.add(TeamORM(workspace_id=ctx.workspace_id, team_id=body.team_id, name=body.name or "", source="manual"))
    await ctx.session.commit()
    return {"status": "created", "team_id": body.team_id}


@router.put("/teams/{team_id}")
async def update_team(team_id: str, body: TeamIn, ctx: Context = Depends(require_permission("crud_engineers"))):
    team = (await ctx.session.execute(select(TeamORM).where(
        TeamORM.team_id == team_id, TeamORM.workspace_id == ctx.workspace_id))).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="команда не найдена")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name обязателен для переименования")
    team.name = name
    team.source = "manual"
    await ctx.session.commit()
    return {"status": "updated", "team_id": team_id, "name": name, "source": "manual"}


@router.delete("/teams/{team_id}")
async def delete_team(team_id: str, ctx: Context = Depends(require_permission("crud_engineers"))):
    await ctx.session.execute(delete(TeamORM).where(
        TeamORM.team_id == team_id, TeamORM.workspace_id == ctx.workspace_id))
    await ctx.session.commit()
    return {"status": "deleted"}


@router.put("/dependencies")
async def update_dependency(blocking_task_id: str, blocked_task_id: str,
                            body: DependencyTypeIn,
                            ctx: Context = Depends(require_permission("crud_tasks"))):
    """Правка типа зависимости по паре задач (решение лида: идентификация по паре,
    не по суррогатному uid). Правка делает запись ручной (source=manual)."""
    dep = (await ctx.session.execute(select(DependencyORM).where(
        DependencyORM.workspace_id == ctx.workspace_id,
        DependencyORM.blocking_task_id == blocking_task_id,
        DependencyORM.blocked_task_id == blocked_task_id))).scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail="зависимость не найдена")
    if body.dependency_type:
        dep.dependency_type = body.dependency_type
    dep.source = "manual"
    await ctx.session.commit()
    return {"status": "updated", "blocking_task_id": blocking_task_id,
            "blocked_task_id": blocked_task_id, "dependency_type": dep.dependency_type}


@router.delete("/dependencies")
async def delete_dependency(blocking_task_id: str, blocked_task_id: str,
                            ctx: Context = Depends(require_permission("crud_tasks"))):
    dep = (await ctx.session.execute(select(DependencyORM).where(
        DependencyORM.workspace_id == ctx.workspace_id,
        DependencyORM.blocking_task_id == blocking_task_id,
        DependencyORM.blocked_task_id == blocked_task_id))).scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail="зависимость не найдена")
    await ctx.session.execute(delete(DependencyORM).where(
        DependencyORM.workspace_id == ctx.workspace_id,
        DependencyORM.blocking_task_id == blocking_task_id,
        DependencyORM.blocked_task_id == blocked_task_id))
    await ctx.session.commit()
    return {"status": "deleted", "blocking_task_id": blocking_task_id, "blocked_task_id": blocked_task_id}
