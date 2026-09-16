from __future__ import annotations

from collections import defaultdict

from src.domain.models import (
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
from src.services.capacity import role_hours_available, team_capacity_sp
from src.services.dependencies import find_cycle, topo_order


PLAN_CATEGORY = "generate_plan"


class PlannerInput:
    def __init__(
        self,
        tasks: list[Task],
        engineers: list[Engineer],
        team_history: list[TeamHistory],
        deps: list[tuple[str, str]],
    ):
        self.tasks = tasks
        self.engineers = engineers
        self.team_history = team_history
        self.deps = [(b, d) for b, d in deps if b and d]


def generate_plan(data: PlannerInput, first_free_sprint: int = 1) -> Plan:
    """Жадный planner на оставшиеся спринты квартала (спека planning).

    Ограничения задачи на спринт:
    - SP: не больше остатка capacity команды (velocity средняя × 0.8);
    - часы ролей: сумма по ролям задачи укладывается в доступные часы инженеров
      этой команды в спринте (80 ч полная ставка, 40 ч при 0.5);
    - зависимости: блокирующая скпланируется не позже блокируемой.

    Жадная эвристика: топологический порядок, начиная с самого раннего
    возможного спринта. Если не влезло — postponed с причиной.
    """

    tasks_in_cycle = set(find_cycle(data.deps, [t.task_id for t in data.tasks]))

    task_by_id = {t.task_id for t in data.tasks}
    known_tasks = [t for t in data.tasks]
    pending = [t.task_id for t in known_tasks if t.task_id not in tasks_in_cycle]
    order = topo_order(pending, data.deps) or sorted()
    if not order:
        order = pending

    task_by_id = {t.task_id: t for t in known_tasks}
    blocked_by: dict[str, list[str]] = defaultdict(list)
    for blocking, blocked in data.deps:
        if blocked in task_by_id and (blocking in task_by_id or True):
            blocked_by[blocked].append(blocking)

    engineers_by_team: dict[str, list[Engineer]] = defaultdict(list)
    for eng in data.engineers:
        engineers_by_team[eng.team_id].append(eng)
    history_by_team: dict[str, list[TeamHistory]] = defaultdict(list)
    for h in data.team_history:
        history_by_team[h.team_id].append(h)

    sp_left: dict[int, dict[str, float]] = {}
    for n in range(first_free_sprint, SPRINTS_PER_QUARTER + 1):
        sp_left[n] = {t: team_capacity_sp(hist) for t, hist in history_by_team.items()}

    role_avail: dict[int, dict[str, float]] = {
        n: {t: role_hours_available(engineers_by_team.get(t, [])) for t in history_by_team}
        for n in range(first_free_sprint, SPRINTS_PER_QUARTER + 1)
    }
    role_used: dict[int, dict[str, dict[str, float]]] = {
        n: {t: defaultdict(float) for t in history_by_team}
        for n in range(first_free_sprint, SPRINTS_PER_QUARTER + 1)
    }

    assigned: dict[str, int] = {}
    plan = Plan(
        plan_id="",
        sprints=[SprintPlan(sprint_no=n, items=[]) for n in range(first_free_sprint, SPRINTS_PER_QUARTER + 1)],
        decisions=[],
    )
    passes = 0
    remaining = order
    while remaining and passes <= SPRINTS_PER_QUARTER * 10:
        passes += 1
        progress = False
        still = []
        for task_id in remaining:
            task = task_by_id[task_id]
            team = task.team_id
            blockers = [b for b in blocked_by.get(task_id, [])]

            unsure = [b for b in blockers if b in tasks_in_cycle]
            if unsure:
                still.append(task_id)
                continue

            unresolved = [b for b in blockers if b not in assigned]
            if unresolved:
                still.append(task_id)
                continue

            earliest = max((assigned[b] + 1 for b in blockers), default=first_free_sprint)

            placed = False
            for sprint in range(earliest, SPRINTS_PER_QUARTER + 1):
                if team not in sp_left[sprint]:
                    cap = team_capacity_sp(history_by_team.get(team, []))
                    sp_left[sprint][team] = cap
                    role_avail[sprint][team] = role_hours_available(engineers_by_team.get(team, []))
                    role_used[sprint][team] = defaultdict(float)
                if task.estimation_sp > sp_left[sprint][team]:
                    continue
                need = task.role_hours
                ok = True
                for role, hours in need.items():
                    free = role_avail[sprint][team].get(role, 0.0) - role_used[sprint][team][role]
                    if hours > free:
                        ok = False
                        break
                if not ok:
                    continue
                for role, hours in need.items():
                    role_used[sprint][team][role] += hours
                sp_left[sprint][team] -= task.estimation_sp
                assigned[task_id] = sprint
                plan.sprints[sprint - first_free_sprint].items.append(PlanItem(
                    task_id=task_id,
                    decision=PlanDecision.planned,
                    sprint_no=sprint,
                    reason="",
                    step_points_sp=task.estimation_sp,
                ))
                progress = True
                placed = True
                break
            if not placed:
                still.append(task_id)
        remaining = still
        if not progress:
            break

    for task_id in remaining:
        task = task_by_id[task_id]
        blockers = [b for b in blocked_by.get(task_id, []) if b not in assigned and b not in task_by_id]
        if any(b in tasks_in_cycle for b in blocked_by.get(task_id, [])):
            reason = "блокируется из-за циклической зависимости"
        elif any(b not in assigned for b in blocked_by.get(task_id, []) if b in task_by_id):
            reason = "не помещается: зависит от незапланированных задач"
        else:
            reason = "не хватает ресурса/ролей в оставшихся спринтах"
        plan.decisions.append(Explanation(
            task_id=task_id,
            decision=PlanDecision.postponed,
            reason=reason,
        ))

    return plan
