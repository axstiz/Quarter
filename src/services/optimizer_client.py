"""HTTP-клиент к сайдкару optimizer (change 018, задачи 2.2/2.3).

Снапшот домена и ответ `/solve` повторяют контракт Mock-контракта
tests/test_optimizer_sidecar.py (OPTIMIZER_SNAPSHOT) и Java-классов
optimizer/.../SolveRequest.java / SolveResponse.java.
Деградация: транспортная ошибка/таймаут/не 200 → SolverUnavailable,
бэкенд переходит на жадную метрическую стратегию (режим «эвристика»).
"""
from __future__ import annotations

import logging

import httpx

from src.core.config import settings
from src.domain.models import CAPACITY_FACTOR, SPRINTS_PER_QUARTER, Engineer, Task, TeamHistory
from src.services.bus_factor import compute_bus_factor
from src.services.capacity import team_capacity_sp
from src.services.planner import _rl, engineer_sprint_limit

logger = logging.getLogger(__name__)


class SolverUnavailable(Exception):
    """Сайдкар недоступен/не отвечает по таймауту — сигнал к эвристике."""


def _effective(task: Task, spent: float) -> tuple[float, float]:
    if task.status == "InProgress":
        est = task.estimated_hh or 0.0
        remaining = max(est - spent, 0.0)
        share = remaining / est if est else 1.0
        return round(task.estimation_sp * share, 2), share
    return task.estimation_sp, 1.0


def _sole_holders(engineers: list[Engineer]) -> set[str]:
    """Инженеры — единственные носители своей (нормализованной) роли в команде."""
    counts: dict[tuple[str, str], set[str]] = {}
    for e in engineers:
        counts.setdefault((e.team_id, _rl(e.role)), set()).add(e.engineer_id)
    return {next(iter(ids)) for ids in counts.values() if len(ids) == 1}


def build_snapshot(
    tasks: dict[str, Task],
    engineers: list[Engineer],
    history: list[TeamHistory],
    deps: list[tuple[str, str]],
) -> dict:
    """Снапшот домена для POST /solve (контракт tests/test_optimizer_sidecar.py)."""
    sole = _sole_holders(engineers)
    by_team_hist: dict[str, list[TeamHistory]] = {}
    for h in history:
        by_team_hist.setdefault(h.team_id, []).append(h)

    task_entries = []
    for tid, task in tasks.items():
        if task.status == "Done":
            continue
        eff_sp, share = _effective(task, task.spent_time)
        role_hours = {
            _rl(role): _rl_role_hours(task, role, share)
            for role, hours in (task.role_hours or {}).items()
        }
        task_entries.append({
            "task_id": tid,
            "parent_id": task.parent_id or "",  # null запрещён Java-контрактом (400 invalid snapshot)
            "status": task.status,
            "team_id": task.team_id,
            "story_points": eff_sp if eff_sp > 0 else task.estimation_sp,
            "estimated_hh": task.estimated_hh or 0.0,
            "spent_time": task.spent_time or 0.0,
            "priority": int(task.priority or 100),
            "planned_in_sprint": bool(getattr(task, "planned_in_sprint", False))
                or int(task.priority or 100) <= 10,
            "parts": [{"part": 1, "story_points": eff_sp if eff_sp > 0 else task.estimation_sp,
                       "role_hours": role_hours}],
        })

    task_ids = {t["task_id"] for t in task_entries}
    dep_entries = [
        {"blocking_task_id": a, "blocked_task_id": b}
        for a, b in deps if a in task_ids and b in task_ids
    ]
    eng_entries = [
        {
            "engineer_id": e.engineer_id,
            "team_id": e.team_id,
            "role": _rl(e.role),
            "capacity_rate": e.capacity_rate or 1.0,
            "sole_holder_in_team": e.engineer_id in sole,
        }
        for e in engineers
    ]
    team_vel = []
    for team in sorted({e["team_id"] for e in eng_entries} | {t["team_id"] for t in task_entries}):
        capacity = team_capacity_sp(by_team_hist.get(team, []))
        team_vel.append({"team_id": team, "velocity": round(capacity / CAPACITY_FACTOR, 2) if capacity else 0.0})

    return {
        "sprints": list(range(1, SPRINTS_PER_QUARTER + 1)),
        "team_velocities": team_vel,
        "tasks": task_entries,
        "dependencies": dep_entries,
        "engineers": eng_entries,
    }


def _rl_role_hours(task: Task, role: str, share: float) -> float:
    full = float((task.role_hours or {}).get(role, 0.0) or 0.0)
    if task.status == "InProgress" and (task.estimated_hh or 0.0) > 0:
        return round(full * share, 2)
    return full


async def solve_sidecar(snapshot: dict) -> dict:
    """POST {base}/solve; при недоступности/не 200 → SolverUnavailable (эвристика)."""
    base = settings.optimizer_base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=settings.optimizer_solve_timeout_sec) as client:
            r = await client.post(f"{base}/solve", json=snapshot)
        if r.status_code != 200:
            logger.warning("optimizer /solve вернул %s: %s", r.status_code, r.text[:200])
            raise SolverUnavailable(f"solve HTTP {r.status_code}")
        return r.json()
    except httpx.HTTPError as e:
        logger.warning("optimizer недоступен (%s): переход на эвристику", e)
        raise SolverUnavailable(str(e)) from e


def role_hours_available(engineers: list[Engineer]) -> dict[str, float]:
    """Доступные часы за спринт по нормализованным ролям (0.5 → 40 ч, 1.0 → 80 ч)."""
    out: dict[str, float] = {}
    for e in engineers:
        out[_rl(e.role)] = out.get(_rl(e.role), 0.0) + engineer_sprint_limit(e.capacity_rate)
    return {k: round(v, 1) for k, v in out.items()}