from __future__ import annotations

from src.domain.models import BusFactorItem, BusFactorReport, Engineer, Plan, Task
from src.services.planner import engineer_sprint_limit

FORECAST_METHODOLOGY = (
    "Прогноз bus factor по плановой загрузке (change 023): берём assignments версии плана "
    "(task × роль × инженер × спринт × часы, change 016/022). Для каждого инженера с загрузкой: "
    "часы по спринтам против личного лимита (80 × capacity_rate; 0.5 ставки → 40 ч), суммарный "
    "объём (задачи, часы за квартал), роли, где он единственный носитель (область «компания», "
    "как в рисках плана), перегруженные спринты (часы > лимита). Уровни риска: high — единственный "
    "носитель роли и объём существенен (задач ≥ 3 или часов ≥ 80); medium — единственный носитель "
    "с любой загрузкой, либо перегрузка ≥ 1 спринта; low — остальная загрузка. «Если уйдёт» — объём "
    "плана (N задач / M часов), который останется без исполнителя. Ограничение: прогноз опирается "
    "на плановую загрузку текущей версии и заявленные роли; навыки (skills_declared) и угрозы "
    "вне плана (болезни, увольнения) не предсказываются."
)

METHODOLOGY = (
    "Bus Factor = число носителей компетенции (роли или заявленного навыка) в области расчёта "
    "(компания или команда); инженер, работающий в двух командах по 0.5 ставки, считается носителем "
    "в обеих. Риск отмечается при factor ≤ 1. Расчёт по профилям engineers_profiles; грейд не "
    "влияет. Ограничение методики: навыки заявлены декларативно и проверяются по строке "
    "skills_declared (без учёта уровня владения)."
)


def _holders_by(engineers: list[Engineer], key_of) -> dict[tuple[str, str], set[str]]:
    """(scope_type, scope_id) -> {key: {engineer_id}}"""
    out: dict[tuple[str, str], set[str]] = {}
    for e in engineers:
        for key in key_of(e):
            scope = ("company", "company")
            out.setdefault(scope, set()).add(e.engineer_id)
            scope = ("team", e.team_id)
            out.setdefault(scope, set()).add(e.engineer_id)
    return out


def compute_bus_factor(
    engineers: list[Engineer],
    scope_type: str | None = None,
    scope_id: str | None = None,
) -> BusFactorReport:
    items: list[BusFactorItem] = []
    skill_of = lambda e: [
        s.strip().lower() for s in e.skills_declared.split(",") if s.strip()
    ]
    by_role: dict[str, set[str]] = {}
    by_role_team: dict[tuple[str, str], set[str]] = {}
    by_skill: dict[str, set[str]] = {}
    by_skill_team: dict[tuple[str, str], set[str]] = {}

    for e in engineers:
        for scope_key in (e.role.lower(),):
            by_role.setdefault(scope_key, set()).add(e.engineer_id)
            by_role_team.setdefault((e.team_id, scope_key), set()).add(e.engineer_id)
        for s in skill_of(e):
            by_skill.setdefault(s, set()).add(e.engineer_id)
            by_skill_team.setdefault((e.team_id, s), set()).add(e.engineer_id)

    for key, holders in sorted(by_role.items()):
        items.append(BusFactorItem(
            scope_type="company",
            scope_id="company",
            key=key,
            holders=sorted(holders),
            factor=len(holders),
        ))
    for (team, key), holders in sorted(by_role_team.items()):
        items.append(BusFactorItem(
            scope_type="team",
            scope_id=team,
            key=key,
            holders=sorted(holders),
            factor=len(holders),
        ))

    for key, holders in sorted(by_skill.items()):
        items.append(BusFactorItem(
            scope_type="company",
            scope_id="company",
            key=key,
            holders=sorted(holders),
            factor=len(holders),
        ))
    for (team, key), holders in sorted(by_skill_team.items()):
        items.append(BusFactorItem(
            scope_type="team",
            scope_id=team,
            key=key,
            holders=sorted(holders),
            factor=len(holders),
        ))

    if scope_type:
        st = scope_type.lower()
        items = [i for i in items if i.scope_type == st]
        if scope_id:
            items = [i for i in items if i.scope_id == scope_id]

    return BusFactorReport(items=items, methodology=METHODOLOGY)


def unique_competencies(engineers: list[Engineer]) -> list[BusFactorItem]:
    report = compute_bus_factor(engineers)
    return [i for i in report.items if i.factor == 1]


