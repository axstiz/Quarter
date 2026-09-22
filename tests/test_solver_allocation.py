"""change 022, задачи 2.1–2.3, 3.3: пер-специалистов распределение solver-черновика.

После solve бэк закрепляет часы ролей каждой части за конкретными носителями
жадным распределителем (лимит 80×ставка, заём, виртуальный держатель); не
влезшее сдвигается на следующие спринты, остаток — «выполнится частично».
422 остаётся только на структурные нарушения (validate_draft).
"""

from src.domain.models import Engineer, Task, TeamHistory
from src.services.optimize_plan import allocate_engineers, validate_draft

TEAM = "Team-A"


def _engineers(*specs) -> list[Engineer]:
    return [Engineer(engineer_id=eid, team_id=team, role=role, capacity_rate=rate)
            for eid, team, role, rate in specs]


def _history(velocity: float = 100.0) -> list[TeamHistory]:
    return [TeamHistory(team_id=TEAM, snapshot_date="2026-06-01",
                        velocity_achieved=velocity, planned_sp=velocity)]


def _task(tid: str, sp: float, role_hours: dict[str, float]) -> Task:
    return Task(task_id=tid, team_id=TEAM, estimation_sp=sp,
                estimated_hh=sum(role_hours.values()), role_hours=role_hours)


def _draft_item(tid: str, part: int, sprint: int, sp: float,
                role_hours: dict[str, float], team: str = TEAM) -> dict:
    return {"task_id": tid, "part": part, "sprint_no": sprint, "step_points_sp": sp,
            "team_id": team, "role_hours": role_hours}


def _run(items, tasks, engineers, history=None):
    draft = {"items": items, "postponed": [], "partial_hh": {}}
    return allocate_engineers(draft, tasks, engineers, history or _history())


def test_allocate_100h_between_two_holders_80_20():
    """100 ч роли, носители 80 ч и 40 ч → assignments 80 + 20 в том же спринте."""
    task = _task("T-1", 10.0, {"разработчик": 100.0})
    engineers = _engineers(("E-1", TEAM, "Разработчик", 1.0), ("E-2", TEAM, "Разработчик", 0.5))
    draft = _run([_draft_item("T-1", 1, 1, 10.0, {"разработчик": 100.0})], { "T-1": task }, engineers)
    ass = [(a["engineer_id"], a["hours"]) for a in draft["items"][0]["assignments"]]
    assert sum(h for _, h in ass) == 100.0
    by_eng = dict(ass)
    assert by_eng["E-1"] == 80.0
    assert by_eng["E-2"] == 20.0
    assert all(a["sprint_no"] == 1 for a in draft["items"][0]["assignments"])


def test_shift_part_to_next_sprint_when_holders_busy():
    """Носители спринта 3 заняты другой частью → часть сдвигается в спринт 4."""
    t1 = _task("T-1", 10.0, {"разработчик": 80.0})
    t2 = _task("T-2", 10.0, {"разработчик": 80.0})
    engineers = _engineers(("E-1", TEAM, "Разработчик", 1.0))
    items = [
        _draft_item("T-1", 1, 3, 10.0, {"разработчик": 80.0}),
        _draft_item("T-2", 1, 3, 10.0, {"разработчик": 80.0}),
    ]
    draft = _run(items, {"T-1": t1, "T-2": t2}, engineers)
    sprints = {it["task_id"]: it["sprint_no"] for it in draft["items"]}
    assert sprints["T-1"] == 3
    assert sprints["T-2"] == 4, "часть без свободных носителей сдвигается на следующий спринт"
    assert not draft["postponed"]


def test_partial_remainder_beyond_quarter():
    """100 ч, один носитель 80 ч, спринт 6: 80 ч в спринте 6, 20 ч — «выполнится частично»."""
    task = _task("T-1", 10.0, {"разработчик": 100.0})
    engineers = _engineers(("E-1", TEAM, "Разработчик", 1.0))
    draft = _run([_draft_item("T-1", 1, 6, 10.0, {"разработчик": 100.0})], {"T-1": task}, engineers)
    assert len(draft["items"]) == 1
    assert draft["items"][0]["sprint_no"] == 6
    assert sum(a["hours"] for a in draft["items"][0]["assignments"]) == 80.0
    assert draft["partial_hh"]["T-1"] == 20.0
    assert not draft["postponed"], "частичное размещение — не перенос задачи целиком"


