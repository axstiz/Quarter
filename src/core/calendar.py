from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Sequence


def calculate_quarter_start(
    tasks: Sequence[Any] | None = None,
    current_date: date | None = None,
) -> date:
    """
    Расчёт стартового квартала по правилу решения №12:
    1. max(planned_end) по датасету (если есть доступные даты)
    2. Fallback: max(actual_end) / max(planned_start)
    3. Fallback: текущая дата

    Демо-квартал — следующий незавершённый квартал после reference date.
    Если ref_date в Q1 (январь-март), демо-квартал = Q2 (апрель).
    Если ref_date в Q4 (октябрь-декабрь), демо-квартал = Q1 следующего года.
    """
    ref_date: date | None = None

    if tasks:
        planned_ends: list[date] = []
        for t in tasks:
            val = getattr(t, "planned_end", None) if not isinstance(t, dict) else t.get("planned_end")
            if val and isinstance(val, date):
                planned_ends.append(val)
        if planned_ends:
            ref_date = max(planned_ends)
        else:
            other_dates: list[date] = []
            for t in tasks:
                for attr in ("actual_end", "planned_start", "actual_start"):
                    val = getattr(t, attr, None) if not isinstance(t, dict) else t.get(attr)
                    if val and isinstance(val, date):
                        other_dates.append(val)
            if other_dates:
                ref_date = max(other_dates)

    if ref_date is None:
        ref_date = current_date or date.today()

    year = ref_date.year
    month = ref_date.month
    q = (month - 1) // 3 + 1

    if q == 4:
        next_year = year + 1
        next_q = 1
    else:
        next_year = year
        next_q = q + 1

    start_month = (next_q - 1) * 3 + 1
    return date(next_year, start_month, 1)


def get_sprint_dates(
    quarter_start: date,
    sprint_length_days: int = 14,
    total_sprints: int = 6,
) -> dict[str, dict[str, str]]:
    """
    Возвращает структуру спринтов и их дат:
    "1": {"start": "2026-10-01", "end": "2026-10-14"}, ...
    """
    sprints: dict[str, dict[str, str]] = {}
    for s in range(1, total_sprints + 1):
        s_start = quarter_start + timedelta(days=(s - 1) * sprint_length_days)
        s_end = s_start + timedelta(days=sprint_length_days - 1)
        sprints[str(s)] = {
            "start": s_start.isoformat(),
            "end": s_end.isoformat(),
        }
    return sprints