def plan_bus_risk(
    planned_items: list[dict],
    tasks: dict[str, Task],
    engineers: list[Engineer],
) -> dict:
    """Задачи запланированного плана, зависящие от ролей с factor ≤ 1
    (change 004-frontend-readiness). Область расчёта — компания; роль без
    носителей = «виртуальный держатель», тоже риск (holders = []). Роли
    сопоставляются нормализованно (lower, как в compute_bus_factor).
    Навыки (skills_declared) не сопоставляются: в данных нет связи
    задача-навык, только задача-роль."""
    role_holders: dict[str, set[str]] = {}
    for e in engineers:
        role_holders.setdefault(e.role.lower(), set()).add(e.engineer_id)
    results = []
    for item in planned_items:
        task = tasks.get(item["task_id"])
        if not task:
            continue
        at_risk: list[str] = []
        holders: dict[str, list[str]] = {}
        for role in (task.role_hours or {}):
            holders_for_role = sorted(role_holders.get(str(role).lower(), set()))
            if len(holders_for_role) <= 1:
                at_risk.append(role)
                holders[role] = holders_for_role
        if at_risk:
            results.append({
                "task_id": task.task_id,
                "summary": task.summary,
                "sprint_no": item.get("sprint_no"),
                "at_risk_keys": at_risk,
                "holders": holders,
            })
    return {"total_at_risk": len(results), "tasks": results}


def plan_bus_forecast(plan: "Plan", tasks: dict[str, Task], engineers: list[Engineer]) -> dict:
    """Прогноз bus factor по плановой загрузке (change 023).

    По assignments версии плана (016/022) собираем на каждого инженера: часы по
    спринтам vs лимит (80×ставка), суммарный объём (задачи/часы), роли, где он
    единственный носитель (company-scope), перегруженные спринты и прогноз
    «если уйдёт — N задач / M часов» с уровнем high/medium/low и численным basis.
    Люди без плановой загрузки (и виртуальные держатели) в ответ не попадают.
    """
    eng_by_id: dict[str, Engineer] = {}
    for e in engineers:
        eng_by_id.setdefault(e.engineer_id, e)

    role_holders: dict[str, set[str]] = {}
    for e in engineers:
        role_holders.setdefault(e.role.lower(), set()).add(e.engineer_id)

    load: dict[str, dict[int, float]] = {}
    task_ids: dict[str, set[str]] = {}
    roles_used: dict[str, set[str]] = {}
    role_display: dict[str, str] = {}
    for sprint in plan.sprints:
        for item in sprint.items:
            for ass in (item.assignments or []):
                eid = ass.engineer_id
                if not eid or eid.startswith("VIRTUAL-"):
                    continue
                bucket = load.setdefault(eid, {})
                bucket[ass.sprint_no] = bucket.get(ass.sprint_no, 0.0) + (ass.hours or 0.0)
                task_ids.setdefault(eid, set()).add(item.task_id)
                norm = ass.role.strip().lower()
                roles_used.setdefault(eid, set()).add(norm)
                role_display.setdefault(norm, ass.role)

    people: list[dict] = []
    level_rank = {"high": 0, "medium": 1, "low": 2}
    for eid in sorted(load):
        eng = eng_by_id.get(eid)
        if eng is None:
            continue
        limit = engineer_sprint_limit(eng.capacity_rate)
        per_sprint = {str(n): round(h, 1) for n, h in sorted(load[eid].items())}
        overloaded = sorted(n for n, h in per_sprint.items() if h > limit + 0.05)
        critical = sorted(role_display[r] for r in roles_used[eid] if len(role_holders.get(r, set())) <= 1)
        tasks_n = len(task_ids.get(eid, ()))
        hours_n = round(sum(load[eid].values()), 1)
        sprints_span = sorted(int(n) for n in per_sprint)

        if critical and (tasks_n >= 3 or hours_n >= 80):
            level = "high"
        elif critical or (overloaded and hours_n >= 80):
            level = "medium"
        else:
            level = "low"

        basis_parts = []
        if critical:
            basis_parts.append(f"единственный носитель: {', '.join(critical)}")
        if sprints_span:
            basis_parts.append(f"загрузка {tasks_n} задача(и) / {hours_n} ч в спринтах "
                               f"{sprints_span[0]}–{sprints_span[-1]}")
        else:
            basis_parts.append("загрузка 0 ч")
        if overloaded:
            over_txt = ", ".join(f"спринт {n} ({per_sprint[n]} ч > {round(limit, 1)} ч)" for n in overloaded)
            basis_parts.append(f"перегруз: {over_txt}")
        basis = "; ".join(basis_parts)

        people.append({
            "engineer_id": eid,
            "team_id": eng.team_id,
            "role": eng.role,
            "capacity_rate": eng.capacity_rate,
            "limit_hours_per_sprint": round(limit, 1),
            "hours_per_sprint": per_sprint,
            "total_hours": hours_n,
            "tasks_count": tasks_n,
            "critical_roles": critical,
            "overloaded_sprints": overloaded,
            "risk": {
                "level": level,
                "affected_tasks": tasks_n,
                "affected_hours": hours_n,
                "basis": basis,
            },
        })

    people.sort(key=lambda p: (level_rank[p["risk"]["level"]], -p["total_hours"], p["engineer_id"]))
    return {
        "plan_id": plan.plan_id,
        "methodology": FORECAST_METHODOLOGY,
        "people": people,
    }
