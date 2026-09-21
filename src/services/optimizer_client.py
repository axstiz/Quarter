"""HTTP-клиент к сайдкару optimizer (change 018, задачи 2.2/2.3).

Снапшот домена и ответ `/solve` повторяют контракт Mock-контракта
tests/test_optimizer_sidecar.py (OPTIMIZER_SNAPSHOT) и Java-классов
optimizer/.../SolveRequest.java / SolveResponse.java.
Деградация: транспортная ошибка/таймаут/не 200 → SolverUnavailable,
бэкенд переходит на жадную метрическую стратегию (режим «эвристика»).

Change 022: pre-split частей в снапшоте — задача режется на k частей
по ёмкости спринта (80 ч), SP и роль-часы пропорциональны доле части;
Java PartInput поддерживает список частей без изменений (part — int,
partId собирается в solver'е как taskId#part).
"""
from __future__ import annotations

import logging
import math

import httpx

from src.core.config import settings
from src.domain.models import CAPACITY_FACTOR, SPRINTS_PER_QUARTER, Engineer, Task, TeamHistory
from src.services.bus_factor import compute_bus_factor
from src.services.capacity import team_capacity_sp
from src.services.planner import _rl, engineer_sprint_limit

logger = logging.getLogger(__name__)

HOURS_PER_SPRINT_FULL = 80.0


class SolverUnavailable(Exception):
    """Сайдкар недоступен/не отвечает по таймауту — сигнал к эвристике."""


def _effective(task: Task, spent: float) -> tuple[float, float]:
    if task.status == "InProgress":
        est = task.estimated_hh or 0.0
        remaining = max(est - spent, 0.0)
        share = remaining / est if est else 1.0
        return round(task.estimation_sp * share, 2), share
    return task.estimation_sp, 1.0


def _split_parts(
    eff_sp: float,
    role_hours: dict[str, float],
    hh_total: float,
) -> list[dict]:
    """022 §1.1: части по ёмкости спринта — k = min(6, ⌈total_hh ÷ 80⌉).

    Части режутся по часам (80/80/30 для 190 ч), SP и роль-часы —
    пропорционально доле части в объёме. part — int 1..k (Java-контракт).
    """
    hh_total = round(hh_total or 0.0, 2)
    if hh_total <= 0:
        k = 1
    else:
        k = min(6, max(1, math.ceil(hh_total / HOURS_PER_SPRINT_FULL)))
    bounds: list[float] = []
    remaining = hh_total
    while len(bounds) < k:
        piece = min(remaining, HOURS_PER_SPRINT_FULL) if remaining > 0 else 0.0
        bounds.append(round(piece, 2))
        remaining = round(remaining - piece, 2)
    total = round(sum(bounds), 2)
    parts = []
    for i, piece in enumerate(bounds, start=1):
        share = (piece / total) if total > 0 else 1.0 / k
        parts.append({
            "part": i,
            "story_points": round(eff_sp * share, 2),
            "role_hours": {r: round(h * share, 2) for r, h in role_hours.items()},
        })
    return parts


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
        # объём для нарезки: остаток InProgress, иначе оценка; без оценки — сумма роль-часов
        if task.status == "InProgress" and (task.estimated_hh or 0.0) > 0:
            hh_total = max(task.estimated_hh - (task.spent_time or 0.0), 0.0)
        elif (task.estimated_hh or 0.0) > 0:
            hh_total = task.estimated_hh
        else:
            hh_total = sum(role_hours.values())
        sp_value = eff_sp if eff_sp > 0 else task.estimation_sp
        task_entries.append({
            "task_id": tid,
            "parent_id": task.parent_id or "",  # null запрещён Java-контрактом (400 invalid snapshot)
            "status": task.status,
            "team_id": task.team_id,
            "story_points": sp_value,
            "estimated_hh": task.estimated_hh or 0.0,
            "spent_time": task.spent_time or 0.0,
            "priority": int(task.priority or 100),
            "planned_in_sprint": bool(getattr(task, "planned_in_sprint", False))
                or int(task.priority or 100) <= 10,
            "parts": _split_parts(sp_value, role_hours, hh_total),
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