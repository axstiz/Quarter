from __future__ import annotations

from collections import defaultdict

from src.services.bus_factor import compute_bus_factor


def teams_overview(engineers) -> list[dict]:
    teams: dict[str, list[dict]] = defaultdict(list)
    for e in engineers:
        teams[e.team_id].append({
            "engineer_id": e.engineer_id,
            "role": e.role,
            "grade": e.grade,
            "capacity_rate": e.capacity_rate,
        })
    return [{"team_id": team, "engineers": members} for team, members in teams.items()]


def engineer_profile(engineers, engineer_id: str) -> dict | None:
    entries = [e for e in engineers if e.engineer_id == engineer_id]
    if not entries:
        return None
    assignments = [{
        "team_id": e.team_id,
        "role": e.role,
        "grade": e.grade,
        "skills_declared": e.skills_declared,
        "capacity_rate": e.capacity_rate,
        "parttime": e.capacity_rate < 1.0,
        "hours_per_sprint": round(80.0 * e.capacity_rate, 1),
    } for e in entries]
    report = compute_bus_factor(engineers)
    my_teams = {e.team_id for e in entries}
    singles = sorted({i.key for i in report.items if i.factor == 1 and i.scope_id in my_teams})
    return {
        "engineer_id": engineer_id,
        "assignments": assignments,
        "single_holder_alerts": sorted(singles),
    }


def star_map_summary(engineers) -> dict:
    distribution: dict[str, float] = defaultdict(float)
    for e in engineers:
        distribution[e.team_id] += min(e.capacity_rate, 1.0)
    report = compute_bus_factor(engineers)
    singles = [i for i in report.items if i.factor == 1]
    return {
        "teams": teams_overview(engineers),
        "fte_distribution": dict(distribution),
        "single_holder_competencies": [i.model_dump() for i in singles],
    }
