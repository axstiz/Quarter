"""Жадный планировщик квартала (change 003).

Правила (спека planning):
1. SP-гейт: не больше остатка capacity команды (velocity × 0.8).
2. Роль-гейт: часы ролей закрывают инженеры своей и (при кросс-заёме) других
   команд; суммарная загрузка инженера ≤ лимит (80 ч полная ставка, 40 ч
   при 0.5); роль без носителей — виртуальный держатель (допущение).
3. Статусы: Done — вне плана; InProgress — остаток по часам, SP
   пропорционально; ToDo — полный объём.
4. Приоритет (меньше — раньше; seed при импорте) управляет очерёдностью.
5. Зависимости: блокирующая не позже зависимой.
6. Задача может разбиваться между спринтами (SP/часы пропорционально);
   зависимые стартуют после последнего спринта разбитой задачи.
"""
from __future__ import annotations

import re
from collections import defaultdict

from src.domain.models import (
    HOURS_PER_SPRINT_FULL,
    SPRINTS_PER_QUARTER,
    Engineer,
    Explanation,
    Plan,
    PlanDecision,
    PlanItem,
    SprintPlan,
    Task,
    TeamHistory,
)
from src.services.capacity import team_capacity_sp
from src.services.dependencies import find_cycle, topo_order


def _rl(role: str) -> str:
    return re.sub(r"[\s/\-]+", "", str(role).lower())


def engineer_sprint_limit(capacity_rate: float) -> float:
    rate = max(float(capacity_rate or 1.0), 0.05)
    if rate >= 1.0:
        return HOURS_PER_SPRINT_FULL * rate
    return 40.0 * (rate / 0.5)


class PlannerInput:
    def __init__(
        self,
        tasks: list[Task],
        engineers: list[Engineer],
        team_history: list[TeamHistory],
        deps: list[tuple[str, str]],
        spent_time: dict[str, float] | None = None,
    ):
        self.tasks = tasks
        self.engineers = engineers
        self.team_history = team_history
        self.deps = [(a, b) for a, b in deps if a and b]
        self.spent_time = spent_time or {}


def _effective(task: Task, spent: float) -> tuple[float, float, bool]:
    if task.status == "InProgress":
        est = task.estimated_hh or 0.0
        remaining = max(est - spent, 0.0)
        share = remaining / est if est else 1.0
        eff_sp = round(task.estimation_sp * share, 2)
        overdue = est > 0 and spent > est
        return remaining, eff_sp, overdue
    return task.estimated_hh, task.estimation_sp, False


def _put_hours(role: str, hours: float, sprint: int,
               eng_limits: dict[str, float], eng_roles: dict[str, set[str]],
               eng_used: dict[int, dict[str, float]]) -> float:
    """Сколько часов роли реально закрыть инженерами в конкретном спринте."""
    holders = [e for e, roles in eng_roles.items() if role in roles]
    holders.sort(key=lambda eid: eng_limits[eid] - eng_used[sprint][eid], reverse=True)
    placed = 0.0
    for eid in holders:
        if placed >= hours:
            break
        free = eng_limits[eid] - eng_used[sprint][eid]
        if free <= 0:
            continue
        put = min(hours - placed, free)
        eng_used[sprint][eid] += put
        placed += put
    return placed


