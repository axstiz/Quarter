from __future__ import annotations

from collections import defaultdict

from src.domain.models import (
    SPRINTS_PER_QUARTER,
    Engineer,
    Plan,
    PlanDecision,
    PlanItem,
    Task,
    Warning as PlanWarning,
)


from datetime import date, timedelta

WARN_DEADLINE_OVERFLOW = "deadline_overflow"
WARN_DEPENDENCY_SHIFT = "dependency_shift"
WARN_ROLE_DEFICIT = "role_deficit"
WARN_GRADE_DEFICIT = "grade_deficit"
WARN_COMPOSITION_CHANGE = "composition_change"


def compute_warnings(
    plan_before: Plan,
    plan_after: Plan,
    done_tasks: list[str],
    task_map: dict[str, Task],
    deps: list[tuple[str, str]],
    engineers: list[Engineer],
    quarter_start: date | None = None,
) -> list[PlanWarning]:
    warnings: list[PlanWarning] = []
    deps_by_blocked: dict[str, list[str]] = defaultdict(list)
    for blocking, blocked in deps:
        deps_by_blocked[blocking].append(blocked)

    # 1) выход за квартал с датами
    last = {i.task_id: s.sprint_no for s in plan_after.sprints for i in s.items}
    if plan_after.decisions:
        latest = max((sn for sn in (last.values() if last else [])), default=0)
        latest_postponed = [d.task_id for d in plan_after.decisions if d.decision == PlanDecision.postponed]
        if latest_postponed and latest >= SPRINTS_PER_QUARTER:
            msg = "выполнение по прогнозу выходит за пределы квартала; под угрозой сдвиг всего плана"
            if quarter_start:
                q_end = quarter_start + timedelta(days=6 * 14 - 1)
                forecast_sprint = max(latest + 1, 7)
                forecast_end = quarter_start + timedelta(days=forecast_sprint * 14 - 1)
                msg = f"выполнение по прогнозу ({forecast_end.isoformat()}) выходит за пределы квартала ({q_end.isoformat()}); под угрозой сдвиг всего плана"
            warnings.append(PlanWarning(
                kind=WARN_DEADLINE_OVERFLOW,
                message=msg,
                task_ids=sorted(set(latest_postponed)),
            ))

    # 2) сдвиг цепочки зависимых
    moved_later: dict[str, tuple[int, int]] = {}
    pos_before = {i.task_id: s.sprint_no for s in plan_before.sprints for i in s.items}
    for task_id, sprint_no in last.items():
        if pos := pos_before.get(task_id):
            if sprint_no > pos:
                moved_later[task_id] = (pos, sprint_no)
    if moved_later:
        chained_keys = set(moved_later) & set(deps_by_blocked)
        for task_id in moved_later:
            for b in deps_by_blocked.get(task_id, []):
                if b in moved_later:
                    chained_keys.add(task_id)
                    break
        if chained_keys:
            warnings.append(PlanWarning(
                kind=WARN_DEPENDENCY_SHIFT,
                message="сдвиг цепочки зависимых задач из-за невыполнения блокирующих",
                task_ids=sorted(chained_keys),
            ))

    # 3) дефицит ролей и грейдов на следующий спринт
    items_by_sprint: dict[int, list[PlanItem]] = defaultdict(list)
    for s in plan_after.sprints:
        items_by_sprint[s.sprint_no].extend(s.items)
    undone_sprints = [
        sn for sn, items in items_by_sprint.items()
        if not all(i.task_id in done_tasks for i in items)
    ]
    next_sprint = min(undone_sprints) if undone_sprints else None
    if next_sprint is not None:
        by_team_hours: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for item in items_by_sprint[next_sprint]:
            task = task_map.get(item.task_id)
            if task:
                for role, hours in task.role_hours.items():
                    by_team_hours[task.team_id][role] += hours

        engineer_hours: dict[tuple[str, str], float] = defaultdict(float)
        junior_only_hours: dict[tuple[str, str], float] = defaultdict(float)
        eng_grades: dict[tuple[str, str], set[str]] = defaultdict(set)

        for eng in engineers:
            hrs = 80.0 * eng.capacity_rate if eng.capacity_rate >= 1.0 else 40.0 * eng.capacity_rate / 0.5
            key = (eng.team_id, eng.role)
            engineer_hours[key] += hrs
            eng_grades[key].add(eng.grade)
            if eng.grade.lower() in ("junior", "младший"):
                junior_only_hours[key] += hrs

        for team, need in by_team_hours.items():
            for role, hours in need.items():
                key = (team, role)
                available = engineer_hours.get(key, 0.0)
                if hours > available:
                    warnings.append(PlanWarning(
                        kind=WARN_ROLE_DEFICIT,
                        message=f"дефицит роли {role} в команде {team} на спринт {next_sprint}: "
                                f"нужно {hours:.0f} ч, доступно {available:.0f} ч",
                        task_ids=sorted(i.task_id for i in items_by_sprint[next_sprint]
                                        if task_map.get(i.task_id) and task_map[i.task_id].team_id == team),
                    ))

                # Grade deficit warning (решение №8): роли закрываются только Junior и их не хватает
                grades = eng_grades.get(key, set())
                is_junior_only = grades and all(g.lower() in ("junior", "младший") for g in grades)
                if is_junior_only and hours > available:
                    warnings.append(PlanWarning(
                        kind=WARN_GRADE_DEFICIT,
                        message=f"дефицит грейда для роли {role} в команде {team} на спринт {next_sprint}: "
                                f"роль закрывается только младшим грейдом (Junior), доступно {available:.0f} ч из {hours:.0f} ч",
                        task_ids=sorted(i.task_id for i in items_by_sprint[next_sprint]
                                        if task_map.get(i.task_id) and task_map[i.task_id].team_id == team),
                    ))

    # 4) изменения состава плана
    before_ids = {i.task_id for s in plan_before.sprints for i in s.items} | {
        d.task_id for d in plan_before.decisions
    }
    after_ids = {i.task_id for s in plan_after.sprints for i in s.items} | {
        d.task_id for d in plan_after.decisions
    }
    added = sorted(after_ids - before_ids)
    removed = sorted(before_ids - after_ids)
    if added or removed or moved_later:
        warnings.append(PlanWarning(
            kind=WARN_COMPOSITION_CHANGE,
            message="состав плана изменился: " + (f"+{added} " if added else "") + (f"-{removed}" if removed else ""),
            task_ids=sorted(set(list(added) + list(removed) + list(moved_later))),
        ))
    return warnings
