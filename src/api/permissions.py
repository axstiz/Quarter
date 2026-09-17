from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import AuditLogORM, RoleOverrideORM, UserOverrideORM
from src.db.session import get_session

permissions_router = APIRouter(prefix="/permissions", tags=["permissions"])

DEFAULT_MATRIX: dict[str, set[str]] = {
    "import_data": {"admin", "editor"},
    "crud_tasks": {"admin", "editor"},
    "crud_engineers": {"admin", "editor"},
    "edit_priority": {"admin", "editor"},
    "cancel_request": {"admin", "editor"},
    "confirm_cancel": {"admin"},
    "sprint_facts": {"admin", "editor"},
    "recompute": {"admin", "editor"},
    "plans_generate": {"admin", "editor"},
    "workspace_admin": {"admin"},
    "members_admin": {"admin"},
}


class UpdatePermissionRequest(BaseModel):
    permission: str
    enabled: bool


async def check_permission(
    permission: str,
    role: str = "editor",
    user_id: str | None = None,
    workspace_id: str = "default",
    session: AsyncSession | None = None,
) -> bool:
    if role == "admin":
        return True

    if session and user_id:
        user_ov = (await session.execute(select(UserOverrideORM).where(
            UserOverrideORM.workspace_id == workspace_id,
            UserOverrideORM.user_id == user_id,
            UserOverrideORM.permission == permission,
        ))).scalar_one_or_none()
        if user_ov is not None:
            return user_ov.enabled

    if session:
        role_ov = (await session.execute(select(RoleOverrideORM).where(
            RoleOverrideORM.workspace_id == workspace_id,
            RoleOverrideORM.role == role,
            RoleOverrideORM.permission == permission,
        ))).scalar_one_or_none()
        if role_ov is not None:
            return role_ov.enabled

    default_roles = DEFAULT_MATRIX.get(permission, {"admin"})
    return role in default_roles


def require_permission(permission: str) -> Callable:
    async def dependency(
        x_role: str = Header("editor", alias="X-User-Role"),
        x_user_id: str | None = Header(None, alias="X-User-Id"),
        x_workspace_id: str = Header("default", alias="X-Workspace-Id"),
        session: AsyncSession = Depends(get_session),
    ):
        allowed = await check_permission(
            permission=permission,
            role=x_role.lower(),
            user_id=x_user_id,
            workspace_id=x_workspace_id,
            session=session,
        )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Отказано в доступе: требуется разрешение '{permission}'",
            )
        return True

    return dependency


@permissions_router.get("/matrix")
async def get_matrix(
    workspace_id: str = Header("default", alias="X-Workspace-Id"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    role_ovs = (await session.execute(select(RoleOverrideORM).where(
        RoleOverrideORM.workspace_id == workspace_id
    ))).scalars().all()

    ov_map = {(r.role, r.permission): r.enabled for r in role_ovs}
    roles = ["admin", "editor", "reader"]
    matrix = {}

    for perm, default_allowed in DEFAULT_MATRIX.items():
        matrix[perm] = {}
        for r in roles:
            if r == "admin":
                matrix[perm][r] = True
            elif (r, perm) in ov_map:
                matrix[perm][r] = ov_map[(r, perm)]
            else:
                matrix[perm][r] = r in default_allowed

    return {"workspace_id": workspace_id, "matrix": matrix}


@permissions_router.patch("/roles/{role}")
async def update_role_permission(
    role: str,
    body: UpdatePermissionRequest,
    actor_id: str = Header("system", alias="X-User-Id"),
    workspace_id: str = Header("default", alias="X-Workspace-Id"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if role.lower() == "admin":
        raise HTTPException(status_code=400, detail="Права администратора неотчуждаемы")

    if body.permission not in DEFAULT_MATRIX:
        raise HTTPException(status_code=422, detail=f"Неизвестное разрешение: {body.permission}")

    ov = (await session.execute(select(RoleOverrideORM).where(
        RoleOverrideORM.workspace_id == workspace_id,
        RoleOverrideORM.role == role.lower(),
        RoleOverrideORM.permission == body.permission,
    ))).scalar_one_or_none()

    if not ov:
        ov = RoleOverrideORM(
            workspace_id=workspace_id,
            role=role.lower(),
            permission=body.permission,
            enabled=body.enabled,
        )
        session.add(ov)
    else:
        ov.enabled = body.enabled

    audit = AuditLogORM(
        workspace_id=workspace_id,
        actor_id=actor_id,
        action="update_permission",
        target=f"role:{role}:{body.permission}",
        details={"enabled": body.enabled},
    )
    session.add(audit)
    await session.commit()

    return {"workspace_id": workspace_id, "role": role, "permission": body.permission, "enabled": body.enabled}


@permissions_router.get("/audit")
async def get_audit_logs(
    workspace_id: str = Header("default", alias="X-Workspace-Id"),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    logs = (await session.execute(select(AuditLogORM).where(
        AuditLogORM.workspace_id == workspace_id
    ).order_by(AuditLogORM.created_at.desc()))).scalars().all()

    return [{
        "id": l.id,
        "actor_id": l.actor_id,
        "action": l.action,
        "target": l.target,
        "details": l.details,
        "created_at": str(l.created_at),
    } for l in logs]
