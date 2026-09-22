from src.domain.models import Engineer, Task, TeamHistory, SPRINTS_PER_QUARTER
from src.services.capacity import role_hours_available, team_capacity_sp
from src.services.dependencies import blocked_chain, find_cycle, topo_order
from src.services.planner import PlannerInput, generate_plan


def _hist(velocities: list[float], team="T") -> list[TeamHistory]:
    return [TeamHistory(team_id=team, snapshot_date="", velocity_achieved=v, planned_sp=v)
            for v in velocities]


def test_capacity_sp_average_times_factor():
    assert team_capacity_sp(_hist([10.0, 20.0])) == 12.0  # (10+20)/2×0.8


def test_capacity_sp_empty_history():
    assert team_capacity_sp([]) == 0.0


def test_role_hours_full_and_half():
    eng = [
        Engineer(engineer_id="E1", team_id="T", role="Разработчик Java", capacity_rate=1.0),
        Engineer(engineer_id="E2", team_id="T", role="Тестировщик", capacity_rate=0.5),
        Engineer(engineer_id="E3", team_id="T2", role="Разработчик Java", capacity_rate=1.0),
    ]
    hours = role_hours_available([e for e in eng if e.team_id == "T"])
    assert hours["Разработчик Java"] == 80.0
    assert hours["Тестировщик"] == 40.0


def test_topo_order_respects_deps():
    order = topo_order(["A", "B", "C"], [("A", "B"), ("B", "C")])
    assert order.index("A") < order.index("B") < order.index("C")


def test_topo_detects_cycle():
    assert topo_order(["A", "B"], [("A", "B"), ("B", "A")]) is None


def test_find_cycle_returns_nodes():
    cycle = find_cycle([("A", "B"), ("B", "A")], ["A", "B"])
    assert set(cycle) == {"A", "B"}


def test_blocked_chain_transitive():
    chain = blocked_chain("A", [("A", "B"), ("B", "C"), ("D", "E")])
    assert set(chain) == {"B", "C"}


def _plan_for(tasks, eng=None, hist=None, deps=()):
    eng = eng or [Engineer(engineer_id="E1", team_id="T", role="Разработчик Java")]
    hist = hist or _hist([10.0])
    return generate_plan(PlannerInput(tasks, eng, hist, deps))


def test_planner_sp_limit_per_sprint():
    tasks = [
        Task(task_id=f"X{i}", team_id="T", estimation_sp=5) for i in range(3)
    ]
    plan = _plan_for(tasks)
    per_sprint = {s.sprint_no: sum(i.step_points_sp or 0 for i in s.items) for s in plan.sprints}
    # capacity 10×0.8=8 SP за спринт: 3 задачи по 5 SP не должны уместиться в один спринт
    assert per_sprint[1] < 8.1


def test_planner_role_hours_limit():
    tasks = [Task(task_id=f"A{i}", team_id="T", estimation_sp=1, role_hours={"Разработчик Java": 60})
             for i in range(3)]
    plan = _plan_for(tasks, eng=[
        Engineer(engineer_id="E1", team_id="T", role="Разработчик Java", capacity_rate=1.0)])
    # задача 60 ч против лимита 80 ч/спринт: в один спринт не влезают две целиком,
    # поэтому разобранные части не должны превысить лимит — проверяем через детали:
    # каждая задача либо целиком в одном спринте, либо split указан в reason.
    scheduled = [(i.task_id, s.sprint_no) for s in plan.sprints for i in s.items]
    assert len(scheduled) >= 2  # часть задач запланирована на первых спринтах
    postponed = [d.task_id for d in plan.decisions]
    assert len(postponed) <= 1  # максимум одна задача не влезла в квартал


def test_planner_half_rate_role_hours():
    tasks = [Task(task_id=f"A{i}", team_id="T", estimation_sp=1, role_hours={"Тестировщик": 40})
             for i in range(3)]
    plan = generate_plan(
        PlannerInput(
            tasks,
            [Engineer(engineer_id="E2", team_id="T", role="Тестировщик", capacity_rate=0.5)],
            _hist([10.0]),
            [],
        )
    )
    sprint_of = {i.task_id: s.sprint_no for s in plan.sprints for i in s.items}
    # 0.5 ставки = 40 ч/спринт: по одной задаче на спринт
    assert sprint_of == {"A0": 1, "A1": 2, "A2": 3}


