"""change 022, задача 1.1: pre-split частей в build_snapshot.

Задача разрезается на k = min(6, ceil(total_hh / 80)) частей; SP и роль-часы
делятся пропорционально. Solver раскладывает части независимо.
"""

import math

from src.domain.models import Engineer, Task, TeamHistory
from src.services.optimizer_client import build_snapshot


def _world(task: Task) -> dict:
    engineers = [
        Engineer(engineer_id="ENG-1", team_id=task.team_id, role="Разработчик", capacity_rate=1.0),
    ]
    history = [TeamHistory(team_id=task.team_id, snapshot_date="2026-06-01",
                           velocity_achieved=100.0, planned_sp=100.0)]
    return build_snapshot({task.task_id: task}, engineers, history, [])


def _task(tid: str, sp: float, hh: float, role_hours: dict[str, float], **kw) -> Task:
    return Task(task_id=tid, team_id="Team-A", estimation_sp=sp, estimated_hh=hh,
                role_hours=role_hours, **kw)


def test_presplit_190h_into_three_parts():
    """190 ч → 3 части 80/80/30, SP и роль-часы пропорциональны."""
    snap = _world(_task("T-190", sp=19.0, hh=190.0, role_hours={"Разработчик": 190.0}))
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 3
    sizes = [sum(p["role_hours"].values()) for p in parts]
    assert sizes == [80.0, 80.0, 30.0]
    sps = [p["story_points"] for p in parts]
    assert abs(sum(sps) - 19.0) < 0.01
    assert all(abs(sp - 19.0 * (h / 190.0)) < 0.02 for sp, h in zip(sps, sizes))


def test_presplit_40h_single_part():
    """40 ч → одна часть (без разрезания)."""
    snap = _world(_task("T-40", sp=4.0, hh=40.0, role_hours={"Разработчик": 40.0}))
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 1
    assert parts[0]["part"] == 1
    assert parts[0]["role_hours"] == {"разработчик": 40.0}
    assert parts[0]["story_points"] == 4.0


def test_presplit_cap_six_parts():
    """Очень большая задача ограничена 6 частями (спринтов в квартале 6)."""
    snap = _world(_task("T-1000", sp=100.0, hh=1000.0, role_hours={"Разработчик": 1000.0}))
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 6
    assert abs(sum(sum(p["role_hours"].values()) for p in parts) - 1000.0) < 0.01
    assert abs(sum(p["story_points"] for p in parts) - 100.0) < 0.05


def test_presplit_role_hours_proportional():
    """Несколько ролей делятся между частями пропорционально доле части."""
    snap = _world(_task("T-2R", sp=16.0, hh=160.0,
                        role_hours={"Разработчик": 120.0, "Тестировщик": 40.0}))
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 2
    for p in parts:
        total = sum(p["role_hours"].values())
        assert abs(p["role_hours"]["разработчик"] - total * 0.75) < 0.02
        assert abs(p["role_hours"]["тестировщик"] - total * 0.25) < 0.02
    for role in ("разработчик", "тестировщик"):
        assert abs(sum(p["role_hours"][role] for p in parts)
                   - (120.0 if role == "разработчик" else 40.0)) < 0.01


def test_presplit_inprogress_uses_remaining_share():
    """InProgress: режется остаток (estimated_hh − spent), SP — эффективная доля."""
    snap = _world(_task("T-IP", sp=10.0, hh=200.0, status="InProgress", spent_time=50.0,
                        role_hours={"Разработчик": 200.0}))
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == math.ceil(150.0 / 80.0)  # 2 части: 80 + 70
    assert abs(sum(sum(p["role_hours"].values()) for p in parts) - 150.0) < 0.01
    assert abs(sum(p["story_points"] for p in parts) - 7.5) < 0.01


def test_presplit_task_without_role_hours_single_part():
    """Задача без роль-часов не режется (нулевая потребность → одна часть)."""
    snap = _world(_task("T-0H", sp=8.0, hh=0.0, role_hours={}))
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 1
    assert parts[0]["role_hours"] == {}


def test_snapshot_done_filter_and_narrowed_horizon():
    """change 026: done_ids исключаются из снапшота, горизонт сужается."""
    tasks = {
        "T-A": _task("T-A", sp=5.0, hh=50.0, role_hours={"Разработчик": 50.0}),
        "T-B": _task("T-B", sp=5.0, hh=50.0, role_hours={"Разработчик": 50.0}),
        "T-C": _task("T-C", sp=5.0, hh=50.0, role_hours={"Разработчик": 50.0}, status="Done"),
    }
    engineers = [
        Engineer(engineer_id="ENG-1", team_id="Team-A", role="Разработчик", capacity_rate=1.0),
    ]
    history = [TeamHistory(team_id="Team-A", snapshot_date="2026-06-01",
                           velocity_achieved=100.0, planned_sp=100.0)]
    snap = build_snapshot(tasks, engineers, history, [],
                          done_ids=frozenset({"T-B"}), first_free_sprint=2)
    ids = {t["task_id"] for t in snap["tasks"]}
    assert ids == {"T-A"}, "done_ids и data-Done должны отсутствовать в снапшоте"
    assert snap["sprints"] == list(range(2, 7)), "горизонт сужается до first_free_sprint..6"


def test_presplit_respects_team_sp_capacity():
    """change 026: SP части не должна превышать ёмкость команды —
    задача SP 10 (20 ч, 1 часть по часам) при ёмкости 8 SP → 2 части."""
    task = _task("T-BIG-SP", sp=10.0, hh=20.0, role_hours={"Разработчик": 20.0})
    engineers = [
        Engineer(engineer_id="ENG-1", team_id="Team-A", role="Разработчик", capacity_rate=1.0),
    ]
    history = [TeamHistory(team_id="Team-A", snapshot_date="2026-06-01",
                           velocity_achieved=10.0, planned_sp=10.0)]  # ёмкость 8
    snap = build_snapshot({task.task_id: task}, engineers, history, [])
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 2, "атомарная часть SP 10 > 8 не размещается — режем по ёмкости"
    assert all(p["story_points"] <= 8.0 + 0.01 for p in parts)
    assert abs(sum(p["story_points"] for p in parts) - 10.0) < 0.02


def test_presplit_small_role_not_fragmented():
    """change 048: роль 1 ч в задаче на 191 ч не дробится на 3 осколка по 0.33 —
    уходит целиком в последнюю часть."""
    snap = _world(_task("T-SM", sp=19.0, hh=191.0,
                        role_hours={"Разработчик": 190.0, "Девопс": 1.0}))
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 3
    devops = [p["role_hours"].get("девопс", 0.0) for p in parts]
    assert devops == [0.0, 0.0, 1.0]
    dev = [p["role_hours"]["разработчик"] for p in parts]
    assert abs(sum(dev) - 190.0) < 0.01


def test_presplit_role_above_threshold_still_split():
    """change 048: роль с долей в части ≥ 2 ч дробится пропорционально, как раньше."""
    snap = _world(_task("T-OK", sp=16.0, hh=160.0,
                        role_hours={"Разработчик": 150.0, "Тестировщик": 10.0}))
    parts = snap["tasks"][0]["parts"]
    assert len(parts) == 2
    qa = [p["role_hours"]["тестировщик"] for p in parts]
    assert all(h >= 2.0 for h in qa)
    assert abs(sum(qa) - 10.0) < 0.01
