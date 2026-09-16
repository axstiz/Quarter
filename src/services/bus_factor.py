from __future__ import annotations

from src.domain.models import BusFactorItem, BusFactorReport, Engineer

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


def compute_bus_factor(engineers: list[Engineer]) -> BusFactorReport:
    items: list[BusFactorItem] = []
    skill_of = lambda e: [
        s.strip().lower() for s in e.skills_declared.split(",") if s.strip()
    ]
    for scope, key_of in (
        ("role", lambda e: [e.role.lower()]),
    ):
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

        for source, by_scope, by_team_scope in (
            ("role", by_role, by_role_team),
            ("skill", by_skill, by_skill_team),
        ):
            for key, holders in by_scope.items():
                items.append(BusFactorItem(
                    scope_type="company",
                    scope_id="company",
                    key=key,
                    holders=sorted(holders),
                    factor=len(holders),
                ))
            for (team, key), holders in by_team_scope.items():
                items.append(BusFactorItem(
                    scope_type="team",
                    scope_id=team,
                    key=key,
                    holders=sorted(holders),
                    factor=len(holders),
                ))
    return BusFactorReport(items=items, methodology=METHODOLOGY)


def unique_competencies(engineers: list[Engineer]) -> list[BusFactorItem]:
    report = compute_bus_factor(engineers)
    return [i for i in report.items if i.factor == 1]
