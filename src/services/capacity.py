from __future__ import annotations

from src.domain.models import CAPACITY_FACTOR, HOURS_PER_SPRINT_FULL, Engineer, TeamHistory


def team_capacity_sp(history: list[TeamHistory]) -> float:
    """Средняя фактическая производительность × 0.8 (спека planning)."""
    velocities = [h.velocity_achieved for h in history if h.velocity_achieved > 0]
    if not velocities:
        return 0.0
    return round(sum(velocities) / len(velocities) * CAPACITY_FACTOR, 2)


def role_hours_available(engineers: list[Engineer]) -> dict[str, float]:
    """Суммарные доступные часы за спринт по ролям, с учётом 0.5 ставки (40 ч) и полной (80 ч)."""
    out: dict[str, float] = {}
    for e in engineers:
        cap = HOURS_PER_SPRINT_FULL if e.capacity_rate >= 1.0 else (
            (HOURS_PER_SPRINT_FULL / 2) * (e.capacity_rate / 0.5) if e.capacity_rate <= 0.5 else HOURS_PER_SPRINT_FULL * e.capacity_rate
        )
        out[e.role] = out.get(e.role, 0.0) + cap
    for role, cap in out.items():
        out[role] = round(cap, 1)
    return out
