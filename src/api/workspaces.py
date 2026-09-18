from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.context import Context, require_context, require_permission_ws
from src.db.models import MembershipORM, UserORM, WorkspaceORM
from src.db.session import get_session

workspace_router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class CreateWorkspaceRequest(BaseModel):
    name: str


class AddMemberRequest(BaseModel):
    user_id: str
    role: str = "editor"


@workspace_router.get("")
async def list_workspaces(ctx: Context = Depends(require_context)) -> list[dict]:
    default_ws = (await ctx.session.execute(select(WorkspaceORM).where(WorkspaceORM.id == "default"))).scalar_one_or_none()
    if not default_ws:
        default_ws = WorkspaceORM(id="default", name="Default Workspace")
        ctx.session.add(default_ws)
        await ctx.session.commit()

    memberships = (await ctx.session.execute(select(MembershipORM).where(MembershipORM.user_id == ctx.user.id))).scalars().all()
    ws_ids = {m.workspace_id for m in memberships}
    ws_ids.add("default")

    workspaces = (await ctx.session.execute(select(WorkspaceORM).where(WorkspaceORM.id.in_(ws_ids)))).scalars().all()
    mem_map = {m.workspace_id: m.role for m in memberships}
    mem_map.setdefault("default", ctx.user.role)

    out = []
    for ws in workspaces:
        out.append({
            "id": ws.id,
            "name": ws.name,
            "created_by": ws.created_by,
            "role": mem_map.get(ws.id, "reader"),
        })
    return out


@workspace_router.post("", status_code=201)
async def create_workspace(
    body: CreateWorkspaceRequest,
    ctx: Context = Depends(require_context),
) -> dict:
    ws = WorkspaceORM(name=body.name, created_by=ctx.user.id)
    ctx.session.add(ws)
    await ctx.session.flush()
    ctx.session.add(MembershipORM(workspace_id=ws.id, user_id=ctx.user.id, role="admin"))
    await ctx.session.commit()
    return {"id": ws.id, "name": ws.name, "created_by": ctx.user.id}


@workspace_router.put("/{workspace_id}")
async def update_workspace(
    workspace_id: str,
    body: CreateWorkspaceRequest,
    ctx: Context = Depends(require_permission_ws("workspace_admin")),
) -> dict:
    ws = (await ctx.session.execute(select(WorkspaceORM).where(WorkspaceORM.id == workspace_id))).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace не найден")

    ws.name = body.name
    await ctx.session.commit()
    return {"id": ws.id, "name": ws.name}


@workspace_router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: str,
    confirm: bool = False,
    ctx: Context = Depends(require_permission_ws("workspace_admin")),
) -> dict:
    if workspace_id == "default":
        raise HTTPException(status_code=400, detail="Нельзя удалить default workspace")
    if not confirm:
        raise HTTPException(status_code=409, detail="Подтвердите удаление (?confirm=true)")

    ws = (await ctx.session.execute(select(WorkspaceORM).where(WorkspaceORM.id == workspace_id))).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace не найден")

    await ctx.session.delete(ws)
    await ctx.session.commit()
    return {"status": "deleted", "id": workspace_id}


@workspace_router.get("/{workspace_id}/members")
async def list_members(
    workspace_id: str,
    ctx: Context = Depends(require_context),
) -> list[dict]:
    memberships = (await ctx.session.execute(select(MembershipORM).where(MembershipORM.workspace_id == workspace_id))).scalars().all()
    return [{"user_id": m.user_id, "role": m.role} for m in memberships]


@workspace_router.post("/{workspace_id}/members", status_code=201)
async def add_member(
    workspace_id: str,
    body: AddMemberRequest,
    ctx: Context = Depends(require_permission_ws("members_admin")),
) -> dict:
    role = body.role if body.role in ("admin", "editor", "reader") else "editor"
    m = MembershipORM(workspace_id=workspace_id, user_id=body.user_id, role=role)
    ctx.session.add(m)
    await ctx.session.commit()
    return {"workspace_id": workspace_id, "user_id": body.user_id, "role": role}


@workspace_router.delete("/{workspace_id}/members/{user_id}")
async def remove_member(
    workspace_id: str,
    user_id: str,
    ctx: Context = Depends(require_permission_ws("members_admin")),
) -> dict:
    m = (await ctx.session.execute(select(MembershipORM).where(
        MembershipORM.workspace_id == workspace_id,
        MembershipORM.user_id == user_id,
    ))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Участник не найден")
    await ctx.session.delete(m)
    await ctx.session.commit()
    return {"status": "removed", "user_id": user_id}