def generate_plan(data: PlannerInput, first_free_sprint: int = 1, strategy: str = "priority") -> Plan:
    task_by_id = {t.task_id: t for t in data.tasks}
    tasks_in_cycle = set(find_cycle(data.deps, list(task_by_id)))

    # --- инженеры: лимиты, роли; виртуальные держатели ролей без носителей ---
    eng_limits: dict[str, float] = {}
    eng_roles: dict[str, set[str]] = defaultdict(set)
    for eng in data.engineers:
        eng_limits[eng.engineer_id] = engineer_sprint_limit(eng.capacity_rate)
        eng_roles[eng.engineer_id].add(_rl(eng.role))
    all_roles = {_rl(rl) for t in data.tasks for rl in t.role_hours}
    holders_roles = {r for roles in eng_roles.values() for r in roles}
    for idx, role in enumerate(sorted(all_roles - holders_roles)):
        vid = f"VIRTUAL-PM-{idx}"
        eng_limits[vid] = HOURS_PER_SPRINT_FULL
        eng_roles[vid].add(role)

    # --- порядок задач по выбранной стратегии ---
    todo = [t for t in data.tasks if t.status != "Done" and t.task_id not in tasks_in_cycle]
    if strategy == "metrics":
        init_sp: dict[str, float] = defaultdict(float)
        for t in todo:
            pid = t.parent_id or "NONE"
            init_sp[pid] += t.estimation_sp

        def _metric_key(t: Task):
            is_cust = 0 if (getattr(t, "planned_in_sprint", False) or float(getattr(t, "priority", 100)) <= 10) else 1
            pid = t.parent_id or "NONE"
            sp_rem = init_sp[pid]
            return (is_cust, sp_rem, float(getattr(t, "priority", 100)), t.task_id)

        todo_sorted = sorted(todo, key=_metric_key)
    else:
        todo_sorted = sorted(todo, key=lambda t: (float(getattr(t, "priority", 100)), t.task_id))

    order = topo_order([t.task_id for t in todo_sorted], data.deps)
    if order is None:
        order = [t.task_id for t in todo_sorted]
    else:
        seq = {t.task_id: i for i, t in enumerate(todo_sorted)}
        order = sorted(order, key=lambda tid: seq.get(tid, len(todo_sorted)))

    blocked_by: dict[str, list[str]] = defaultdict(list)
    for blocking, blocked in data.deps:
        if blocked in task_by_id:
            blocked_by[blocked].append(blocking)

    history_by_team: dict[str, list[TeamHistory]] = defaultdict(list)
    for h in data.team_history:
        history_by_team[h.team_id].append(h)

    eng_used: dict[int, dict[str, float]] = {
        n: defaultdict(float) for n in range(first_free_sprint, SPRINTS_PER_QUARTER + 1)
    }
    sp_left: dict[int, dict[str, float]] = {}
    for n in range(first_free_sprint, SPRINTS_PER_QUARTER + 1):
        sp_left[n] = {team: team_capacity_sp(hist) for team, hist in history_by_team.items()}
    for team in {t.team_id for t in data.tasks} - set(history_by_team):
        for n in range(first_free_sprint, SPRINTS_PER_QUARTER + 1):
            sp_left[n][team] = 0.0

    assigned_end: dict[str, int] = {}
    plan = Plan(
        plan_id="",
        sprints=[SprintPlan(sprint_no=n, items=[]) for n in range(first_free_sprint, SPRINTS_PER_QUARTER + 1)],
        decisions=[],
    )

    remaining = list(order)
    passes = 0
    attempted: set[str] = set()
    while remaining and passes <= SPRINTS_PER_QUARTER * 10:
        passes += 1
        progress = False
        still: list[str] = []
        for task_id in remaining:
            # каждая задача получает одну полноценную попытку размещения
            if task_id in attempted:
                continue
            attempted.add(task_id)
            task = task_by_id[task_id]
            team = task.team_id

            blockers = blocked_by.get(task_id, [])
            if any(b in tasks_in_cycle for b in blockers):
                still.append(task_id)
                continue
            unresolved = [b for b in blockers if b in task_by_id and b not in assigned_end]
            if unresolved:
                still.append(task_id)
                continue
            earliest = max(
                (assigned_end[b] + 1 for b in blockers if b in assigned_end),
                default=first_free_sprint,
            )

            spent = float(data.spent_time.get(task_id, 0.0) or 0.0)
            _, eff_sp, overdue = _effective(task, spent)

            hours_total = sum((task.role_hours or {}).values())
            hours_left = {
                _rl(role): float(h or 0.0) for role, h in (task.role_hours or {}).items()
            }
            # если часы ролей не заполнены — объём задаётся SP целиком (SP-only задача)
            hours_only = hours_total > 0

            first_sprint: int | None = None
            last_sprint: int | None = None
            sp_to_place = eff_sp
            placed_hh_total = 0.0
            ok = False
            snapshot_sp = {n: dict(sp_left[n]) for n in sp_left}
            snapshot_eng = {n: dict(eng_used[n]) for n in eng_used}
            for sprint in range(earliest, SPRINTS_PER_QUARTER + 1):
                left_sp = sp_left[sprint].get(team, 0.0)
                if left_sp <= 0:
                    continue
                if sp_to_place <= 0.01:
                    ok = True
                    break
                placed_hh = 0.0
                if hours_only:
                    for rl, need in list(hours_left.items()):
                        if need <= 0:
                            continue
                        got = _put_hours(rl, need, sprint, eng_limits, eng_roles, eng_used)
                        placed_hh += got
                        hours_left[rl] -= got
                    if placed_hh <= 0:
                        continue
                    share = placed_hh / hours_total
                    put_sp = min(left_sp, round(sp_to_place * share, 2)) if sp_to_place > 0 else 0
                else:
                    put_sp = min(left_sp, sp_to_place)
                sp_left[sprint][team] = left_sp - put_sp
                sp_to_place = round(sp_to_place - put_sp, 2)
                placed_hh_total += placed_hh

                r_text = (
                    "разбита между спринтами" if first_sprint is not None and first_sprint < sprint
                    else ("просрочена (overdue)" if overdue and first_sprint is None else "")
                )
                if strategy == "metrics":
                    st_text = f"метрическая стратегия: инициатива {task.parent_id}" if task.parent_id else "метрическая стратегия: приоритет заказчика"
                    r_text = (r_text + "; " + st_text).strip("; ")

                plan.sprints[sprint - first_free_sprint].items.append(PlanItem(
                    task_id=task_id,
                    decision=PlanDecision.planned,
                    sprint_no=sprint,
                    reason=r_text,
                    step_points_sp=put_sp,
                ))
                if first_sprint is None:
                    first_sprint = sprint
                last_sprint = sprint
                if hours_only and all(v <= 0.01 for v in hours_left.values()):
                    ok = True
                    break
                if not hours_only and sp_to_place <= 0.01:
                    ok = True
                    break
            if ok and first_sprint is not None and last_sprint is not None:
                assigned_end[task_id] = last_sprint
                if overdue:
                    for item in plan.sprints[first_sprint - first_free_sprint].items:
                        if item.task_id == task_id:
                            item.reason = ("просрочена (overdue)"
                                           + ("; разбита между спринтами" if last_sprint > first_sprint else ""))
                            break
                progress = True
                continue
            if first_sprint is not None and placed_hh_total > 0:
                # частично влезла: оставляем распределённые спринты,
                # остаток объёма — за пределами квартала (причина помечается)
                assigned_end[task_id] = last_sprint
                for item in plan.sprints[first_sprint - first_free_sprint].items:
                    if item.task_id == task_id:
                        suffix = "выполнится частично (остаток — за пределами квартала)"
                        item.reason = (item.reason + "; " + suffix).strip("; ") if item.reason else suffix
                        break
                progress = True
                continue
            if first_sprint is not None:
                # полностью откатываем частичное размещение
                for n, vals in snapshot_sp.items():
                    sp_left[n] = dict(vals)
                for n, vals in snapshot_eng.items():
                    eng_used[n] = defaultdict(float, vals)
                for sprint in plan.sprints:
                    sprint.items = [i for i in sprint.items if i.task_id != task_id]
            still.append(task_id)
        remaining = still
        if not progress:
            break

    for task_id in remaining:
        task = task_by_id[task_id]
        blockers_missing = [b for b in blocked_by.get(task_id, []) if b in task_by_id and b not in assigned_end]
        reason = (
            "блокируется циклической зависимостью"
            if any(b in tasks_in_cycle for b in blocked_by.get(task_id, []))
            else ("не помещается: зависит от незапланированной " + ", ".join(blockers_missing[:3])
                  if blockers_missing
                  else "не влезла в ресурс/SP/роли до конца квартала — кандидат на отмену")
        )
        plan.decisions.append(Explanation(task_id=task_id, decision=PlanDecision.postponed, reason=reason))

    return plan
