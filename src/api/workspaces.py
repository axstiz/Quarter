from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import MembershipORM, UserORM, WorkspaceORM
from src.db.session import get_session

workspace_router = APIRouter(prefix="/workspaces", tags=["workspaces"])


async def get_current_user_optional(
    authorization: str | None = Header(None),
    session: AsyncSession = Depends(get_session),
) -> UserORM | None:
    try:
        from src.api.auth import get_current_user_optional as auth_get_user
        return await auth_get_user(authorization, session)
    except Exception:
        return None


class CreateWorkspaceRequest(BaseModel):
    name: str


class AddMemberRequest(BaseModel):
    user_id: str
    role: str = "editor"


async def get_current_workspace_id(
    x_workspace_id: str | None = Header(None, alias="X-Workspace-Id"),
) -> str:
    return x_workspace_id.strip() if x_workspace_id and x_workspace_id.strip() else "default"


@workspace_router.get("")
async def list_workspaces(
    user: UserORM | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    if not user:
        default_ws = (await session.execute(select(WorkspaceORM).where(WorkspaceORM.id == "default"))).scalar_one_or_none()
        if not default_ws:
            default_ws = WorkspaceORM(id="default", name="Default Workspace")
            session.add(default_ws)
            await session.commit()
        return [{"id": default_ws.id, "name": default_ws.name, "role": "admin"}]

    memberships = (await session.execute(select(MembershipORM).where(MembershipORM.user_id == user.id))).scalars().all()
    ws_ids = {m.workspace_id for m in memberships}
    ws_ids.add("default")

    workspaces = (await session.execute(select(WorkspaceORM).where(WorkspaceORM.id.in_(ws_ids)))).scalars().all()
    mem_map = {m.workspace_id: m.role for m in memberships}
    mem_map.setdefault("default", user.role)

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
    user: UserORM | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user_id = user.id if user else "system"
    ws = WorkspaceORM(name=body.name, created_by=user_id)
    session.add(ws)
    await session.flush()

    if user:
        session.add(MembershipORM(workspace_id=ws.id, user_id=user.id, role="admin"))

    await session.commit()
    return {"id": ws.id, "name": ws.name, "created_by": user_id}


@workspace_router.put("/{workspace_id}")
async def update_workspace(
    workspace_id: str,
    body: CreateWorkspaceRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    ws = (await session.execute(select(WorkspaceORM).where(WorkspaceORM.id == workspace_id))).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace не найден")

    ws.name = body.name
    await session.commit()
    return {"id": ws.id, "name": ws.name}


@workspace_router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    if workspace_id == "default":
        raise HTTPException(status_code=400, detail="Нельзя удалить default workspace")

    ws = (await session.execute(select(WorkspaceORM).where(WorkspaceORM.id == workspace_id))).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace не найден")

    await session.delete(ws)
    await session.commit()
    return {"status": "deleted", "id": workspace_id}


@workspace_router.get("/{workspace_id}/members")
async def list_members(
    workspace_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    memberships = (await session.execute(select(MembershipORM).where(MembershipORM.workspace_id == workspace_id))).scalars().all()
    return [{"user_id": m.user_id, "role": m.role} for m in memberships]


@workspace_router.post("/{workspace_id}/members", status_code=201)
async def add_member(
    workspace_id: str,
    body: AddMemberRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    role = body.role if body.role in ("admin", "editor", "reader") else "editor"
    m = MembershipORM(workspace_id=workspace_id, user_id=body.user_id, role=role)
    session.add(m)
    await session.commit()
    return {"workspace_id": workspace_id, "user_id": body.user_id, "role": role}


@workspace_router.delete("/{workspace_id}/members/{user_id}")
async def remove_member(
    workspace_id: str,
    user_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    m = (await session.execute(select(MembershipORM).where(
        MembershipORM.workspace_id == workspace_id,
        MembershipORM.user_id == user_id,
    ))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Участник не найден")
    await session.delete(m)
    await session.commit()
    return {"status": "removed", "user_id": user_id}
