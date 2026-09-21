"""HTTP-клиент к сайдкару optimizer (change 018, задачи 2.2/2.3).

Снапшот домена и ответ `/solve` повторяют контракт Mock-контракта
tests/test_optimizer_sidecar.py (OPTIMIZER_SNAPSHOT) и Java-классов
optimizer/.../SolveRequest.java / SolveResponse.java.
Деградация: транспортная ошибка/таймаут/не 200 → SolverUnavailable,
бэкенд переходит на жадную метрическую стратегию (режим «эвристика»).
"""
from __future__ import annotations

import logging
import math

import httpx

from src.core.config import settings
from src.domain.models import CAPACITY_FACTOR, HOURS_PER_SPRINT_FULL, SPRINTS_PER_QUARTER, Engineer, Task, TeamHistory

HOURS_PER_PART = float(HOURS_PER_SPRINT_FULL)  # часть ≤ одного полного лимита спринта
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


def _split_parts(sp_total: float, role_hours: dict[str, float],
                 sp_cap: float | None = None) -> list[dict]:
    """Pre-split (change 022/026): задача режется на k = min(6, ⌈часы÷80⌉) частей.

    change 026: если известна SP-ёмкость команды, k расширяется до ⌈SP÷ёмкость⌉ —
    иначе часть с SP выше ёмкости (InProgress-остаток) атомарна и не размещается
    ни в один спринт (solver оставляет hard-нарушение → 422). SP и роль-часы
    делятся пропорционально доле части; гейты остаются независимыми шкалами.
    """
    total_hh = sum(role_hours.values())
    if total_hh <= 0:
        return [{"part": 1, "story_points": sp_total, "role_hours": dict(role_hours)}]
    hours_chunks = min(SPRINTS_PER_QUARTER, math.ceil(total_hh / HOURS_PER_PART))
    k = hours_chunks
    if sp_cap and sp_cap > 0 and sp_total > sp_cap:
        k = max(k, min(SPRINTS_PER_QUARTER, math.ceil(sp_total / sp_cap)))
    parts: list[dict] = []
    remaining_hh = total_hh
    for idx in range(1, k + 1):
        if k > hours_chunks:
            # SP-ёмкость расширила k: равномерное деление остатка, чтобы каждая
            # часть была и ≤ 80 ч, и ≤ ёмкости SP; последняя забирает остаток
            take = remaining_hh if idx == k else round(remaining_hh / (k - idx + 1), 2)
        else:
            take = remaining_hh if idx == k else min(HOURS_PER_PART, remaining_hh)
        share = take / total_hh
        parts.append({
            "part": idx,
            "story_points": round(sp_total * share, 2),
            "role_hours": {role: round(h * share, 2) for role, h in role_hours.items()},
        })
        remaining_hh = round(remaining_hh - take, 2)
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
    done_ids: frozenset[str] = frozenset(),
    first_free_sprint: int = 1,
) -> dict:
    """Снапшот домена для POST /solve (контракт tests/test_optimizer_sidecar.py).

    change 026: done_ids (факты + data-Done) исключаются из расстановки,
    горизонт спринтов сужается до first_free_sprint..6 — после фактов solver
    не переигрывает выполненное и не размещает части в прошедшие спринты.
    """
    sole = _sole_holders(engineers)
    by_team_hist: dict[str, list[TeamHistory]] = {}
    for h in history:
        by_team_hist.setdefault(h.team_id, []).append(h)
    sp_cap_by_team: dict[str, float] = {
        team: team_capacity_sp(hist) for team, hist in by_team_hist.items()
    }

    task_entries = []
    for tid, task in tasks.items():
        if task.status == "Done" or tid in done_ids:
            continue
        eff_sp, share = _effective(task, task.spent_time)
        role_hours = {
            _rl(role): _rl_role_hours(task, role, share)
            for role, hours in (task.role_hours or {}).items()
        }
        sp_total = eff_sp if eff_sp > 0 else task.estimation_sp
        task_entries.append({
            "task_id": tid,
            "parent_id": task.parent_id or "",  # null запрещён Java-контрактом (400 invalid snapshot)
            "status": task.status,
            "team_id": task.team_id,
            "story_points": sp_total,
            "estimated_hh": task.estimated_hh or 0.0,
            "spent_time": task.spent_time or 0.0,
            "priority": int(task.priority or 100),
            "planned_in_sprint": bool(getattr(task, "planned_in_sprint", False))
                or int(task.priority or 100) <= 10,
            "parts": _split_parts(sp_total, role_hours, sp_cap_by_team.get(task.team_id)),
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
        "sprints": list(range(first_free_sprint, SPRINTS_PER_QUARTER + 1)),
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