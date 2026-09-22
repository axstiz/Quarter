"""Единый контекст доступа для всех ручек /api/v1 (changes 005/008/009).

Заменяет три разрозненных механизма защиты одним:
- аутентификация по JWT (get_current_user из auth.py), 401 без сессии;
- workspace из заголовка X-Workspace-Id (по умолчанию "default");
- роль вычисляется серверно из MembershipORM (заголовки X-User-* игнорируются).
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.auth import get_current_user
from src.db.models import MembershipORM, UserORM
from src.db.session import get_session


@dataclass
class Context:
    user: UserORM
    workspace_id: str
    role: str  # admin | editor | reader (из membership/workspace, не из заголовка)
    session: AsyncSession


def _membership_role(memberships, workspace_id: str) -> str | None:
    for m in memberships:
        if m.workspace_id == workspace_id:
            return m.role
    return None


async def require_context(
    user: UserORM = Depends(get_current_user),
    x_workspace_id: str | None = Header(None, alias="X-Workspace-Id"),
    session: AsyncSession = Depends(get_session),
) -> Context:
    """Аутентификация + авторизация по workspace.

    - нет сессии → 401 (get_current_user);
    - workspace не указан или X-Workspace-Id=default → default workspace,
      роль = роль пользователя (демо-совместимость);
    - пользовательский workspace: только участники; не-участник получает 403
      без раскрытия содержимого (ui-pages: чужой workspace «не существует»).
    """
    ws_id = x_workspace_id.strip() if x_workspace_id and x_workspace_id.strip() else "default"

    if ws_id == "default":
        return Context(user=user, workspace_id=ws_id, role=user.role, session=session)

    role = _membership_role(
        (await session.execute(select(MembershipORM).where(
            MembershipORM.workspace_id == ws_id, MembershipORM.user_id == user.id
        ))).scalars().all(),
        ws_id,
    )
    if role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к этому workspace")
    return Context(user=user, workspace_id=ws_id, role=role, session=session)


def require_permission_ws(permission: str):
    """Для ручек, где workspace задаётся путём (/{workspace_id}/...): роль
    проверяется по membership именно этого workspace — роль из заголовка
    X-Workspace-Id не позволяет управлять чужим workspace."""
    async def dependency(workspace_id: str, ctx: Context = Depends(require_context)) -> Context:
        from src.api.permissions import check_permission  # ленивый импорт против цикла

        if workspace_id == "default":
            role = ctx.user.role
        else:
            role = _membership_role(
                (await ctx.session.execute(select(MembershipORM).where(
                    MembershipORM.workspace_id == workspace_id, MembershipORM.user_id == ctx.user.id
                ))).scalars().all(),
                workspace_id,
            )
        if role is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к этому workspace")
        if not await check_permission(permission, role=role, user_id=ctx.user.id,
                                      workspace_id=workspace_id, session=ctx.session):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Требуется разрешение '{permission}'")
        ctx.role = role
        ctx.workspace_id = workspace_id
        return ctx

    return dependency