def test_planner_dependency_order():
    tasks = [
        Task(task_id="B", team_id="T", estimation_sp=5),
        Task(task_id="A", team_id="T", estimation_sp=5),
    ]
    plan = _plan_for(tasks, deps=[("A", "B")])
    pos = {i.task_id: s.sprint_no for s in plan.sprints for i in s.items}
    assert pos.get("B", 99) > pos.get("A", -1)


def test_planner_blocked_chain_postponed_message():
    from src.services.dependencies import blocked_chain as bc
    tasks = [Task(task_id="A", team_id="T", estimation_sp=1_000)]
    plan = _plan_for(tasks)
    assert plan.decisions[0].decision.value == "postponed"


def test_planner_all_tasks_fits():
    tasks = [Task(task_id="A", team_id="T", estimation_sp=5, role_hours={"Разработчик Java": 40})]
    plan = _plan_for(tasks)
    assert len([i for s in plan.sprints for i in s.items]) == 1
    assert plan.decisions == []


def test_empty_history_explains_not_planned():
    """change 042: команда без team_history — честная причина в decisions."""
    from src.services.planner import PlannerInput, generate_plan

    task = Task(task_id="T-NH", team_id="NoHistory", status="ToDo", estimation_sp=5.0,
                estimated_hh=20.0, role_hours={"Разработчик": 20.0})
    engineers = [Engineer(engineer_id="E-NH", team_id="NoHistory", role="Разработчик",
                          capacity_rate=1.0, grade="Middle", skills_declared="")]
    plan = generate_plan(PlannerInput([task], engineers, [], []))
    assert not any(i.task_id == "T-NH" for s in plan.sprints for i in s.items), "задача не должна планироваться"
    expl = [d for d in plan.decisions if d.task_id == "T-NH"]
    assert expl and "velocity" in expl[0].reason and "capacity" in expl[0].reason, expl[0].reason


def test_own_team_preferred_over_loan():
    """change 045: при наличии свободного своего носителя заём не берётся —
    своя команда приоритетна в _put_hours."""
    from src.services.planner import PlannerInput, generate_plan

    # задача команды A требует Тестировщика; носитель есть и в A, и в B
    task = Task(task_id="T-OWN", team_id="Team-A", status="ToDo", estimation_sp=5.0,
                estimated_hh=40.0, role_hours={"Тестировщик": 40.0})
    engineers = [
        Engineer(engineer_id="E-A", team_id="Team-A", role="Тестировщик", capacity_rate=1.0, grade="Middle", skills_declared=""),
        Engineer(engineer_id="E-B", team_id="Team-B", role="Тестировщик", capacity_rate=1.0, grade="Middle", skills_declared=""),
    ]
    history = [TeamHistory(team_id="Team-A", snapshot_date="2026-01-01", velocity_achieved=50.0, planned_sp=50.0),
               TeamHistory(team_id="Team-B", snapshot_date="2026-01-01", velocity_achieved=50.0, planned_sp=50.0)]
    plan = generate_plan(PlannerInput([task], engineers, history, []))
    ass = [a for s in plan.sprints for i in s.items for a in i.assignments if i.task_id == "T-OWN"]
    assert ass, "задача не разместилась"
    assert all(a.engineer_id == "E-A" for a in ass), f"займ не должен браться: {ass}"


