from __future__ import annotations

from src.domain.models import Engineer, Plan, Task
from src.services.bus_factor import compute_bus_factor
from src.services.planner import PlannerInput, generate_plan


def generate_optimization_report(
    plan: Plan,
    baseline_plan: Plan,
    tasks: dict[str, Task],
    metrics_report: dict,
) -> dict:
    """
    Comparison план (текущая стратегия) против priority-эталона:
    различия состава + честные метрики из compute_metrics_initiatives
    (знаменатель — initial-план, факт/прогноз развязаны; «нет данных» — null).
    """
    cur_planned_tasks = {item.task_id for s in plan.sprints for item in s.items}
    base_planned_tasks = {item.task_id for s in baseline_plan.sprints for item in s.items}

    added = sorted(cur_planned_tasks - base_planned_tasks)
    removed = sorted(base_planned_tasks - cur_planned_tasks)

    kpi = {
        # % выполнения квартального плана: закрытые инициативы / включённые в initial (метрики ТЗ)
        "quarter_completion_pct": metrics_report.get("quarter_completion_pct"),
        "quarter_is_forecast": metrics_report.get("quarter_completion_is_forecast", True),
        "quarter_target_band": metrics_report.get("quarter_target_band"),
        "quarter_within_norm": metrics_report.get("quarter_within_norm"),
        # Say/Do по фактам спринтов; нет фактов — нет данных (не константа)
        "say_do_pct_by_sprint": metrics_report.get("sprint_completion_pct"),
        "say_do_is_forecast": metrics_report.get("sprint_completion_is_forecast"),
        "say_do_target_band": metrics_report.get("sprint_target_band"),
        "say_do_within_norm": metrics_report.get("sprint_within_norm"),
    }

    return {
        "strategy_used": metrics_report.get("strategy_used", "priority"),
        "baseline_strategy": "priority",
        "quarter_completion_pct": metrics_report.get("quarter_completion_pct"),
        "quarter_within_norm": metrics_report.get("quarter_within_norm"),
        "composition_diff": {"added_tasks": added, "removed_tasks": removed},
        "kpi_summary": kpi,
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
