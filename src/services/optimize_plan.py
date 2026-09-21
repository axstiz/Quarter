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
    part_hours: dict[tuple[str, int], dict[str, float]] = {}
    for t in snapshot["tasks"]:
        for p in t["parts"]:
            part_sp[(t["task_id"], p["part"])] = p["story_points"]
            part_hours[(t["task_id"], p["part"])] = p.get("role_hours") or {}

    items = []
    item_tasks: set[str] = set()
    for a in response.get("assignments", []):
        task_id = a["task_id"]
        part = a.get("part", 1)
        sprint = a.get("sprint")
        if not isinstance(sprint, int) or sprint not in range(1, 7):
            # solver допускает unassigned (allowsUnassigned) — такие части не «спринт 0»,
            # а вне квартала: честная причина, валидации гейтов не касаются
            continue
        item_tasks.add(task_id)
        items.append({
            "task_id": task_id,
            "part": part,
            "sprint_no": sprint,
            "step_points_sp": float(part_sp.get((task_id, part), a.get("story_points", 0.0) or 0.0)),
            "role_hours": dict(part_hours.get((task_id, part), {})),
            "team_id": a.get("team_id") or (tasks[task_id].team_id if task_id in tasks else ""),
        })
    postponed = [
        {"task_id": tid, "reason": "не попала в расстановку solver"}
        for tid in sorted(tasks)
        if tasks[tid].status != "Done" and tid not in item_tasks
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
        "staffing_moves": real_moves,
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
                "part": it.sprint_no,  # эвристика: часть = спринт размещения (для совместимости ключей)
                "sprint_no": s.sprint_no,
                "step_points_sp": it.step_points_sp or 0.0,
                "role_hours": {},  # часы уже разложены planner'ом в assignments
                "assignments": [a.model_dump() for a in it.assignments],
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


class _EngineerPool:
    """Лимиты/роли инженеров + виртуальные держатели ролей без носителей (как в planner).

    eng_used[sprint][engineer_id] — занятые часы; роль без носителей закрывается
    виртуальным держателем с полной ставкой (80 ч/спринт).
    """

    def __init__(self, engineers: list[Engineer], tasks: dict[str, Task]):
        self.limits: dict[str, float] = {}
        self.roles: dict[str, set[str]] = defaultdict(set)
        self.orig_role: dict[str, str] = {}
        for eng in engineers:
            self.limits[eng.engineer_id] = engineer_sprint_limit(eng.capacity_rate)
            norm = _rl(eng.role)
            self.roles[eng.engineer_id].add(norm)
            self.orig_role[norm] = eng.role
        all_roles = {_rl(rl): rl for t in tasks.values() for rl in (t.role_hours or {})}
        for idx, (norm, orig) in enumerate(sorted(all_roles.items())):
            if norm not in self.orig_role:
                vid = f"VIRTUAL-PM-{idx}"
                self.limits[vid] = engineer_sprint_limit(1.0)
                self.roles[vid].add(norm)
                self.orig_role[norm] = orig
        self.used: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    def holders(self, norm_role: str) -> list[str]:
        return sorted(e for e, roles in self.roles.items() if norm_role in roles)

    def place(self, norm_role: str, hours: float, sprint: int) -> tuple[float, list[dict]]:
        """Жадное заполнение (planner._put_hours): по свободному остатку лимита, детерминированно."""
        placed = 0.0
        assignments: list[dict] = []
        for eid in self.holders(norm_role):
            if placed >= hours - 1e-9:
                break
            free = self.limits[eid] - self.used[sprint][eid]
            if free <= 1e-9:
                continue
            put = min(hours - placed, free)
            self.used[sprint][eid] += put
            placed += put
            assignments.append({"engineer_id": eid, "hours": round(put, 2)})
        return round(placed, 2), assignments

    def rollback(self, placements: list[dict], sprint: int) -> None:
        for p in placements:
            self.used[sprint][p["engineer_id"]] -= p["hours"]


def _allocate_assignments(draft: dict, tasks: dict[str, Task],
                          engineers: list[Engineer], history: list[TeamHistory]) -> None:
    """022 §2.1–2.3: раскладка часов ролей частей по конкретным носителям.

    - каждая часть пытается разместиться в своём спринте (роли целиком);
    - не влезла (лимиты 80/40 заняты) — сдвиг на первый следующий спринт,
      где хватает и роли, и SP-ёмкости команды (жадные сдвиги);
    - не влезло до конца квартала — часть остаётся в своём спринте с тем,
      что поместилось, и причиной «выполнится частично (остаток N ч …)»;
      пер-специалистов невыполнимость НЕ даёт 422 — только сдвиг/частичность.
    """
    pool = _EngineerPool(engineers, tasks)
    by_team_hist: dict[str, list[TeamHistory]] = defaultdict(list)
    for h in history:
        by_team_hist[h.team_id].append(h)
    sp_left: dict[tuple[int, str], float] = {}
    for sprint in range(1, SPRINTS_PER_QUARTER + 1):
        for team in {t.team_id for t in tasks.values()}:
            sp_left[(sprint, team)] = team_capacity_sp(by_team_hist.get(team, []))

    items = sorted(draft["items"], key=lambda i: (i["sprint_no"], i["task_id"], i.get("part", 1)))
    for item in items:
        roles = {r: h for r, h in (item.get("role_hours") or {}).items() if h > 1e-9}
        item_sp = float(item.get("step_points_sp") or 0.0)
        team = item.get("team_id") or (tasks[item["task_id"]].team_id if item["task_id"] in tasks else "")
        own = int(item["sprint_no"])

        target: int | None = None
        for sprint in range(own, SPRINTS_PER_QUARTER + 1):
            if sp_left[(sprint, team)] + 1e-9 < item_sp:
                continue
            trial: list[tuple[str, list[dict]]] = []
            ok = True
            for norm_role in sorted(roles):
                placed, assigns = pool.place(norm_role, roles[norm_role], sprint)
                trial.append((norm_role, assigns))
                if placed + 1e-9 < roles[norm_role]:
                    ok = False
                    break
            if ok:
                target = sprint
                break
            for _, assigns in trial:
                pool.rollback(assigns, sprint)

        if target is not None:
            item["sprint_no"] = target
            sp_left[(target, team)] -= item_sp
            assignments: list[dict] = []
            for norm_role, assigns in trial:
                for a in assigns:
                    assignments.append({
                        "task_id": item["task_id"], "role": pool.orig_role.get(norm_role, norm_role),
                        "engineer_id": a["engineer_id"], "sprint_no": target,
                        "hours": a["hours"], "is_pinned": False,
                    })
            item["assignments"] = assignments
            continue

        # частично: в своём спринте кладём сколько влезает, остаток — за пределами квартала
        leftover = 0.0
        assignments = []
        for norm_role in sorted(roles):
            placed, assigns = pool.place(norm_role, roles[norm_role], own)
            leftover += roles[norm_role] - placed
            for a in assigns:
                assignments.append({
                    "task_id": item["task_id"], "role": pool.orig_role.get(norm_role, norm_role),
                    "engineer_id": a["engineer_id"], "sprint_no": own,
                    "hours": a["hours"], "is_pinned": False,
                })
        if assignments:
            sp_left[(own, team)] -= item_sp
        item["assignments"] = assignments
        if leftover > 0.05:
            item["partial_leftover_hours"] = round(leftover, 2)


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
        assignments = it.get("assignments") or []
        reason = f"{reason_prefix}; задача {it['task_id']} в спринт {it['sprint_no']}"
        leftover = it.get("partial_leftover_hours")
        if leftover:
            # 022 §2.2: пер-специалистов невыполнимость — честная частичность, не ошибка
            reason += f"; выполнится частично (остаток {leftover} ч — за пределами квартала)"
        session.add(PlanItemORM(
            plan_id=new_orm.plan_id,
            task_id=it["task_id"],
            team_id=it["team_id"],
            decision="planned",
            sprint_no=it["sprint_no"],
            reason=reason,
            planned_sp=it["step_points_sp"],
            assignments=[dict(a) for a in assignments],
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
        # 022: пер-специалистов раскладка после solve (сдвиги/частичность — не 422)
        _allocate_assignments(draft, tasks_map, engineers, history)

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