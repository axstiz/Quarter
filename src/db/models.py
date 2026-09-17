from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _uid() -> str:
    return uuid.uuid4().hex


class WorkspaceORM(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    name: Mapped[str] = mapped_column(String)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(), server_default=func.now())


class MembershipORM(Base):
    __tablename__ = "memberships"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    workspace_id: Mapped[str] = mapped_column(String, index=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String, default="editor")  # admin, editor, reader
    created_at: Mapped[DateTime] = mapped_column(DateTime(), server_default=func.now())
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_user"),)


class TaskORM(Base):
    __tablename__ = "tasks"
    task_id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    source: Mapped[str] = mapped_column(String, default="imported")
    priority: Mapped[int] = mapped_column(Integer, default=100)
    parent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    team_id: Mapped[str] = mapped_column(String, index=True)
    summary: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="ToDo")
    estimation_sp: Mapped[float] = mapped_column(Float, default=0.0)
    estimated_hh: Mapped[float] = mapped_column(Float, default=0.0)
    spent_time: Mapped[float] = mapped_column(Float, default=0.0)
    planned_in_sprint: Mapped[bool] = mapped_column(Boolean, default=False)


class RoleRequirementORM(Base):
    __tablename__ = "task_role_requirements"
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    source: Mapped[str] = mapped_column(String, default="imported")
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    task_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String)
    hours: Mapped[float] = mapped_column(Float)


class DependencyORM(Base):
    __tablename__ = "task_dependencies"
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    source: Mapped[str] = mapped_column(String, default="imported")
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    blocking_task_id: Mapped[str] = mapped_column(String, index=True)
    blocked_task_id: Mapped[str] = mapped_column(String, index=True)
    dependency_type: Mapped[str] = mapped_column(String)


class EngineerORM(Base):
    __tablename__ = "engineers_profiles"
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    source: Mapped[str] = mapped_column(String, default="imported")
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    engineer_id: Mapped[str] = mapped_column(String, index=True)
    team_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String)
    grade: Mapped[str] = mapped_column(String, default="")
    skills_declared: Mapped[str] = mapped_column(String, default="")
    capacity_rate: Mapped[float] = mapped_column(Float, default=1.0)


class TeamHistoryORM(Base):
    __tablename__ = "team_history"
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    source: Mapped[str] = mapped_column(String, default="imported")
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    snapshot_date: Mapped[date] = mapped_column(Date)
    team_id: Mapped[str] = mapped_column(String, index=True)
    velocity_achieved: Mapped[float] = mapped_column(Float)
    planned_sp: Mapped[float] = mapped_column(Float)


class TeamORM(Base):
    __tablename__ = "teams"
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    team_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, default="")
    source: Mapped[str] = mapped_column(String, default="manual")


class PlanORM(Base):
    __tablename__ = "plans"
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    plan_id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    created_at: Mapped[DateTime] = mapped_column(DateTime(), server_default=func.now())
    is_initial: Mapped[bool] = mapped_column(Boolean, default=True)
    recomputed_after_sprint: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_plan_id: Mapped[str | None] = mapped_column(String, nullable=True)


class PlanItemORM(Base):
    __tablename__ = "plan_items"
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.plan_id"), index=True)
    task_id: Mapped[str] = mapped_column(String, index=True)
    team_id: Mapped[str] = mapped_column(String, default="")
    decision: Mapped[str] = mapped_column(String)  # planned|postponed|cancelled|done_actual
    sprint_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str] = mapped_column(String, default="")
    planned_sp: Mapped[float | None] = mapped_column(Float, nullable=True)


class SprintFactORM(Base):
    __tablename__ = "sprint_facts"
    workspace_id: Mapped[str] = mapped_column(String, default="default", index=True)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.plan_id"), index=True)
    sprint_no: Mapped[int] = mapped_column(Integer)
    completed_sp: Mapped[float] = mapped_column(Float)
    completed_task_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    notes: Mapped[str] = mapped_column(String, default="")
    __table_args__ = (UniqueConstraint("plan_id", "sprint_no", name="uq_fact_per_sprint"),)


class UserORM(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="editor")
    created_at: Mapped[DateTime] = mapped_column(DateTime(), server_default=func.now())