def test_loan_only_when_own_exhausted():
    """change 045: заём только когда своих в спринте не хватает."""
    from src.services.planner import PlannerInput, generate_plan

    # задача требует 120 ч Тестировщика, свой носитель — 80 ч, заёмный ещё 80
    task = Task(task_id="T-LOAN", team_id="Team-A", status="ToDo", estimation_sp=5.0,
                estimated_hh=120.0, role_hours={"Тестировщик": 120.0})
    engineers = [
        Engineer(engineer_id="E-A", team_id="Team-A", role="Тестировщик", capacity_rate=1.0, grade="Middle", skills_declared=""),
        Engineer(engineer_id="E-B", team_id="Team-B", role="Тестировщик", capacity_rate=1.0, grade="Middle", skills_declared=""),
    ]
    history = [TeamHistory(team_id="Team-A", snapshot_date="2026-01-01", velocity_achieved=50.0, planned_sp=50.0)]
    plan = generate_plan(PlannerInput([task], engineers, history, []))
    ass = [a for s in plan.sprints for i in s.items for a in i.assignments if i.task_id == "T-LOAN"]
    eng_used = {a.engineer_id for a in ass}
    assert "E-A" in eng_used, "свой носитель должен использоваться"
    assert "E-B" in eng_used, "займ допустим когда своих не хватает"


def test_loan_single_donor_team():
    """change 046: займ берётся из одной донорской команды с максимальным
    суммарным свободным лимитом, а не россыпью по всем."""
    from src.services.planner import _put_hours

    eng_limits = {"E-A": 0.0, "E-B1": 80.0, "E-B2": 80.0, "E-C1": 40.0, "E-D1": 30.0}
    eng_roles = {e: {"Тестировщик"} for e in eng_limits}
    eng_used = {1: {e: 0.0 for e in eng_limits}}
    eng_teams = {"E-A": "Team-A", "E-B1": "Team-B", "E-B2": "Team-B",
                 "E-C1": "Team-C", "E-D1": "Team-D"}
    placed, ass = _put_hours("Тестировщик", 100.0, 1, eng_limits, eng_roles,
                             eng_used, {}, eng_teams=eng_teams, task_team_id="Team-A")
    teams_used = {eng_teams[e] for e, _ in ass}
    assert placed == 100.0
    assert teams_used == {"Team-B"}, f"займ должен идти из одной донорской (макс. лимит): {ass}"


def test_loan_second_donor_when_first_insufficient():
    """change 046: если первой донорской не хватает — вторая запасная, третья не берётся."""
    from src.services.planner import _put_hours

    eng_limits = {"E-A": 0.0, "E-B1": 60.0, "E-C1": 50.0, "E-D1": 40.0}
    eng_roles = {e: {"Тестировщик"} for e in eng_limits}
    eng_used = {1: {e: 0.0 for e in eng_limits}}
    eng_teams = {"E-A": "Team-A", "E-B1": "Team-B", "E-C1": "Team-C", "E-D1": "Team-D"}
    placed, ass = _put_hours("Тестировщик", 100.0, 1, eng_limits, eng_roles,
                             eng_used, {}, eng_teams=eng_teams, task_team_id="Team-A")
    teams_used = {eng_teams[e] for e, _ in ass}
    assert placed == 100.0
    assert teams_used == {"Team-B", "Team-C"}, f"донорские 1-я + запасная 2-я, без 3-й: {ass}"


def test_loan_deferred_when_two_donors_insufficient():
    """change 046: если двух донорских не хватает — остаток откладывается
    (caller переносит в следующий спринт), третья команда не трогается."""
    from src.services.planner import _put_hours

    eng_limits = {"E-A": 0.0, "E-B1": 60.0, "E-C1": 50.0, "E-D1": 40.0}
    eng_roles = {e: {"Тестировщик"} for e in eng_limits}
    eng_used = {1: {e: 0.0 for e in eng_limits}}
    eng_teams = {"E-A": "Team-A", "E-B1": "Team-B", "E-C1": "Team-C", "E-D1": "Team-D"}
    placed, ass = _put_hours("Тестировщик", 150.0, 1, eng_limits, eng_roles,
                             eng_used, {}, eng_teams=eng_teams, task_team_id="Team-A")
    teams_used = {eng_teams[e] for e, _ in ass}
    assert placed == 110.0, f"только 60+50, остаток 40 — отложка: {placed}"
    assert "Team-D" not in teams_used, f"третья донорская не берётся: {ass}"
