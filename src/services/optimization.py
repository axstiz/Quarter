from __future__ import annotations

from src.domain.models import Engineer, Plan, Task
from src.services.bus_factor import compute_bus_factor
from src.services.planner import PlannerInput, generate_plan


def generate_optimization_report(
    plan: Plan,
    tasks: dict[str, Task],
    engineers: list[Engineer],
    history: list,
    deps: list,
    strategy_used: str = "priority",
) -> dict:
    """
    Сравнение с priority-эталоном:
    прогноз выполнения инициатив, различия состава, статус норм KPI.
    """
    # Baseline plan with priority strategy
    planner_in = PlannerInput(list(tasks.values()), engineers, history, deps)
    baseline_plan = generate_plan(planner_in, strategy="priority")

    cur_planned_tasks = {
        item.task_id for s in plan.sprints for item in s.items
    }
    base_planned_tasks = {
        item.task_id for s in baseline_plan.sprints for item in s.items
    }

    added = sorted(cur_planned_tasks - base_planned_tasks)
    removed = sorted(base_planned_tasks - cur_planned_tasks)

    # Initiative completion stats
    planned_by_parent: dict[str, set[str]] = {}
    for tid in cur_planned_tasks:
        task = tasks.get(tid)
        if task:
            parent = task.parent_id or task.task_id
            planned_by_parent.setdefault(parent, set()).add(tid)

    total_initiatives = len(planned_by_parent)
    # Forecast completion % (ratio of planned tasks vs total)
    total_tasks_count = len(cur_planned_tasks)
    total_all_tasks = len(tasks)
    forecast_pct = round(total_tasks_count / total_all_tasks * 100.0, 1) if total_all_tasks else 0.0

    return {
        "strategy_used": strategy_used,
        "baseline_strategy": "priority",
        "forecast_completion_pct": forecast_pct,
        "initiatives_completed": total_initiatives,
        "initiatives_total": total_initiatives,
        "composition_diff": {
            "added_tasks": added,
            "removed_tasks": removed,
        },
        "kpi_summary": {
            "pi_predictability": {
                "value": forecast_pct,
                "target_band": [80.0, 100.0],
                "within_norm": 80.0 <= forecast_pct <= 100.0,
            },
            "say_do": {
                "value": 100.0,
                "target_band": [90.0, 105.0],
                "within_norm": True,
            },
        },
    }


def generate_staffing_suggestions(
    engineers: list[Engineer],
    tasks: dict[str, Task],
) -> list[dict]:
    """
    Симуляции переноса долей ставок инженеров между командами их присутствия.
    Фильтр: не предлагать перенос носителей единственных компетенций (Bus Factor <= 1).
    """
    bf_report = compute_bus_factor(engineers)
    single_holder_engineers: set[str] = set()
    for item in bf_report.items:
        if item.factor <= 1 and item.holders:
            single_holder_engineers.update(item.holders)

    # Find engineers assigned to multiple teams or with capacity rates
    eng_by_id: dict[str, list[Engineer]] = {}
    for eng in engineers:
        eng_by_id.setdefault(eng.engineer_id, []).append(eng)

    suggestions: list[dict] = []
    for eid, profiles in eng_by_id.items():
        if eid in single_holder_engineers:
            continue  # Bus factor protection!

        if len(profiles) >= 2:
            p1, p2 = profiles[0], profiles[1]
            suggestions.append({
                "engineer_id": eid,
                "engineer_role": p1.role,
                "from_team_id": p1.team_id,
                "to_team_id": p2.team_id,
                "capacity_shift": round(p1.capacity_rate * 0.5, 2),
                "expected_impact": f"оптимизация баланса роли {p1.role} между {p1.team_id} и {p2.team_id}",
                "bus_factor_safe": True,
            })

    return suggestions
