"""Оркестрация оптимизации плана (change 018, задачи 2.2–2.5).

Жизненный цикл: снапшот → доверить сайдкару (solver) или жадной метрической
стратегии (эвристика при недоступности sidecar) → валидация черновика
hard-правилами → новая версия плана (strategy=optimization) → отчёт метрик
до/после + применённые переносы + score-разбивка.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from src.core.config import settings
from sqlalchemy import select

from src.db.models import PlanItemORM, PlanORM, SprintFactORM, StaffingMoveORM
from src.domain.models import HOURS_PER_SPRINT_FULL, SPRINTS_PER_QUARTER
from src.domain.models import Engineer, Explanation, Plan, PlanDecision, PlanItem, SprintPlan, Task, TeamHistory
from src.services.capacity import team_capacity_sp
from src.services.metrics import compute_metrics_initiatives
from src.services.optimizer_client import SolverUnavailable, build_snapshot, role_hours_available, solve_sidecar
from src.services.planner import PlannerInput, _put_hours, _rl, engineer_sprint_limit, generate_plan

logger = logging.getLogger(__name__)

CAPACITY_TOLERANCE = 0.05


class OptimizationError(Exception):
    """Базовая ошибка оптимизации (режим и причина фиксируются в job)."""


class DraftValidationError(OptimizationError):
    """Черновик solver нарушает hard-правила: версия не создаётся (422)."""


class StaffingPermissionError(OptimizationError):
    """Черновик требует переноса людей, а роль не admin (403)."""


async def load_plan_orm(session, plan_id: str, workspace_id: str) -> PlanORM | None:
    return (await session.execute(select(PlanORM).where(
        PlanORM.plan_id == plan_id, PlanORM.workspace_id == workspace_id))).scalar_one_or_none()


async def load_world(session, workspace_id: str) -> tuple[dict[str, Task], list[Engineer], list[TeamHistory], list[tuple[str, str]]]:
    from src.api.routes import load_world as _load_world

    return await _load_world(session, workspace_id=workspace_id)


async def _plan_from_items(session, plan_id: str) -> Plan:
    plan = Plan(plan_id=plan_id)
    rows = (await session.execute(select(PlanItemORM).where(PlanItemORM.plan_id == plan_id))).scalars().all()
    by_sprint: dict[int, SprintPlan] = {}
    for it in rows:
        if it.decision == PlanDecision.planned.value:
            bucket = by_sprint.setdefault(it.sprint_no or 0, SprintPlan(sprint_no=it.sprint_no or 0, items=[]))
            bucket.items.append(PlanItem(
                task_id=it.task_id, decision=PlanDecision.planned, sprint_no=it.sprint_no,
                reason=it.reason, step_points_sp=it.planned_sp))
        else:
            plan.decisions.append(Explanation(
                task_id=it.task_id, decision=PlanDecision.postponed, sprint_no=it.sprint_no, reason=it.reason))
    plan.sprints = [by_sprint[k] for k in sorted(by_sprint) if k > 0]
    return plan


async def build_report(
    session,
    workspace_id: str,
    source_plan_id: str,
    new_plan_id: str,
    mode: str,
    staffing_moves: list[dict],
    score_breakdown: list[dict],
) -> dict:
    """Метрики нового плана против прежнего + контекст (переносы, score)."""
    tasks_map, _, _, _ = await load_world(session, workspace_id=workspace_id)
    source_plan, new_plan = (
        await _plan_from_items(session, source_plan_id),
        await _plan_from_items(session, new_plan_id),
    )
    facts = (await session.execute(select(SprintFactORM).where(
        SprintFactORM.workspace_id == workspace_id))).scalars().all()
    done_task_ids = sorted({tid for f in facts for tid in (f.completed_task_ids or [])})
    done_sp_by_sprint = {f.sprint_no: f.completed_sp for f in facts}
    quarter_finished = len(facts) >= SPRINTS_PER_QUARTER

    def _kpi(plan: Plan) -> dict:
        planned_sp_by_sprint = {
            s.sprint_no: sum(i.step_points_sp or 0.0 for i in s.items) for s in plan.sprints
        }
        initial_items = [
            {"task_id": i.task_id,
             "parent_id": tasks_map[i.task_id].parent_id if i.task_id in tasks_map else None,
             "step_points_sp": i.step_points_sp or 0.0,
             "sprint_no": s.sprint_no}
            for s in plan.sprints for i in s.items
        ]
        report = compute_metrics_initiatives(
            initial_items, done_task_ids, planned_sp_by_sprint, done_sp_by_sprint,
            quarter_finished=quarter_finished,
        ).model_dump()
        report["sprint_sp"] = planned_sp_by_sprint
        return report

    before = _kpi(source_plan)
    after = _kpi(new_plan)
    planned_tasks = {
        s.sprint_no: {i.task_id for i in s.items} for s in source_plan.sprints
    }
    return {
        "mode": mode,
        "before": before,
        "after": after,
        "composition_diff": {
            "added_tasks": [], "removed_tasks": [],
        },
        "staffing_moves": staffing_moves,
        "score_breakdown": score_breakdown,
        "split_by_team_role": {
            "before": _split_by_team_role(source_plan, tasks_map, []),
            "after": _split_by_team_role(new_plan, tasks_map, []),
        },
    }



def _split_by_team_role(plan: "Plan", tasks_map: dict[str, Task],
                        engineers: list[Engineer]) -> list[dict]:
    """change 041: разбиение per (team, role, sprint): SP/часы vs командный лимит.

    Лимит роли в команде = Σ 80×capacity_rate её носителей (как в buildRoleModel
    фронта); если носителей нет — виртуальный держатель 80 ч (company-wide, change 003).
    """
    from collections import defaultdict

    rates: dict[tuple[str, str], float] = defaultdict(float)
    for e in engineers:
        rates[(e.team_id, e.role)] += 80.0 * (e.capacity_rate or 1.0)

    by_key: dict[tuple[str, str], dict[int, dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {"sp": 0.0, "hours": 0.0}))
    for sprint in plan.sprints:
        for item in sprint.items:
            task = tasks_map.get(item.task_id)
            team = (task.team_id if task else "") or "-"
            sp = float(item.step_points_sp or 0.0)
            if item.assignments:
                role_hours = {}
                for a in item.assignments:
                    role = a.get("role") or "-"
                    h = float(a.get("hours") or 0.0)
                    if h > 0:
                        role_hours[role] = role_hours.get(role, 0.0) + h
            else:
                role_hours = {r: float(v or 0.0) for r, v in (task.role_hours or {}).items()} if task else {}
            for role, hours in role_hours.items():
                cell = by_key[(team, role or "-")][sprint.sprint_no]
                cell["hours"] += hours
                cell["sp"] += sp
    out = []
    for (team, role), sprints in by_key.items():
        limit = rates[(team, role)] or 80.0
        placed = sum(v["hours"] for v in sprints.values())
        # within_norm = все спринты в пределах командного лимита роли (лимит — за спринт)
        within = all(v["hours"] <= limit + 0.05 for v in sprints.values())
        out.append({
            "team_id": team, "role": role, "sprints": sprints,
            "limit_hours": round(limit, 1),
            "within_norm": within,
            "total_hours": round(placed, 1),
        })
    return sorted(out, key=lambda x: (x["team_id"], x["role"]))


def _normalize_draft(response: dict, snapshot: dict, tasks: dict[str, Task],
                     mode: str) -> dict:
    """Черновик solver (assignments по part_id) → единая структура items/postponed."""
    part_info: dict[tuple[str, int], dict] = {}
    for t in snapshot["tasks"]:
        for p in t["parts"]:
            part_info[(t["task_id"], p["part"])] = p

    items = []
    item_tasks: set[str] = set()
    seen_parts: set[tuple[str, int]] = set()
    partial_hh: dict[str, float] = defaultdict(float)
    for a in response.get("assignments", []):
        task_id = a["task_id"]
        part = a.get("part", 1)
        sprint = a.get("sprint")
        info = part_info.get((task_id, part), {})
        seen_parts.add((task_id, part))
        if not isinstance(sprint, int) or sprint not in range(1, 7):
            # solver допускает unassigned (allowsUnassigned) — такие части не «спринт 0»,
            # а вне квартала: честная причина, валидации гейтов не касаются
            partial_hh[task_id] += sum((info.get("role_hours") or {}).values())
            continue
        item_tasks.add(task_id)
        items.append({
            "task_id": task_id,
            "part": part,
            "sprint_no": sprint,
            "step_points_sp": float(info.get("story_points", a.get("story_points", 0.0)) or 0.0),
            "team_id": a.get("team_id") or (tasks[task_id].team_id if task_id in tasks else ""),
            "role_hours": dict(info.get("role_hours") or {}),
        })
    # части, которые solver вообще не вернул в assignments, — тоже вне квартала
    for (task_id, part), info in part_info.items():
        if (task_id, part) not in seen_parts:
            partial_hh[task_id] += sum((info.get("role_hours") or {}).values())
    # postponed — только задачи в области снапшота (change 026): выполненные
    # по фактам/data-Done в расстановку не входят ни planned, ни postponed
    snapshot_ids = {t["task_id"] for t in snapshot["tasks"]}
    postponed = [
        {"task_id": tid, "reason": "не попала в расстановку solver"}
        for tid in sorted(tasks)
        if tid in snapshot_ids and tid not in item_tasks
    ]
    # переносы: «инженер остался в своей команде» (to_team_id null или == from) — НЕ перенос,
    # БД-модель требует not-null; честные переносы только к другой команде
    real_moves = [
        m for m in response.get("staffing_moves", [])
        if m.get("to_team_id") and m.get("from_team_id") and m.get("to_team_id") != m.get("from_team_id")
    ]
    return {
        "items": items,
        "postponed": postponed,
        "partial_hh": dict(partial_hh),
        "staffing_moves": real_moves,
        "score": response.get("score"),
        "score_breakdown": response.get("score_breakdown", []),
        "mode": mode,
    }


def allocate_engineers(draft: dict, tasks: dict[str, Task], engineers: list[Engineer],
                       history: list[TeamHistory]) -> dict:
    """Пер-специалистов распределение solver-черновика (change 022, ступень 2).

    Каждая часть (task × part × sprint) закрепляет часы ролей за носителями
    жадным распределителем change 003 (_put_hours: лимит 80×ставка, заём,
    виртуальный держатель). Не влезшее по пер-специалистов лимитам сдвигается
    на следующие спринты (с учётом SP-гейта), остаток — «выполнится частично».
    """
    eng_limits: dict[str, float] = {}
    eng_roles: dict[str, set[str]] = defaultdict(set)
    eng_teams: dict[str, str] = {}  # change 045: команда инженера — приоритет своей команды в _put_hours
    orig_roles: dict[str, str] = {}
    for eng in engineers:
        eng_limits[eng.engineer_id] = engineer_sprint_limit(eng.capacity_rate)
        eng_roles[eng.engineer_id].add(_rl(eng.role))
        eng_teams[eng.engineer_id] = eng.team_id
        orig_roles.setdefault(_rl(eng.role), eng.role)

    all_roles = {_rl(rl): rl for t in tasks.values() for rl in (t.role_hours or {})}
    holders_roles = {r for roles in eng_roles.values() for r in roles}
    for idx, (norm_role, orig_role) in enumerate(sorted(all_roles.items())):
        if norm_role not in holders_roles:
            vid = f"VIRTUAL-PM-{idx}"
            eng_limits[vid] = HOURS_PER_SPRINT_FULL
            eng_roles[vid].add(norm_role)
            orig_roles[norm_role] = orig_role

    history_by_team: dict[str, list[TeamHistory]] = defaultdict(list)
    for h in history:
        history_by_team[h.team_id].append(h)
    sp_left: dict[int, dict[str, float]] = {
        n: {team: team_capacity_sp(hist) for team, hist in history_by_team.items()}
        for n in range(1, SPRINTS_PER_QUARTER + 1)
    }
    eng_used: dict[int, dict[str, float]] = {
        n: defaultdict(float) for n in range(1, SPRINTS_PER_QUARTER + 1)
    }

    partial_hh: dict[str, float] = defaultdict(float, draft.get("partial_hh") or {})
    new_items: list[dict] = []
    for it in draft["items"]:
        team = it["team_id"]
        role_hours = {_rl(r): float(h) for r, h in (it.get("role_hours") or {}).items() if h}
        hours_total = sum(role_hours.values())
        hours_left = dict(role_hours)
        sp_to_place = float(it["step_points_sp"])
        placed_any = False
        first_sprint: int | None = None

        sprint = it["sprint_no"]
        while sprint <= SPRINTS_PER_QUARTER:
            left_sp = sp_left[sprint].get(team, 0.0)
            if left_sp <= 0:
                sprint += 1
                continue
            placed_hh = 0.0
            sprint_ass: list[dict] = []
            if hours_total > 0:
                if all(v <= 0.01 for v in hours_left.values()):
                    break
                for rl, need in list(hours_left.items()):
                    if need <= 0:
                        continue
                    got, ass_list = _put_hours(rl, need, sprint, eng_limits, eng_roles,
                                               eng_used, orig_roles,
                                               eng_teams=eng_teams, task_team_id=it["team_id"])
                    placed_hh += got
                    hours_left[rl] = round(need - got, 2)
                    for eid, h_placed in ass_list:
                        sprint_ass.append({
                            "task_id": it["task_id"], "role": orig_roles.get(rl, rl),
                            "engineer_id": eid, "sprint_no": sprint, "hours": h_placed,
                            "is_pinned": False,
                        })
                if placed_hh <= 0:
                    sprint += 1
                    continue
                share = placed_hh / hours_total
                put_sp = min(left_sp, round(sp_to_place * share, 2)) if sp_to_place > 0 else 0.0
            else:
                if sp_to_place <= 0.01:
                    break
                put_sp = min(left_sp, sp_to_place)

            sp_left[sprint][team] = left_sp - put_sp
            sp_to_place = round(sp_to_place - put_sp, 2)
            note = ""
            if sprint != it["sprint_no"]:
                note = f"сдвиг per-специалистов: спринт {it['sprint_no']} → {sprint}"
            elif first_sprint is not None:
                note = "разбита между спринтами"
            item_hours: dict[str, float] = defaultdict(float)
            for a in sprint_ass:
                item_hours[_rl(a["role"])] += a["hours"]
            new_items.append({
                "task_id": it["task_id"], "part": it.get("part", 1), "sprint_no": sprint,
                "step_points_sp": put_sp, "team_id": team, "assignments": sprint_ass,
                "role_hours": dict(item_hours), "note": note,
            })
            placed_any = True
            first_sprint = first_sprint or sprint
            if hours_total > 0 and all(v <= 0.01 for v in hours_left.values()):
                break
            if hours_total <= 0 and sp_to_place <= 0.01:
                break
            sprint += 1

        leftover = sum(v for v in hours_left.values() if v > 0.01)
        if leftover > 0:
            partial_hh[it["task_id"]] += round(leftover, 2)

    placed_tasks = {it["task_id"] for it in new_items}
    postponed = list(draft["postponed"])
    postponed_ids = {p["task_id"] for p in postponed}
    for it in draft["items"]:
        tid = it["task_id"]
        if tid not in placed_tasks and tid not in postponed_ids:
            postponed.append({
                "task_id": tid,
                "reason": "не разместилась по лимитам специалистов до конца квартала",
            })
            postponed_ids.add(tid)

    return {**draft, "items": new_items, "postponed": postponed, "partial_hh": dict(partial_hh)}


def _heuristic_draft(tasks: dict[str, Task], engineers: list[Engineer],
                     history: list[TeamHistory], deps: list[tuple[str, str]],
                     done_ids: frozenset[str] = frozenset(),
                     first_free_sprint: int = 1) -> dict:
    """Эвристический черновик (change 026): тот же done-фильтр и суженный
    горизонт, что у solver-снапшота, — расстановка только остатка квартала."""
    todo = {tid: t for tid, t in tasks.items()
            if t.status != "Done" and tid not in done_ids}
    plan = generate_plan(
        PlannerInput(list(todo.values()), engineers, history, deps),
        first_free_sprint=first_free_sprint, strategy="metrics")
    items = []
    for s in plan.sprints:
        for it in s.items:
            items.append({
                "task_id": it.task_id,
                "sprint_no": s.sprint_no,
                "step_points_sp": it.step_points_sp or 0.0,
                "team_id": tasks[it.task_id].team_id if it.task_id in tasks else "",
                "assignments": [a.model_dump() for a in it.assignments],
            })
    return {
        "items": items,
        "postponed": [{"task_id": d.task_id, "reason": d.reason} for d in plan.decisions],
        "partial_hh": {},
        "staffing_moves": [],
        "score": None,
        "score_breakdown": [],
        "mode": "heuristic",
    }


def _sole_holders_set(engineers: list[Engineer]) -> set[str]:
    counts: dict[tuple[str, str], set[str]] = {}
    for e in engineers:
        counts.setdefault((e.team_id, _rl(e.role)), set()).add(e.engineer_id)
    return {next(iter(ids)) for ids in counts.values() if len(ids) == 1}


def repair_dependencies(draft: dict, deps: list[tuple[str, str]]) -> dict:
    """Repair (change 028): сдвиг частей зависимых задач за конец блокера.

    Timefold в редких завершениях локального поиска отдаёт раскладку, где
    зависимая часть стартует в спринте блокера — Python-валидация честно
    ловит. Вместо отказа — детерминированный сдвиг: min(parts blocked) должен
    стать > max(parts blocker); цепочки оседают итерациями. Части, сдвинутые
    за спринт 6, уходят «вне квартала» (partial_hh) — как неразмещённые
    части solver'а в _normalize_draft.
    """
    items = draft["items"]
    if not items or not deps:
        return draft

    partial = draft.setdefault("partial_hh", {})
    if partial is None:
        partial = draft["partial_hh"] = {}
    dep_of: dict[str, list[str]] = defaultdict(list)  # blocked -> blockers
    for blocking, blocked in deps:
        dep_of[blocked].append(blocking)

    for _ in range(6):
        moved = False
        task_sprints: dict[str, list[int]] = defaultdict(list)
        for it in items:
            task_sprints[it["task_id"]].append(it["sprint_no"])
        for blocked, blockers in dep_of.items():
            if blocked not in task_sprints:
                continue
            blocker_last = max(
                (max(task_sprints[b]) for b in blockers if b in task_sprints),
                default=0)
            first = min(task_sprints[blocked])
            if first > blocker_last:
                continue
            delta = blocker_last - first + 1
            for it in [x for x in items if x["task_id"] == blocked]:
                new_sprint = it["sprint_no"] + delta
                if new_sprint > SPRINTS_PER_QUARTER:
                    partial[blocked] = round(
                        partial.get(blocked, 0.0)
                        + sum((it.get("role_hours") or {}).values()), 2)
                    items.remove(it)
                else:
                    old = it["sprint_no"]
                    it["sprint_no"] = new_sprint
                    # change 056: после ступени 2 у части есть assignments — их спринт
                    # тоже сдвигается, иначе часы останутся в старом спринте
                    for a in (it.get("assignments") or []):
                        a["sprint_no"] = new_sprint
                    it["note"] = f"сдвиг по зависимости: спринт {old} → {new_sprint}"
            moved = True
        if not moved:
            break
    return draft


def validate_draft(draft: dict, tasks: dict[str, Task], engineers: list[Engineer],
                   history: list[TeamHistory], deps: list[tuple[str, str]]) -> list[str]:
    """Hard-правила (спека planning): SP-гейт, роль-гейт, зависимости, единственный носитель."""
    violations: list[str] = []
    by_team_hist: dict[str, list[TeamHistory]] = defaultdict(list)
    for h in history:
        by_team_hist[h.team_id].append(h)

    sp_by_key: dict[tuple[int, str], float] = defaultdict(float)
    hours_by_key: dict[tuple[int, str], float] = defaultdict(float)
    task_sprints: dict[str, list[int]] = defaultdict(list)
    for it in draft["items"]:
        key = (it["sprint_no"], it["team_id"])
        sp_by_key[key] += it["step_points_sp"]
        task_sprints[it["task_id"]].append(it["sprint_no"])
        # change 022: часы берём из части (pre-split), а не из всей задачи;
        # fallback на полные роль-часы — для старых черновиков без role_hours
        item_hours = it.get("role_hours")
        if item_hours is None:
            task = tasks.get(it["task_id"])
            item_hours = {_rl(r): h for r, h in (task.role_hours or {}).items()} if task else {}
        for role, h in item_hours.items():
            hours_by_key[(it["sprint_no"], _rl(role))] += h

    for (sprint, team), sp in sp_by_key.items():
        capacity = team_capacity_sp(by_team_hist.get(team, []))
        if capacity > 0 and sp > capacity + CAPACITY_TOLERANCE:
            violations.append(
                f"спринт {sprint}, команда {team}: SP {round(sp, 2)} > ёмкость {capacity}")

    avail = role_hours_available(engineers)
    for (sprint, role), hours in hours_by_key.items():
        limit = avail.get(role, 0.0)
        if limit > 0 and hours > limit + CAPACITY_TOLERANCE:
            violations.append(
                f"спринт {sprint}, роль {role}: {round(hours, 2)} ч > доступно {round(limit, 2)} ч")
        elif limit <= 0 and hours > engineer_sprint_limit(1.0):
            violations.append(
                f"спринт {sprint}, роль {role}: {round(hours, 2)} ч > виртуальный держатель 80 ч")

    last_sprint = {tid: max(sprs) for tid, sprs in task_sprints.items()}
    first_sprint = {tid: min(sprs) for tid, sprs in task_sprints.items()}
    for blocking, blocked in deps:
        if blocking in first_sprint and blocked in last_sprint:
            if first_sprint[blocked] < last_sprint[blocking] + 1:
                violations.append(
                    f"зависимость {blocking} → {blocked}: зависимая стартует в спринт "
                    f"{first_sprint[blocked]}, блокер заканчивает в {last_sprint[blocking]}")

    sole = _sole_holders_set(engineers)
    for move in draft.get("staffing_moves", []):
        if move.get("to_team_id") and move.get("to_team_id") != move.get("from_team_id") \
                and move.get("engineer_id") in sole:
            violations.append(
                f"перенос {move.get('engineer_id')}: единственный носитель компетенции "
                f"в команде {move.get('from_team_id')} не может быть перенесён")
    return violations


async def apply_draft(session, workspace_id: str, source_plan_id: str, draft: dict,
                      author_id: str) -> PlanORM:
    """Создаёт новую версию плана из черновика (strategy=optimization) и пишет переносы."""
    source = await load_plan_orm(session, source_plan_id, workspace_id)
    if not source:
        raise OptimizationError("исходный план не найден")
    tasks_map, _, _, _ = await load_world(session, workspace_id=workspace_id)

    new_orm = PlanORM(
        workspace_id=workspace_id,
        is_initial=False,
        parent_plan_id=source_plan_id,
        created_by=author_id,
        quarter_start=source.quarter_start,
        sprint_length_days=source.sprint_length_days or 14,
        strategy="optimization",
        # change 058: горизонт наследуется — иначе следующая оптимизация этой версии
        # снова планирует с 1-го спринта (факты «забываются»)
        recomputed_after_sprint=source.recomputed_after_sprint,
    )
    session.add(new_orm)
    await session.flush()

    mode = draft["mode"]
    score = draft.get("score") or {}
    score_txt = f"hard {score.get('hard')}, soft {score.get('soft')}" if score else "—"
    reason_prefix = (
        f"оптимизация (режим {mode}; score {score_txt}); источник — Timefold Solver"
        if mode == "solver"
        else "оптимизация (режим heuristic); источник — жадная метрическая стратегия"
    )

    partial_hh: dict[str, float] = draft.get("partial_hh") or {}
    partial_noted: set[str] = set()
    # change 047: выполненные по факту задачи (done_actual) переносятся в новую
    # версию — иначе после оптимизации они пропадают с ганта и из «ролей по задачам»
    source_items = (await session.execute(select(PlanItemORM).where(
        PlanItemORM.plan_id == source_plan_id))).scalars().all()
    for it in source_items:
        if it.decision == PlanDecision.done_actual.value:
            session.add(PlanItemORM(
                plan_id=new_orm.plan_id, task_id=it.task_id,
                team_id=it.team_id, decision=PlanDecision.done_actual.value,
                sprint_no=it.sprint_no, reason=it.reason,
                planned_sp=it.planned_sp, assignments=it.assignments,
            ))
    for it in draft["items"]:
        reason = f"{reason_prefix}; задача {it['task_id']} в спринт {it['sprint_no']}"
        if it.get("note"):
            reason += f"; {it['note']}"
        hh = partial_hh.get(it["task_id"], 0.0)
        if hh > 0 and it["task_id"] not in partial_noted:
            reason += f"; выполнится частично (остаток {round(hh, 1)} ч — за пределами квартала)"
            partial_noted.add(it["task_id"])
        session.add(PlanItemORM(
            plan_id=new_orm.plan_id,
            task_id=it["task_id"],
            team_id=it["team_id"],
            decision="planned",
            sprint_no=it["sprint_no"],
            reason=reason,
            planned_sp=it["step_points_sp"],
            assignments=it.get("assignments") or [],
        ))
    for d in draft["postponed"]:
        task = tasks_map.get(d["task_id"])
        reason = f"{reason_prefix}; {d['reason']}"
        hh = partial_hh.get(d["task_id"], 0.0)
        if hh > 0:
            reason += f" ({round(hh, 1)} ч не размещено в квартале)"
        session.add(PlanItemORM(
            plan_id=new_orm.plan_id,
            task_id=d["task_id"],
            team_id=task.team_id if task else "",
            decision="postponed",
            sprint_no=None,
            reason=reason,
        ))
    for move in draft.get("staffing_moves", []):
        session.add(StaffingMoveORM(
            workspace_id=workspace_id,
            plan_id=new_orm.plan_id,
            engineer_id=move.get("engineer_id", ""),
            from_team_id=move.get("from_team_id", ""),
            to_team_id=move.get("to_team_id", ""),
        ))
    await session.flush()
    return new_orm


async def run_optimization(session, workspace_id: str, plan_id: str, author_id: str,
                           require_staffing: bool) -> dict:
    """Полный проход оптимизации; результат идёт в job.result (статус готовит роут).

    change 026: снапшот/эвристика строятся от контекста текущей версии —
    выполненные по фактам и data-Done задачи исключаются, горизонт сужается
    до спринтов после recomputed_after_sprint (без фактов — 1..6, как раньше).
    """
    tasks_map, engineers, history, deps = await load_world(session, workspace_id=workspace_id)
    source = await load_plan_orm(session, plan_id, workspace_id)
    fact_rows = (await session.execute(select(SprintFactORM).where(
        SprintFactORM.workspace_id == workspace_id))).scalars().all()
    # change 058: горизонт — от максимума (поле версии, последний загруженный факт):
    # у версий-оптимизаций, созданных до 058, поле потеряно — факт надёжнее
    last_fact = max((f.sprint_no for f in fact_rows), default=0)
    first_free = max((source.recomputed_after_sprint if source else 0) or 0, last_fact) + 1
    done_ids = frozenset(
        {str(x) for f in fact_rows for x in (f.completed_task_ids or [])}
        | {t.task_id for t in tasks_map.values() if t.status == "Done"}
    )
    snapshot = build_snapshot(tasks_map, engineers, history, deps,
                              done_ids=done_ids, first_free_sprint=first_free)

    degradation_reason: str | None = None
    try:
        response = await solve_sidecar(snapshot)
        # change 029: честная оценка выполнимости (score.hard уже в ответе Java) —
        # solver, не достигший hard=0 за бюджет, означает переход в эвристику,
        # а не 422: пользователь получает план с объяснением
        hard = (response.get("score") or {}).get("hard") or 0
        if hard != 0:
            budget = settings.optimizer_solve_timeout_sec
            raise SolverUnavailable(
                f"solver не достиг выполнимости за бюджет ({round(budget, 0)} с)")
        draft = _normalize_draft(response, snapshot, tasks_map, mode="solver")
    except SolverUnavailable as e:
        degradation_reason = f"solver недоступен/неуспешен: {e}"
        logger.warning("оптимизация без solver (%s): режим эвристики", e)
        draft = _heuristic_draft(tasks_map, engineers, history, deps,
                                 done_ids=done_ids, first_free_sprint=first_free)

    if draft["mode"] == "solver":
        # repair зависимостей (change 028): страховочный слой для гэпа
        # «Java hard=0, Python нашёл нарушение» — сдвиг зависимых частей за
        # конец блокера (семантика replanning); за спринт 6 — «выполнится частично»
        draft = repair_dependencies(draft, deps)
        # change 056: нарушения черновика solver — не 422, а деградация в эвристику:
        # optimize обязан отрабатывать всегда, честная причина — в отчёте
        violations = validate_draft(draft, tasks_map, engineers, history, deps)
        if violations:
            degradation_reason = (
                f"черновик solver не прошёл валидацию ({'; '.join(violations[:3])}); "
                "режим эвристики")
            logger.warning("оптимизация: %s", degradation_reason)
            draft = _heuristic_draft(tasks_map, engineers, history, deps,
                                     done_ids=done_ids, first_free_sprint=first_free)
            draft["mode"] = "heuristic"
        else:
            # ступень 2 (change 022): закрепление часов за конкретными инженерами,
            # жадные сдвиги не влезших частей; пер-специалистов невыполнимость → сдвиг
            draft = allocate_engineers(draft, tasks_map, engineers, history)
            # change 056: сдвиги ступени 2 могли нарушить зависимости (блокер уехал
            # вперёд к зависимой) — каскадный repair ПОСЛЕ распределения, не 422
            draft = repair_dependencies(draft, deps)
            violations = validate_draft(draft, tasks_map, engineers, history, deps)
            if violations:
                degradation_reason = (
                    f"черновик solver после распределения по специалистам не прошёл "
                    f"валидацию ({'; '.join(violations[:3])}); режим эвристики")
                logger.warning("оптимизация: %s", degradation_reason)
                draft = _heuristic_draft(tasks_map, engineers, history, deps,
                                         done_ids=done_ids, first_free_sprint=first_free)
                draft["mode"] = "heuristic"

    if draft["staffing_moves"] and not require_staffing:
        raise StaffingPermissionError("черновик требует переноса людей (право plans_optimize_staffing)")

    new_orm = await apply_draft(session, workspace_id, plan_id, draft, author_id)
    await session.flush()
    report = await build_report(
        session, workspace_id, plan_id, new_orm.plan_id, draft["mode"],
        draft.get("staffing_moves", []), draft.get("score_breakdown", []),
    )
    if degradation_reason:
        report["degradation_reason"] = degradation_reason
    return {
        "plan_id": new_orm.plan_id,
        "mode": draft["mode"],
        "staffing_moves": draft.get("staffing_moves", []),
        "score": draft.get("score"),
        "score_breakdown": draft.get("score_breakdown", []),
        "report": report,
    }