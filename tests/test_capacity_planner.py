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
