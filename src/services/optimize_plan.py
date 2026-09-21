"""Оркестрация оптимизации плана (change 018, задачи 2.2–2.5).

Жизненный цикл: снапшот → доверить сайдкару (solver) или жадной метрической
стратегии (эвристика при недоступности sidecar) → валидация черновика
hard-правилами → новая версия плана (strategy=optimization) → отчёт метрик
до/после + применённые переносы + score-разбивка.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from sqlalchemy import select

from src.db.models import PlanItemORM, PlanORM, SprintFactORM, StaffingMoveORM
from src.domain.models import SPRINTS_PER_QUARTER
from src.domain.models import Engineer, Explanation, Plan, PlanDecision, PlanItem, SprintPlan, Task, TeamHistory
from src.services.capacity import team_capacity_sp
from src.services.metrics import compute_metrics_initiatives
from src.services.optimizer_client import SolverUnavailable, build_snapshot, role_hours_available, solve_sidecar
from src.services.planner import PlannerInput, _rl, engineer_sprint_limit, generate_plan

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
    }


def _normalize_draft(response: dict, snapshot: dict, tasks: dict[str, Task],
                     mode: str) -> dict:
    """Черновик solver (assignments по part_id) → единая структура items/postponed."""
    part_sp: dict[tuple[str, int], float] = {}
    for t in snapshot["tasks"]:
        for p in t["parts"]:
            part_sp[(t["task_id"], p["part"])] = p["story_points"]

    items = []
    item_tasks: set[str] = set()
    for a in response.get("assignments", []):
        task_id = a["task_id"]
        part = a.get("part", 1)
        item_tasks.add(task_id)
        items.append({
            "task_id": task_id,
            "sprint_no": a["sprint"],
            "step_points_sp": float(part_sp.get((task_id, part), a.get("story_points", 0.0) or 0.0)),
            "team_id": a.get("team_id") or (tasks[task_id].team_id if task_id in tasks else ""),
        })
    postponed = [
        {"task_id": tid, "reason": "не попала в расстановку solver"}
        for tid in sorted(tasks)
        if tasks[tid].status != "Done" and tid not in item_tasks
    ]
    return {
        "items": items,
        "postponed": postponed,
        "staffing_moves": response.get("staffing_moves", []),
        "score": response.get("score"),
        "score_breakdown": response.get("score_breakdown", []),
        "mode": mode,
    }


def _heuristic_draft(tasks: dict[str, Task], engineers: list[Engineer],
                     history: list[TeamHistory], deps: list[tuple[str, str]]) -> dict:
    plan = generate_plan(PlannerInput(list(tasks.values()), engineers, history, deps), strategy="metrics")
    items = []
    for s in plan.sprints:
        for it in s.items:
            items.append({
                "task_id": it.task_id,
                "sprint_no": s.sprint_no,
                "step_points_sp": it.step_points_sp or 0.0,
                "team_id": tasks[it.task_id].team_id if it.task_id in tasks else "",
            })
    return {
        "items": items,
        "postponed": [{"task_id": d.task_id, "reason": d.reason} for d in plan.decisions],
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
        task = tasks.get(it["task_id"])
        if task:
            for role, h in (task.role_hours or {}).items():
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

    for it in draft["items"]:
        session.add(PlanItemORM(
            plan_id=new_orm.plan_id,
            task_id=it["task_id"],
            team_id=it["team_id"],
            decision="planned",
            sprint_no=it["sprint_no"],
            reason=f"{reason_prefix}; задача {it['task_id']} в спринт {it['sprint_no']}",
            planned_sp=it["step_points_sp"],
        ))
    for d in draft["postponed"]:
        task = tasks_map.get(d["task_id"])
        session.add(PlanItemORM(
            plan_id=new_orm.plan_id,
            task_id=d["task_id"],
            team_id=task.team_id if task else "",
            decision="postponed",
            sprint_no=None,
            reason=f"{reason_prefix}; {d['reason']}",
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
    """Полный проход оптимизации; результат идёт в job.result (статус готовит роут)."""
    tasks_map, engineers, history, deps = await load_world(session, workspace_id=workspace_id)
    snapshot = build_snapshot(tasks_map, engineers, history, deps)

    try:
        response = await solve_sidecar(snapshot)
        draft = _normalize_draft(response, snapshot, tasks_map, mode="solver")
    except SolverUnavailable as e:
        logger.warning("оптимизация без solver (%s): режим эвристики", e)
        draft = _heuristic_draft(tasks_map, engineers, history, deps)

    if draft["mode"] == "solver":
        violations = validate_draft(draft, tasks_map, engineers, history, deps)
        if violations:
            raise DraftValidationError("; ".join(violations[:5]))

    if draft["staffing_moves"] and not require_staffing:
        raise StaffingPermissionError("черновик требует переноса людей (право plans_optimize_staffing)")

    new_orm = await apply_draft(session, workspace_id, plan_id, draft, author_id)
    await session.flush()
    report = await build_report(
        session, workspace_id, plan_id, new_orm.plan_id, draft["mode"],
        draft.get("staffing_moves", []), draft.get("score_breakdown", []),
    )
    return {
        "plan_id": new_orm.plan_id,
        "mode": draft["mode"],
        "staffing_moves": draft.get("staffing_moves", []),
        "score": draft.get("score"),
        "score_breakdown": draft.get("score_breakdown", []),
        "report": report,
    }