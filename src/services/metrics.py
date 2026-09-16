from __future__ import annotations

from src.domain.models import SPRINTS_PER_QUARTER, MetricsReport


def compute_metrics(
    initial_planned_task_ids: list[str],
    done_task_ids: list[str],
    planned_sp_by_sprint: dict[int, float],
    done_sp_by_sprint: dict[int, float],
    quarter_finished: bool = False,
) -> MetricsReport:
    """Показатели из задания. База сравнения — первоначальный план.
    Загружен факт спринта → значение по спринту фактически; иначе прогноз."""
    initial = set(initial_planned_task_ids)
    done = set(done_task_ids)
    quarter_pct: float | None = None
    if initial:
        quarter_pct = round(len(done & initial) / len(initial) * 100.0, 1)
    sprint_pct: dict[int, float | None] = {}
    sprint_forecast: dict[int, bool] = {}
    for n in range(1, SPRINTS_PER_QUARTER + 1):
        planned = planned_sp_by_sprint.get(n)
        actual = done_sp_by_sprint.get(n)
        if planned and planned > 0 and actual is not None:
            sprint_pct[n] = round(actual / planned * 100.0, 1)
            sprint_forecast[n] = False
        else:
            sprint_pct[n] = None
            sprint_forecast[n] = True
    return MetricsReport(
        quarter_completion_pct=quarter_pct,
        quarter_completion_is_forecast=not quarter_finished,
        sprint_completion_pct=sprint_pct,
        sprint_completion_is_forecast=sprint_forecast,
    )


def compute_metrics_initiatives(
    initial_planned_items: list[dict],  # {"task_id","parent_id","step_points_sp","sprint_no"}
    done_task_ids: list[str],
    planned_sp_by_sprint: dict[int, float],
    done_sp_by_sprint: dict[int, float],
    quarter_finished: bool = False,
) -> MetricsReport:
    """Метрики, знаменатель — инициативы (parent), допустившие ≥1 задачи в
    первоначальном плане; инициатива завершена, когда все её запланированные
    задачи выполнены (done_actual)."""
    planned_by_parent: dict[str, set[str]] = {}
    for item in initial_planned_items:
        parent = str(item.get("parent_id") or item.get("task_id") or "?")
        planned_by_parent.setdefault(parent, set()).add(str(item.get("task_id")))
    done_set = set(done_task_ids)
    done_count = sum(
        1 for tasks in planned_by_parent.values() if tasks and tasks <= done_set
    )
    denom = len(planned_by_parent)
    quarter_pct = round(done_count / denom * 100.0, 1) if denom else None
    sprint_pct: dict[int, float | None] = {}
    sprint_forecast: dict[int, bool] = {}
    for n in range(1, SPRINTS_PER_QUARTER + 1):
        planned = planned_sp_by_sprint.get(n)
        actual = done_sp_by_sprint.get(n)
        if planned and planned > 0 and actual is not None:
            sprint_pct[n] = round(actual / planned * 100.0, 1)
            sprint_forecast[n] = False
        else:
            sprint_pct[n] = None
            sprint_forecast[n] = True
    return MetricsReport(
        quarter_completion_pct=quarter_pct,
        quarter_completion_is_forecast=not quarter_finished,
        sprint_completion_pct=sprint_pct,
        sprint_completion_is_forecast=sprint_forecast,
    )
