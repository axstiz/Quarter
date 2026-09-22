"""Жадный планировщик квартала (change 003, 016).

Правила (спека planning, 016-person-planner):
1. SP-гейт: не больше остатка capacity команды (velocity × 0.8).
2. Роль-гейт: часы ролей закрывают конкретные инженеры своей и (при кросс-заёме) других
   команд; суммарная загрузка инженера ≤ лимит (80 ч полная ставка, 40 ч
   при 0.5); роль без носителей — виртуальный держатель (допущение).
3. Персональные назначения: решения о распределении сохраняются в виде Assignment
   (task × role × engineer × sprint).
4. Закрепления (pin): задачи с pin планируются на этапе pre-occupancy до остальных.
"""
from __future__ import annotations

import re
from collections import defaultdict

from src.domain.models import (
    HOURS_PER_SPRINT_FULL,
    SPRINTS_PER_QUARTER,
    Assignment,
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


def _put_hours(
    role: str,
    hours: float,
    sprint: int,
    eng_limits: dict[str, float],
    eng_roles: dict[str, set[str]],
    eng_used: dict[int, dict[str, float]],
    orig_roles: dict[str, str],
    preferred_engineer_id: str | None = None,
    eng_teams: dict[str, str] | None = None,
    task_team_id: str | None = None,
) -> tuple[float, list[tuple[str, float]]]:
    """Сколько часов роли реально закрыть инженерами в конкретном спринте, и список (engineer_id, hours).

    change 045: предпочтение своей команды задачи. Сортировка носителей:
    (1) свой pinned/preferred инженер, (2) инженеры своей команды по свободным часам,
    (3) заёмные (другие команды) по свободным часам. Заём берётся только когда своих
    в этом спринте не хватает — не «кто свободнее».
    """
    holders = [e for e, roles in eng_roles.items() if role in roles]

    # change 046: займ из одной донорской команды (макс. суммарный свободный лимит
    # роли в этом спринте), вторая запасная, дальше — отложка в следующий спринт
    donor_free: dict[str, float] = defaultdict(float)
    if eng_teams and task_team_id:
        for eid in holders:
            team = eng_teams.get(eid)
            if team and team != task_team_id:
                donor_free[team] += max(0.0, eng_limits[eid] - eng_used[sprint][eid])
    donor_order = sorted(donor_free, key=lambda t: (-donor_free[t], t))[:2]  # только 1-я и запасная 2-я
    donor_rank = {team: i for i, team in enumerate(donor_order)}

    def _sort_key(eid: str):
        is_pref = 0 if (preferred_engineer_id and eid == preferred_engineer_id) else 1
        free = eng_limits[eid] - eng_used[sprint][eid]
        own = 0 if (task_team_id and eng_teams and eng_teams.get(eid) == task_team_id) else 1
        team = (eng_teams or {}).get(eid)
        if own == 1:
            # заёмный: только донорская 1-я (rank 0) или запасная 2-я (rank 1); остальные не берём
            donor = donor_rank.get(team, 9)
        else:
            donor = 0
        return (is_pref, own, donor, -free, eid)

    holders.sort(key=_sort_key)
    placed = 0.0
    assignments: list[tuple[str, float]] = []
    for eid in holders:
        if placed >= hours:
            break
        # change 046: заёмный не из донорской 1-2 не берётся — отложка (caller идёт в след. спринт)
        team = (eng_teams or {}).get(eid)
        if (
            eng_teams and task_team_id and team and team != task_team_id
            and eid != preferred_engineer_id and donor_rank.get(team, 9) > 1
        ):
            continue
        free = eng_limits[eid] - eng_used[sprint][eid]
        if free <= 0:
            continue
        put = min(hours - placed, free)
        eng_used[sprint][eid] += put
        placed += put
        assignments.append((eid, put))
    return placed, assignments


def generate_plan(
    data: PlannerInput,
    first_free_sprint: int = 1,
    strategy: str = "priority",
    pins: dict[str, dict] | None = None,
) -> Plan:
    pins = pins or {}
    task_by_id = {t.task_id: t for t in data.tasks}
    tasks_in_cycle = set(find_cycle(data.deps, list(task_by_id)))

    # --- инженеры: лимиты, роли, команды; виртуальные держатели ролей без носителей ---
    eng_limits: dict[str, float] = {}
    eng_roles: dict[str, set[str]] = defaultdict(set)
    eng_teams: dict[str, str] = {}  # change 045: команда инженера — для приоритета своей команды
    orig_roles: dict[str, str] = {}
    for eng in data.engineers:
        eng_limits[eng.engineer_id] = engineer_sprint_limit(eng.capacity_rate)
        normalized_role = _rl(eng.role)
        eng_roles[eng.engineer_id].add(normalized_role)
        eng_teams[eng.engineer_id] = eng.team_id
        orig_roles[normalized_role] = eng.role

    all_roles = {_rl(rl): rl for t in data.tasks for rl in t.role_hours}
    holders_roles = {r for roles in eng_roles.values() for r in roles}
    for idx, (norm_role, orig_role) in enumerate(sorted(all_roles.items())):
        if norm_role not in holders_roles:
            vid = f"VIRTUAL-PM-{idx}"
            eng_limits[vid] = HOURS_PER_SPRINT_FULL
            eng_roles[vid].add(norm_role)
            orig_roles[norm_role] = orig_role

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

    blocked_by: dict[str, list[str]] = defaultdict(list)
    for blocking, blocked in data.deps:
        if blocked in task_by_id:
            blocked_by[blocked].append(blocking)

    # --- Pre-occupancy phase for PIN tasks ---
    pinned_tasks = set(pins.keys())
    for tid, pin_info in pins.items():
        if tid not in task_by_id:
            continue
        task = task_by_id[tid]
        pinned_sprint = pin_info.get("sprint_no", first_free_sprint)
        if pinned_sprint < first_free_sprint or pinned_sprint > SPRINTS_PER_QUARTER:
            continue
        pinned_eng_id = pin_info.get("engineer_id")
        pinned_pos = pin_info.get("position")

        spent = float(data.spent_time.get(tid, 0.0) or 0.0)
        _, eff_sp, overdue = _effective(task, spent)
        hours_total = sum((task.role_hours or {}).values())

        task_assignments: list[Assignment] = []
        if hours_total > 0:
            for role_name, h_need in (task.role_hours or {}).items():
                if h_need <= 0:
                    continue
                rl = _rl(role_name)
                got, ass_list = _put_hours(
                    rl, h_need, pinned_sprint, eng_limits, eng_roles, eng_used, orig_roles,
                    preferred_engineer_id=pinned_eng_id,
                    eng_teams=eng_teams, task_team_id=task.team_id,
                )
                for eid, h_placed in ass_list:
                    task_assignments.append(Assignment(
                        task_id=tid,
                        role=role_name,
                        engineer_id=eid,
                        sprint_no=pinned_sprint,
                        hours=h_placed,
                        is_pinned=True,
                    ))

        left_sp = sp_left[pinned_sprint].get(task.team_id, 0.0)
        put_sp = min(left_sp, eff_sp)
        sp_left[pinned_sprint][task.team_id] = left_sp - put_sp
        assigned_end[tid] = pinned_sprint

        plan.sprints[pinned_sprint - first_free_sprint].items.append(PlanItem(
            task_id=tid,
            decision=PlanDecision.planned,
            sprint_no=pinned_sprint,
            reason="закреплено (pin)",
            step_points_sp=put_sp,
            assignments=task_assignments,
            pinned_sprint=pinned_sprint,
            pinned_engineer_id=pinned_eng_id,
            pinned_position=pinned_pos,
        ))

    # --- Порядок обычных задач по выбранной стратегии ---
    todo = [t for t in data.tasks if t.status != "Done" and t.task_id not in tasks_in_cycle and t.task_id not in pinned_tasks]
    # блокеры со статусом Done: зависимость уже выполнена, заблокированные свободны (zásada спеки Г)
    done_blockers = {t.task_id for t in data.tasks if t.status == "Done"}
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

    task_preferred_eng: dict[str, dict[str, str]] = defaultdict(dict)  # task_id -> {norm_role -> engineer_id}

    remaining = list(order)
    passes = 0
    while remaining and passes <= SPRINTS_PER_QUARTER * 10:
        passes += 1
        progress = False
        still: list[str] = []
        # сброс на каждый проход: иначе задачи, не сумевшие разместиться в предыдущем,
        # навсегда выпадают из очереди, не получив ни места, ни решения (без not_planned!)
        attempted: set[str] = set()
        for task_id in remaining:
            task = task_by_id[task_id]
            team = task.team_id

            blockers = blocked_by.get(task_id, [])
            if any(b in tasks_in_cycle for b in blockers):
                still.append(task_id)
                continue
            unresolved = [b for b in blockers if b in task_by_id and b not in assigned_end and b not in done_blockers]
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
            orig_role_names = { _rl(role): role for role in (task.role_hours or {}) }
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
                sprint_assignments: list[Assignment] = []
                if hours_only:
                    for rl, need in list(hours_left.items()):
                        if need <= 0:
                            continue
                        pref_eid = task_preferred_eng[task_id].get(rl)
                        got, ass_list = _put_hours(rl, need, sprint, eng_limits, eng_roles, eng_used, orig_roles,
                                                   preferred_engineer_id=pref_eid,
                                                   eng_teams=eng_teams, task_team_id=task.team_id)
                        placed_hh += got
                        hours_left[rl] -= got
                        role_orig_name = orig_role_names.get(rl, rl)
                        for eid, h_placed in ass_list:
                            sprint_assignments.append(Assignment(
                                task_id=task_id,
                                role=role_orig_name,
                                engineer_id=eid,
                                sprint_no=sprint,
                                hours=h_placed,
                            ))
                            # запоминаем первого инженера для сохранения преемственности в след. спринте (например DB-202)
                            if rl not in task_preferred_eng[task_id]:
                                task_preferred_eng[task_id][rl] = eid
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
                    assignments=sprint_assignments,
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
                assigned_end[task_id] = last_sprint
                for item in plan.sprints[first_sprint - first_free_sprint].items:
                    if item.task_id == task_id:
                        suffix = "выполнится частично (остаток — за пределами квартала)"
                        item.reason = (item.reason + "; " + suffix).strip("; ") if item.reason else suffix
                        break
                progress = True
                continue
            if first_sprint is not None:
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
        blockers_missing = [b for b in blocked_by.get(task_id, []) if b in task_by_id and b not in assigned_end and b not in done_blockers]
        if blockers_missing:
            reason = "не помещается: зависит от незапланированной " + ", ".join(blockers_missing[:3])
        elif any(b in tasks_in_cycle for b in blocked_by.get(task_id, [])):
            reason = "блокируется циклической зависимостью"
        elif not history_by_team.get(task.team_id):
            # change 042: команда без team_history — честная причина (раньше была общая «не влезла»)
            reason = ("истории velocity нет (team_history пуст) — capacity команды = 0, задача не запланирована; "
                      "задайте скорость команды или загрузите историю")
        else:
            reason = "не влезла в ресурс/SP/роли до конца квартала — кандидат на отмену"
        plan.decisions.append(Explanation(task_id=task_id, decision=PlanDecision.postponed, reason=reason))

    return plan

