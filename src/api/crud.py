"""CRUD-ручки онбординга: полный CRUD, поля опциональны (спека onboarding)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

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


class TeamIn(BaseModel):
    team_id: str
    name: str | None = None


@router.post("/engineers", status_code=201)
async def create_engineer(body: EngineerIn, session: AsyncSession = Depends(get_session)):
    eid = body.engineer_id
    if not eid:
        raise HTTPException(status_code=422, detail="engineer_id обязателен")
    existing = (await session.execute(select(EngineerORM).where(
        EngineerORM.engineer_id == eid, EngineerORM.team_id == body.team_id,
        EngineerORM.role == body.role))).scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail="инженер уже существует")
    eng = EngineerORM(
        engineer_id=eid,
        team_id=body.team_id or "",
        role=body.role or "",
        grade=body.grade or "",
        skills_declared=body.skills_declared or "",
        capacity_rate=body.capacity_rate if body.capacity_rate is not None else 1.0,
        source="manual",
    )
    session.add(eng)
    await session.commit()
    return {"status": "created", "engineer_id": eid, "source": "manual"}


@router.put("/engineers/{engineer_id}")
async def update_engineer(engineer_id: str, body: EngineerIn, session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(EngineerORM).where(EngineerORM.engineer_id == engineer_id))).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="не найден")
    for eng in rows:
        if eng.source == "manual":
            for field in ("team_id", "role", "grade", "skills_declared", "capacity_rate"):
                if getattr(body, field) is not None:
                    setattr(eng, field, getattr(body, field))
    await session.commit()
    return {"status": "updated", "engineer_id": engineer_id}


@router.delete("/engineers/{engineer_id}")
async def delete_engineer(engineer_id: str, session: AsyncSession = Depends(get_session)):
    await session.execute(delete(EngineerORM).where(EngineerORM.engineer_id == engineer_id))
    await session.commit()
    return {"status": "deleted"}


@router.post("/tasks", status_code=201)
async def create_task(body: TaskIn, session: AsyncSession = Depends(get_session)):
    existing = (await session.execute(select(TaskORM).where(TaskORM.task_id == body.task_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="задача уже существует")
    task = TaskORM(
        task_id=body.task_id,
        parent_id=None,
        team_id=body.team_id or "",
        summary=body.summary or "",
        status=body.status or "ToDo",
        estimation_sp=body.estimation_sp or 0.0,
        estimated_hh=body.estimated_hh or 0.0,
        source="manual",
    )
    session.add(task)
    await session.commit()
    return {"status": "created", "task_id": body.task_id}


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskIn, session: AsyncSession = Depends(get_session)):
    task = (await session.execute(select(TaskORM).where(TaskORM.task_id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="не найдена")
    for field in ("team_id", "summary", "status", "estimation_sp", "estimated_hh"):
        val = getattr(body, field)
        if val is not None:
            setattr(task, field, val)
    task.source = "manual"
    await session.commit()
    return {"status": "updated", "task_id": task_id}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, session: AsyncSession = Depends(get_session)):
    await session.execute(delete(TaskORM).where(TaskORM.task_id == task_id))
    await session.commit()
    return {"status": "deleted"}


@router.post("/dependencies", status_code=201)
async def create_dependency(body: DependencyIn, session: AsyncSession = Depends(get_session)):
    dep = DependencyORM(
        blocking_task_id=body.blocking_task_id,
        blocked_task_id=body.blocked_task_id,
        dependency_type=body.dependency_type or "depends on",
        source="manual",
    )
    session.add(dep)
    await session.commit()
    return {"status": "created"}


@router.post("/teams", status_code=201)
async def create_team(body: TeamIn, session: AsyncSession = Depends(get_session)):
    existing = (await session.execute(select(TeamORM).where(TeamORM.team_id == body.team_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="команда уже существует")
    session.add(TeamORM(team_id=body.team_id, name=body.name or "", source="manual"))
    await session.commit()
    return {"status": "created", "team_id": body.team_id}


@router.delete("/teams/{team_id}")
async def delete_team(team_id: str, session: AsyncSession = Depends(get_session)):
    await session.execute(delete(TeamORM).where(TeamORM.team_id == team_id))
    await session.commit()
    return {"status": "deleted"}