def test_virtual_holder_for_role_without_carriers():
    """Роль без носителей закрывается виртуальным держателем (80 ч/спринт)."""
    task = _task("T-1", 5.0, {"менеджер": 40.0})
    engineers = _engineers(("E-1", TEAM, "Разработчик", 1.0))
    draft = _run([_draft_item("T-1", 1, 1, 5.0, {"менеджер": 40.0})], {"T-1": task}, engineers)
    ass = draft["items"][0]["assignments"]
    assert ass[0]["engineer_id"].startswith("VIRTUAL-")
    assert ass[0]["hours"] == 40.0


def test_fully_unplaced_part_moves_task_to_postponed():
    """Ни один час части не разместился до конца квартала → задача в postponed."""
    t1 = _task("T-1", 10.0, {"разработчик": 480.0})
    t2 = _task("T-2", 10.0, {"разработчик": 80.0})
    engineers = _engineers(("E-1", TEAM, "Разработчик", 1.0))
    items = [
        _draft_item("T-1", k, k, 10.0 / 6, {"разработчик": 80.0}) for k in range(1, 7)
    ] + [_draft_item("T-2", 1, 6, 10.0, {"разработчик": 80.0})]
    draft = _run(items, {"T-1": t1, "T-2": t2}, engineers)
    assert all(it["task_id"] == "T-1" for it in draft["items"])
    assert any(p["task_id"] == "T-2" for p in draft["postponed"])
    assert draft["partial_hh"].get("T-2", 0.0) == 80.0


def test_validate_draft_dependency_violation_structural_422():
    """validate_draft: нарушение зависимости — структурная ошибка (→ 422 на записи)."""
    t1 = _task("T-1", 5.0, {"разработчик": 40.0})
    t2 = _task("T-2", 5.0, {"разработчик": 40.0})
    engineers = _engineers(("E-1", TEAM, "Разработчик", 1.0))
    draft = {"items": [
        _draft_item("T-1", 1, 3, 5.0, {"разработчик": 40.0}),
        _draft_item("T-2", 1, 3, 5.0, {"разработчик": 40.0}),
    ], "staffing_moves": []}
    violations = validate_draft(draft, {"T-1": t1, "T-2": t2}, engineers, _history(),
                                [("T-1", "T-2")])
    assert any("зависимость" in v for v in violations)


def test_validate_draft_counts_part_hours_not_full_task():
    """Роль-гейт считает часы ЧАСТИ, а не всей задачи (две части одной задачи в спринте)."""
    task = _task("T-1", 20.0, {"разработчик": 160.0})
    engineers = _engineers(("E-1", TEAM, "Разработчик", 1.0))
    draft = {"items": [
        _draft_item("T-1", 1, 1, 10.0, {"разработчик": 80.0}),
        _draft_item("T-1", 2, 2, 10.0, {"разработчик": 80.0}),
    ], "staffing_moves": []}
    violations = validate_draft(draft, {"T-1": task}, engineers, _history(), [])
    assert not violations, f"части по 80 ч в разных спринтах не нарушают роль-гейт: {violations}"


def test_assignment_role_uses_display_name():
    """change 052: role в assignments — display-имя из задач/инженеров,
    не нормализованный ключ части (без пробелов/регистра)."""
    task = _task("T-1", 10.0, {"Тестировщик (Автотестирование)": 40.0})
    engineers = _engineers(("E-1", TEAM, "Тестировщик (Автотестирование)", 1.0))
    # часть solver несёт нормализованные ключи ролей (snapshot _rl)
    draft = _run([_draft_item("T-1", 1, 1, 10.0, {"тестировщик(автотестирование)": 40.0})],
                 {"T-1": task}, engineers)
    ass = draft["items"][0]["assignments"]
    assert ass and all(a["role"] == "Тестировщик (Автотестирование)" for a in ass), ass
