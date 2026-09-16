from src.domain.models import Engineer, Plan, PlanDecision, PlanItem, SprintPlan, Task, TeamHistory, Warning
from src.services.bus_factor import compute_bus_factor, unique_competencies
from src.services.metrics import compute_metrics
from src.services.replanner import (
    WARN_COMPOSITION_CHANGE,
    WARN_DEADLINE_OVERFLOW,
    WARN_DEPENDENCY_SHIFT,
    WARN_ROLE_DEFICIT,
    compute_warnings,
)
from src.services.starmap import engineer_profile, star_map_summary, teams_overview


def _sprint(no, tasks):
    return SprintPlan(sprint_no=no, items=[
        PlanItem(task_id=t, decision=PlanDecision.planned, sprint_no=no, step_points_sp=5) for t in tasks
    ])


def test_metrics_initial_base_preserved():
    m = compute_metrics(
        initial_planned_task_ids=["A", "B", "C"],
        done_task_ids=["A", "B"],
        planned_sp_by_sprint={1: 10.0, 2: 10.0},
        done_sp_by_sprint={1: 5.0, 2: 10.0},
        quarter_finished=True,
    )
    assert m.quarter_completion_pct == 66.7
    assert not m.quarter_completion_is_forecast
    assert m.sprint_completion_pct[1] == 50.0


def test_metrics_forecast_flag_until_quarter_end():
    m = compute_metrics(
        initial_planned_task_ids=["A", "B"],
        done_task_ids=["A"],
        planned_sp_by_sprint={1: 10.0, 2: 10.0},
        done_sp_by_sprint={1: 10.0},
        quarter_finished=False,
    )
    assert m.quarter_completion_is_forecast
    assert not m.sprint_completion_is_forecast[1]
    assert m.sprint_completion_is_forecast[2]


def test_bus_factor_single_holder_flagged():
    eng = [
        Engineer(engineer_id="E1", team_id="T1", role="Дизайнер", skills_declared="Spark, Figma"),
        Engineer(engineer_id="E2", team_id="T1", role="Разработчик Java", skills_declared="Java, Figma"),
        Engineer(engineer_id="E3", team_id="T2", role="Разработчик Java", skills_declared="Java"),
    ]
    report = compute_bus_factor(eng)
    spark = next(i for i in report.items if i.scope_type == "company" and i.key == "spark")
    assert spark.factor == 1
    java_t1 = next(i for i in report.items if i.scope_type == "team" and i.scope_id == "T1" and i.key == "java")
    # Java в T1 только у E2
    assert java_t1.factor == 1
    java_company = next(i for i in report.items if i.scope_type == "company" and i.key == "java")
    assert java_company.factor == 2
    assert "methodology" in report.model_dump()


def test_unique_competencies_filters():
    eng = [
        Engineer(engineer_id="E1", team_id="T1", role="Дизайнер", skills_declared="Spark"),
        Engineer(engineer_id="E2", team_id="T1", role="Разработчик Java", skills_declared="Java"),
        Engineer(engineer_id="E3", team_id="T2", role="Разработчик Java", skills_declared="Java"),
    ]
    singles = unique_competencies(eng)
    keys = sorted((i.key, i.scope_type, i.scope_id) for i in singles)
    assert ("spark", "company", "company") in keys
    # Java в компании в сумме два носителя — не одиночная
    assert ("java", "company", "company") not in keys
    # Java в отдельной команде — одиночная в области команды
    assert ("java", "team", "T1") in keys


def test_starmap_engineer_two_teams():
    eng = [
        Engineer(engineer_id="E1", team_id="T1", role="Дизайнер", capacity_rate=0.5),
        Engineer(engineer_id="E1", team_id="T2", role="Дизайнер", capacity_rate=0.5),
    ]
    teams = {t["team_id"]: t for t in teams_overview(eng)}
    assert set(teams) == {"T1", "T2"}
    profile = engineer_profile(eng, "E1")
    assert len(profile["assignments"]) == 2
    assert all(a["parttime"] for a in profile["assignments"])


def test_starmap_single_holder_summary():
    eng = [Engineer(engineer_id="E1", team_id="T1", role="Дизайнер", skills_declared="Spark")]
    summary = star_map_summary(eng)
    assert summary["fte_distribution"]["T1"] == 1.0
    assert len(summary["single_holder_competencies"]) >= 1


def test_replanner_role_deficit_warning():
    task = Task(task_id="X", team_id="T1", role_hours={"Тестировщик": 160})
    after = Plan(plan_id="p", sprints=[_sprint(2, ["X"])])
    before = Plan(plan_id="p", sprints=[_sprint(2, ["X"])])
    eng = [Engineer(engineer_id="E1", team_id="T1", role="Тестировщик", capacity_rate=1.0)]
    warnings = compute_warnings(before, after, [], {"X": task}, [], eng)
    kinds = {w.kind for w in warnings}
    assert WARN_ROLE_DEFICIT in kinds
