from __future__ import annotations

import logging
import tempfile
import uuid

from collections import defaultdict
from datetime import date, timedelta

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.importer import import_dataset, reset_dataset_tables
from src.db.models import (
    AdviceReportORM,
    DependencyORM,
    EngineerORM,
    OptimizationJobORM,
    PlanItemORM,
    PlanORM,
    ReferenceValueORM,
    RoleRequirementORM,
    SprintFactORM,
    TaskORM,
    TeamHistoryORM,
)
from src.api.context import Context, require_context
from src.api.permissions import require_permission
from src.db.session import get_session
from src.domain.models import (
    SPRINTS_PER_QUARTER,
    Assignment,
    Engineer,
    Explanation,
    PersonPlanResponse,
    PersonScheduleItem,
    PinRequest,
    Plan,
    PlanDecision,
    PlanItem,
    SprintPlan,
    Task,
    TeamHistory,
)
from src.core.calendar import calculate_quarter_start, get_sprint_dates
from src.services.capacity import team_capacity_sp
from src.services.planner import PlannerInput, generate_plan
from src.services.replanner import (
    WARN_COMPOSITION_CHANGE,
    WARN_DEADLINE_OVERFLOW,
    WARN_DEPENDENCY_SHIFT,
    WARN_GRADE_DEFICIT,
    WARN_ROLE_DEFICIT,
    compute_warnings,
)

router = APIRouter(prefix="/api/v1")
logger = logging.getLogger(__name__)


async def load_world(session, workspace_id: str = "default") -> tuple[dict[str, Task], list, list, dict]:
    rows = (await session.execute(select(TaskORM).where(TaskORM.workspace_id == workspace_id))).scalars().all()
    role_reqs = (await session.execute(select(RoleRequirementORM).where(
        RoleRequirementORM.workspace_id == workspace_id, RoleRequirementORM.hours > 0
    ))).scalars().all()
    deps_rows = (await session.execute(select(DependencyORM).where(DependencyORM.workspace_id == workspace_id))).scalars().all()
    eng_rows = (await session.execute(select(EngineerORM).where(EngineerORM.workspace_id == workspace_id))).scalars().all()
    hist_rows = (await session.execute(select(TeamHistoryORM).where(TeamHistoryORM.workspace_id == workspace_id))).scalars().all()

    tasks: dict[str, Task] = {}
    for r in rows:
        tasks[r.task_id] = Task(
            task_id=r.task_id,
            parent_id=r.parent_id,
            team_id=r.team_id,
            summary=r.summary,
            status=r.status,
            priority=float(r.priority),
            spent_time=float(r.spent_time or 0.0),
            estimation_sp=r.estimation_sp,
            estimated_hh=r.estimated_hh,
            role_hours={},
            planned_start=r.planned_start,
            planned_end=r.planned_end,
            actual_start=r.actual_start,
            actual_end=r.actual_end,
        )
    for r in role_reqs:
        if r.task_id in tasks:
            tasks[r.task_id].role_hours[r.role] = (tasks[r.task_id].role_hours.get(r.role) or 0.0) + r.hours

    engineers = [
        Engineer(engineer_id=e.engineer_id, team_id=e.team_id, role=e.role, grade=e.grade,
                 skills_declared=e.skills_declared, capacity_rate=e.capacity_rate)
        for e in eng_rows
    ]
    history = [
        TeamHistory(team_id=h.team_id, snapshot_date=str(h.snapshot_date),
                    velocity_achieved=h.velocity_achieved, planned_sp=h.planned_sp)
        for h in hist_rows
    ]
    deps = [(d.blocking_task_id, d.blocked_task_id) for d in deps_rows]
    return tasks, engineers, history, deps


def _plan_from_orm(plan_id: str, items: list[PlanItemORM]) -> Plan:
    plan = Plan(plan_id=plan_id)
    by_sprint: dict[int, SprintPlan] = {}
    for it in items:
        if it.decision == PlanDecision.planned.value:
            bucket = by_sprint.setdefault(it.sprint_no or 0, SprintPlan(
                sprint_no=it.sprint_no or 0,
                items=[],
            ))
            ass_list = [Assignment(**a) for a in (it.assignments or [])] if isinstance(it.assignments, list) else []
            bucket.items.append(PlanItem(
                task_id=it.task_id,
                decision=PlanDecision.planned,
                sprint_no=it.sprint_no,
                reason=it.reason,
                step_points_sp=it.planned_sp,
                assignments=ass_list,
                pinned_sprint=it.pinned_sprint,
                pinned_engineer_id=it.pinned_engineer_id,
                pinned_position=it.pinned_position,
                team_id=it.team_id or "",
            ))
        else:
            plan.decisions.append(Explanation(
                task_id=it.task_id,
                decision=it.decision,  # type: ignore[arg-type]
                sprint_no=it.sprint_no,
                reason=it.reason,
            ))
    plan.sprints = [by_sprint[k] for k in sorted(by_sprint)]
    return plan


async def get_plan_orm(session, plan_id: str, workspace_id: str | None = None) -> PlanORM | None:
    q = select(PlanORM).where(PlanORM.plan_id == plan_id)
    if workspace_id is not None:
        q = q.where(PlanORM.workspace_id == workspace_id)
    return (await session.execute(q)).scalar_one_or_none()


async def get_plan_items(session, plan_id: str) -> list[PlanItemORM]:
    rows = (await session.execute(select(PlanItemORM).where(PlanItemORM.plan_id == plan_id))).scalars().all()
    return rows


@router.post("/plans/generate", status_code=201)
async def generate_plan_endpoint(
    body: dict | None = None,
    ctx: Context = Depends(require_permission("plans_generate")),
) -> dict:
    workspace_id = ctx.workspace_id
    strategy = (body or {}).get("strategy", "priority")
    if strategy not in ("priority", "metrics"):
        raise HTTPException(status_code=422, detail=f"неизвестная стратегия: {strategy}")

    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=workspace_id)
    if not tasks:
        raise HTTPException(status_code=400, detail="нет данных в базе; сначала POST /api/v1/data/import")
    plan = generate_plan(PlannerInput(list(tasks.values()), engineers, history, deps), strategy=strategy)
    q_start = calculate_quarter_start(list(tasks.values()))
    plan_orm = PlanORM(workspace_id=workspace_id, is_initial=True, quarter_start=q_start, sprint_length_days=14, created_by=ctx.user.id, strategy=strategy)
    ctx.session.add(plan_orm)
    await ctx.session.flush()
    for sprint in plan.sprints:
        for item in sprint.items:
            ass_data = [a.model_dump() for a in item.assignments] if item.assignments else []
            ctx.session.add(PlanItemORM(
                plan_id=plan_orm.plan_id,
                workspace_id=workspace_id,
                task_id=item.task_id,
                team_id=tasks[item.task_id].team_id if item.task_id in tasks else "",
                decision=item.decision.value,
                sprint_no=item.sprint_no,
                reason=item.reason,
                planned_sp=item.step_points_sp,
                assignments=ass_data,
                pinned_sprint=item.pinned_sprint,
                pinned_engineer_id=item.pinned_engineer_id,
                pinned_position=item.pinned_position,
            ))
    for d in plan.decisions:
        ctx.session.add(PlanItemORM(
            plan_id=plan_orm.plan_id,
            workspace_id=workspace_id,
            task_id=d.task_id,
            team_id=tasks[d.task_id].team_id if d.task_id in tasks else "",
            decision=d.decision.value,
            sprint_no=None,
            reason=d.reason,
        ))
    await ctx.session.commit()
    return {"plan_id": plan_orm.plan_id, "strategy": strategy, "sprints": {str(s.sprint_no): [i.task_id for i in sorted(
        s.items, key=lambda x: x.task_id)] for s in plan.sprints}}


@router.get("/plans/{plan_id}")
async def get_plan(plan_id: str, ctx: Context = Depends(require_context)) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    plan = _plan_from_orm(plan_id, items)
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)

    q_start = plan_orm.quarter_start or calculate_quarter_start(list(tasks.values()))
    s_length = plan_orm.sprint_length_days or 14
    sprint_dates_map = get_sprint_dates(q_start, s_length)

    task_sprints: dict[str, list[int]] = defaultdict(list)
    for s in plan.sprints:
        for item in s.items:
            task_sprints[item.task_id].append(s.sprint_no)
    def _with_task(i) -> dict:
        task = tasks.get(i.task_id)
        base = i.model_dump()
        s_list = task_sprints.get(i.task_id, [])
        forecast = None
        if s_list:
            min_s, max_s = min(s_list), max(s_list)
            forecast = {
                "start": sprint_dates_map[str(min_s)]["start"],
                "end": sprint_dates_map[str(max_s)]["end"],
            }
        base.update({
            "task_id": i.task_id,
            "summary": task.summary if task else "",
            "parent_id": task.parent_id if task else None,
            "estimation_sp": task.estimation_sp if task else 0.0,
            "estimated_hh": task.estimated_hh if task else 0.0,
            "planned_in_sprint": (task.status != "Done") if task else False,
            # change 048: team_id — команда-исполнитель части (solver может отдать
            # часть другой команде); команда-владелец задачи — owner_team_id
            "team_id": i.team_id or (task.team_id if task else ""),
            "owner_team_id": task.team_id if task else "",
            "role_hours": task.role_hours if task else {},
            "date_forecast": forecast,
        })
        return base
    return {
        "plan_id": plan_id,
        "parent_plan_id": plan_orm.parent_plan_id,
        "is_initial": plan_orm.is_initial,
        "recomputed_after_sprint": plan_orm.recomputed_after_sprint,
        "quarter_start": q_start.isoformat(),
        "sprint_dates": sprint_dates_map,
        "sprints": [{"sprint_no": s.sprint_no,
                     "tasks": [_with_task(i) for i in s.items]}
                    for s in plan.sprints],
        "not_planned": [d.model_dump() for d in plan.decisions],
    }


@router.get("/data/status")
async def data_status(ctx: Context = Depends(require_context)) -> dict:
    """change 035: лёгкий статус «датасет загружен?» для текущего workspace —
    план/факт/карта закрыты редиректом на /data, пока tasks нет (гейтинг 021)."""
    from sqlalchemy import func, select
    from src.db.models import TaskORM

    total = (await ctx.session.execute(select(func.count()).select_from(TaskORM).where(
        TaskORM.workspace_id == ctx.workspace_id))).scalar_one()
    return {"dataset_loaded": total > 0, "tasks": int(total)}


@router.post("/data/import")
async def data_import(ctx: Context = Depends(require_permission("import_data"))) -> dict:
    from src.core.config import settings

    workspace_id = ctx.workspace_id
    await reset_dataset_tables(ctx.session, workspace_id=workspace_id)
    counts = await import_dataset(ctx.session, settings.dataset_dir, workspace_id=workspace_id)
    return {"status": "imported", "counts": counts}


# --- онбординг (change 002): upload → job → answers → confirm ----------

JOBS_TMP_DIR = Path(tempfile.gettempdir()) / "planner-uploads"
JOBS_TMP_DIR.mkdir(exist_ok=True)


@router.post("/data/upload", status_code=201)
async def data_upload(file: UploadFile = File(...), ctx: Context = Depends(require_permission("import_data"))) -> dict:
    """Загрузка файла xlsx/csv/json в пайплайн normalization.

    Redis/воркер: job ставится в очередь (статус uploaded → mapping → …).
    Деградация: нет Redis или JOBS_MODE=sync → тот же пайплайн в процессе.
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".xlsx", ".csv", ".json"):
        raise HTTPException(status_code=422, detail=f"поддерживаются xlsx/csv/json, получен {suffix}")
    dest = JOBS_TMP_DIR / f"{uuid.uuid4().hex}{suffix}"
    dest.write_bytes(await file.read())
    from src.ai.pipelines.normalization import new_job, save_job_db
    from src.ai.jobs_worker import get_queue
    from src.ai.pipelines import normalization as _norm

    try:
        job = _norm.UploadJob(uuid.uuid4().hex, file.filename or dest.name, dest)
        job.workspace_id = ctx.workspace_id
        await save_job_db(ctx.session, job)  # сохраняем как uploaded — до постановки задачи
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"не удалось разобрать файл: {e}")

    queue = await get_queue()
    if queue is not None:
        try:
            await queue.enqueue_job("run_normalization", job.job_id)
            return job.snapshot()
        except Exception as e:
            logger.warning("enqueue не удался (%s): обработка синхронно", e)
    # деградация: синхронный прогон
    from src.ai.pipelines.normalization import run_stage_async, save_job_db as _save
    try:
        await run_stage_async(job)
        await _save(ctx.session, job)
    except Exception as e:
        from src.ai.pipelines.normalization import get_job_db

        job.status = "failed"
        await _save(ctx.session, job)
        raise HTTPException(status_code=422, detail=f"не удалось обработать файл: {e}")
    return job.snapshot()


@router.get("/data/jobs/{job_id}")
async def job_status(job_id: str, ctx: Context = Depends(require_context)) -> dict:
    from src.ai.pipelines.normalization import get_job_db

    job = await get_job_db(ctx.session, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job не найден")
    if job.workspace_id != ctx.workspace_id:
        raise HTTPException(status_code=404, detail="job не найден")
    return job.snapshot()


@router.post("/data/jobs/{job_id}/answers")
async def job_answers(job_id: str, body: dict, ctx: Context = Depends(require_permission("import_data"))) -> dict:
    """Ответы на вопросы маппинга: {колонка: "entity.field" | "пропустить"}"""
    from src.ai.pipelines.normalization import get_job_db, run_stage_async, save_job_db

    job = await get_job_db(ctx.session, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job не найден")
    if job.workspace_id != ctx.workspace_id:
        raise HTTPException(status_code=404, detail="job не найден")
    answers = body.get("answers", {})
    try:
        await run_stage_async(job, answers)
        await save_job_db(ctx.session, job)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return job.snapshot()


@router.post("/data/jobs/{job_id}/confirm")
async def job_confirm(job_id: str, ctx: Context = Depends(require_permission("import_data"))) -> dict:
    """Импорт в БД с merge-правилами (manual не затирается)."""
    from src.ai.pipelines.normalization import get_job_db, save_job_db
    from src.db.staging import stage_import

    job = await get_job_db(ctx.session, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job не найден")
    if job.workspace_id != ctx.workspace_id:
        raise HTTPException(status_code=404, detail="job не найден")
    if job.status != "ready":
        raise HTTPException(status_code=409, detail=f"job не готов ({job.status})")
    try:
        counts = await stage_import(ctx.session, job, workspace_id=ctx.workspace_id)
    except Exception as e:
        await ctx.session.rollback()
        raise HTTPException(status_code=422, detail=f"ошибка импорта: {e}")
    job.status = "confirmed"
    await save_job_db(ctx.session, job)
    return {"status": "confirmed", "counts": counts}


@router.post("/ai/normalize/{job_id}")
async def ai_rerun(job_id: str, ctx: Context = Depends(require_permission("import_data"))) -> dict:
    """Повторный прогон пайплайна (после ответов или без них)."""
    from src.ai.pipelines.normalization import get_job_db, run_stage_async, save_job_db

    job = await get_job_db(ctx.session, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job не найден")
    if job.workspace_id != ctx.workspace_id:
        raise HTTPException(status_code=404, detail="job не найден")
    await run_stage_async(job)
    await save_job_db(ctx.session, job)
    return job.snapshot()




@router.post("/plans/{plan_id}/sprints/{sprint_no}/facts")
async def load_facts(plan_id: str, sprint_no: int, body: dict,
                     ctx: Context = Depends(require_permission("sprint_facts"))) -> dict:
    if not 1 <= sprint_no <= SPRINTS_PER_QUARTER:
        raise HTTPException(status_code=422, detail=f"sprint_no должен быть 1..{SPRINTS_PER_QUARTER}")
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail="план не найден")
    chain_ids = await _plan_chain_ids(ctx.session, plan_id)
    exists = (await ctx.session.execute(select(SprintFactORM).where(
        SprintFactORM.plan_id.in_(chain_ids), SprintFactORM.sprint_no == sprint_no))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="факт этого спринта уже загружен")

    fact = SprintFactORM(
        plan_id=plan_id,
        workspace_id=ctx.workspace_id,
        sprint_no=sprint_no,
        completed_sp=float(body.get("completed_sp", 0.0)),
        completed_task_ids=body.get("completed_task_ids", []),
        role_hours_fact=body.get("role_hours_fact", {}),
        notes=body.get("notes", ""),
        author_id=ctx.user.id,
    )
    ctx.session.add(fact)
    await ctx.session.commit()
    try:
        new_plan = await _recompute_plan_version(ctx.session, plan_id, sprint_no, ctx.workspace_id, ctx.user.id)
    except Exception as e:
        await ctx.session.rollback()
        raise HTTPException(status_code=422, detail=f"пересчёт не удался: {e}")
    return {"status": "accepted", "plan_id": plan_id, "sprint_no": sprint_no,
            "new_plan_id": new_plan.plan_id if new_plan else plan_id}


async def _recompute_plan_version(session, plan_id: str, after_sprint: int, workspace_id: str = "default", author_id: str = "system"):
    """Создаёт новую версию плана: факты проведены, остаток квартала
    перераспределяется planner'ом (SP/color/роли, заём, разбитие).
    Возвращает новую PlanORM с parent-ссылкой; отдаёт child plan_id."""
    tasks, engineers, history, deps = await load_world(session, workspace_id=workspace_id)
    parent_plan = await get_plan_orm(session, plan_id, workspace_id)
    q_start = parent_plan.quarter_start if (parent_plan and parent_plan.quarter_start) else calculate_quarter_start(list(tasks.values()))
    s_length = parent_plan.sprint_length_days if (parent_plan and parent_plan.sprint_length_days) else 14
    current_items = (await session.execute(select(PlanItemORM).where(
        PlanItemORM.plan_id == plan_id))).scalars().all()
    facts = (await session.execute(select(SprintFactORM).where(
        SprintFactORM.plan_id.in_(await _plan_chain_ids(session, plan_id))))).scalars().all()
    done_ids: set[str] = {str(x) for f in facts for x in (f.completed_task_ids or [])}
    # выполненные задачи также те, что в данных уже Done
    done_ids |= {t.task_id for t in tasks.values() if t.status == "Done"}

    first_free = max(after_sprint, 0) + 1
    # change 032: пины текущей версии применяются при пересчёте (pre-occupancy
    # спеки 016), а не при pin/unpin — здесь единственное место их применения
    pins: dict[str, dict] = {}
    for it in current_items:
        if it.pinned_sprint is not None and it.task_id not in done_ids:
            pins[it.task_id] = {
                "sprint_no": it.pinned_sprint,
                "engineer_id": it.pinned_engineer_id,
                "position": it.pinned_position,
            }
    new_orm = PlanORM(
        workspace_id=workspace_id,
        is_initial=False,
        parent_plan_id=plan_id,
        recomputed_after_sprint=after_sprint,
        created_by=author_id,
        quarter_start=q_start,
        sprint_length_days=s_length,
    )
    session.add(new_orm)
    await session.flush()
    planner_in = PlannerInput(
        [t for t in tasks.values() if t.task_id not in done_ids and t.status != "Done"],
        engineers, history, deps,
        spent_time={tid: t.spent_time for tid, t in tasks.items()},
    )
    child = generate_plan(planner_in, first_free_sprint=first_free, pins=pins or None)

    for item in current_items:
        if item.task_id in done_ids and item.decision == PlanDecision.planned.value:
            session.add(PlanItemORM(
                plan_id=new_orm.plan_id, task_id=item.task_id,
                team_id=item.team_id, decision=PlanDecision.done_actual.value,
                sprint_no=item.sprint_no, reason="выполнено по факту спринта",
                planned_sp=item.planned_sp,
            ))
    for sprint in child.sprints:
        for it in sprint.items:
            session.add(PlanItemORM(
                plan_id=new_orm.plan_id, task_id=it.task_id,
                team_id=tasks[it.task_id].team_id if it.task_id in tasks else "",
                decision=it.decision.value, sprint_no=it.sprint_no,
                reason=it.reason, planned_sp=it.step_points_sp,
            ))
    for d in child.decisions:
        session.add(PlanItemORM(
            plan_id=new_orm.plan_id, task_id=d.task_id,
            team_id=tasks[d.task_id].team_id if d.task_id in tasks else "",
            decision=d.decision.value, sprint_no=None, reason=d.reason,
            planned_sp=None,
        ))
    await session.commit()
    return new_orm


@router.post("/plans/{plan_id}/recompute")
async def recompute_endpoint(plan_id: str, after_sprint: int = 0,
                             ctx: Context = Depends(require_permission("recompute"))) -> dict:
    """Кнопка «Пересчитать»: создаёт новую версию плана (снапшот-цепочка)."""
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail="план не найден")
    if not 0 <= after_sprint <= SPRINTS_PER_QUARTER:
        raise HTTPException(status_code=422, detail=f"after_sprint должна быть 0..{SPRINTS_PER_QUARTER}")
    try:
        new_plan = await _recompute_plan_version(ctx.session, plan_id, after_sprint, ctx.workspace_id, ctx.user.id)
    except Exception as e:
        await ctx.session.rollback()
        raise HTTPException(status_code=422, detail=f"пересчёт не удался: {e}")
    return {"status": "recomputed", "new_plan_id": new_plan.plan_id,
            "parent_plan_id": plan_id, "after_sprint": after_sprint}


# --- оптимизация плана (change 018, задачи 2.1–2.5) -----------------------

ACTIVE_JOB_STATUSES = ("queued", "solving")


@router.post("/plans/optimize")
async def optimize_plan_endpoint(body: dict | None = None,
                                 ctx: Context = Depends(require_permission("plans_optimize"))) -> dict:
    """Запуск job оптимизации текущей версии: queued → solving → ready | failed.

    ready создаёт новую версию плана (strategy=optimization) и возвращает plan_id.
    Переносы людей в черновике требуют права plans_optimize_staffing (admin).
    """
    from src.services.optimize_plan import (
        DraftValidationError,
        StaffingPermissionError,
        run_optimization,
    )

    plan_id = (body or {}).get("plan_id")
    if not plan_id:
        raise HTTPException(status_code=422, detail="plan_id обязателен")
    ws = ctx.workspace_id
    if not await get_plan_orm(ctx.session, plan_id, ws):
        raise HTTPException(status_code=404, detail="план не найден")

    active = (await ctx.session.execute(select(OptimizationJobORM).where(
        OptimizationJobORM.workspace_id == ws,
        OptimizationJobORM.status.in_(ACTIVE_JOB_STATUSES),
    ))).scalars().first()
    if active is not None:
        raise HTTPException(status_code=409, detail="оптимизация уже выполняется")

    job = OptimizationJobORM(workspace_id=ws, plan_id=plan_id, status="queued")
    ctx.session.add(job)
    await ctx.session.commit()
    await ctx.session.refresh(job)

    # change 028: очередь (Redis + JOBS_MODE=auto|queue) — solve вне HTTP-запроса;
    # права и автор вычислены здесь, воркер только исполняет
    from src.ai.jobs_worker import get_queue

    queue = await get_queue()
    if queue is not None:
        try:
            await queue.enqueue_job("run_optimization_job", job.job_id,
                                    author_id=ctx.user.id,
                                    require_staffing=(ctx.role == "admin"))
            return {"status": "queued", "job_id": job.job_id, "mode": None,
                    "plan_id": None, "error": None, "report": None,
                    "staffing_moves": [], "score": None, "score_breakdown": []}
        except Exception as e:
            logger.warning("enqueue optimize не удался (%s): solve синхронно", e)

    job.status = "solving"
    await ctx.session.commit()

    try:
        result = await run_optimization(
            ctx.session, ws, plan_id, ctx.user.id, require_staffing=(ctx.role == "admin"))
    except DraftValidationError as e:
        job.status = "failed"
        job.error = f"валидация черновика solver не прошла: {e}"
        await ctx.session.commit()
        raise HTTPException(status_code=422, detail={
            "error": job.error, "job_id": job.job_id,
        })
    except StaffingPermissionError as e:
        job.status = "failed"
        job.error = str(e)
        await ctx.session.commit()
        raise HTTPException(
            status_code=403,
            detail="Отказано в доступе: требуется разрешение 'plans_optimize_staffing'",
        )
    except Exception as e:
        logger.exception("оптимизация %s упала", plan_id)
        job.status = "failed"
        job.error = str(e)
        await ctx.session.commit()
        raise HTTPException(status_code=500, detail=f"оптимизация не удалась: {e}")

    job.status = "ready"
    job.mode = result["mode"]
    job.result = result
    job.plan_id = plan_id
    await ctx.session.commit()
    return {
        "status": "ready", "job_id": job.job_id,
        "plan_id": result["plan_id"], "mode": result["mode"],
    }


@router.get("/plans/optimize/{job_id}")
async def optimize_job_status(job_id: str, ctx: Context = Depends(require_context)) -> dict:
    """Статус job + результат: отчёт до/после, переносы, score-разбивка."""
    job = (await ctx.session.execute(select(OptimizationJobORM).where(
        OptimizationJobORM.job_id == job_id))).scalar_one_or_none()
    if not job or job.workspace_id != ctx.workspace_id:
        raise HTTPException(status_code=404, detail="job не найден")
    result = job.result or {}
    return {
        "job_id": job.job_id,
        "status": job.status,
        "mode": job.mode,
        "error": job.error or None,
        "plan_id": result.get("plan_id"),
        "report": result.get("report"),
        "staffing_moves": result.get("staffing_moves", []),
        "score": result.get("score"),
        "score_breakdown": result.get("score_breakdown", []),
        "created_at": str(job.created_at),
        "updated_at": str(job.updated_at),
    }


def _recomputed_plan(plan_before: Plan, done_task_ids: set[str]) -> Plan:
    """Виртуальный план после факта: выполненные — done_actual; недоделанные
    сдвигаются на спринт позже (или postponed за пределами квартала)."""
    after = Plan(plan_id=plan_before.plan_id)
    for sprint in plan_before.sprints:
        for item in sprint.items:
            if item.task_id in done_task_ids:
                bucket = next((s for s in after.sprints if s.sprint_no == item.sprint_no), None)
                if bucket is None:
                    bucket = SprintPlan(sprint_no=item.sprint_no or 0, items=[])
                    after.sprints.append(bucket)
                bucket.items.append(item.model_copy(update={
                    "decision": PlanDecision.done_actual,
                    "reason": "выполнено по факту спринта",
                }))
                continue
            new_no = (item.sprint_no or 0) + 1
            reason = "не выполнено в плановом спринте, сдвигается"
            if new_no > SPRINTS_PER_QUARTER:
                after.decisions.append(Explanation(
                    task_id=item.task_id,
                    decision=PlanDecision.postponed,
                    reason="выполнение выходит за пределы квартала",
                ))
                continue
            bucket = next((s for s in after.sprints if s.sprint_no == new_no), None)
            if bucket is None:
                bucket = SprintPlan(sprint_no=new_no, items=[])
                after.sprints.append(bucket)
            bucket.items.append(item.model_copy(update={
                "decision": PlanDecision.planned,
                "sprint_no": new_no,
                "reason": reason,
            }))
    after.sprints.sort(key=lambda s: s.sprint_no)
    return after


async def _latest_child_orm(session, plan_id: str) -> PlanORM | None:
    """Последняя версия плана, пересчитанная из данной (child в цепочке)."""
    rows = (await session.execute(select(PlanORM).where(
        PlanORM.parent_plan_id == plan_id
    ).order_by(PlanORM.created_at.desc()))).scalars().all()
    return rows[0] if rows else None


@router.get("/plans/{plan_id}/warnings")
async def plan_warnings(plan_id: str, ctx: Context = Depends(require_context)) -> list[dict]:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    plan_before = _plan_from_orm(plan_id, items)
    facts = (await ctx.session.execute(select(SprintFactORM).where(SprintFactORM.plan_id.in_(await _plan_chain_ids(ctx.session, plan_id))))).scalars().all()
    done_task_ids: set[str] = set()
    for f in facts:
        done_task_ids.update(str(x) for x in (f.completed_task_ids or []))
    # если уже есть пересчитанная версия (child) — риски считаем от неё,
    # а не от виртуального сдвига
    child = await _latest_child_orm(ctx.session, plan_id)
    if child is not None:
        after = _plan_from_orm(child.plan_id, await get_plan_items(ctx.session, child.plan_id))
    else:
        after = _recomputed_plan(plan_before, done_task_ids)
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    from src.services.replanner import compute_warnings

    q_start = plan_orm.quarter_start or calculate_quarter_start(list(tasks.values()))
    warnings = compute_warnings(plan_before, after, sorted(done_task_ids), tasks, deps, engineers, quarter_start=q_start)
    out = [w.model_dump() for w in warnings]
    # причины расхождений из справочника reference_values (change 011, tasks 3.1/3.2)
    cat_rows = (await ctx.session.execute(select(ReferenceValueORM).where(
        ReferenceValueORM.category == "deviation_reason",
        ReferenceValueORM.workspace_id == ctx.workspace_id,
    ))).scalars().all()
    from src.services.reasons import attach_reason_categories

    return attach_reason_categories(out, [r.value for r in cat_rows if r.value != "Причины расхождения планов заказчика и исполнителя"])


@router.get("/plans/{plan_id}/diff")
async def plan_diff(plan_id: str, ctx: Context = Depends(require_context)) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    plan_before = _plan_from_orm(plan_id, items)
    facts = (await ctx.session.execute(select(SprintFactORM).where(SprintFactORM.plan_id.in_(await _plan_chain_ids(ctx.session, plan_id))))).scalars().all()
    done_task_ids = {tid for f in facts for tid in (f.completed_task_ids or [])}
    child = await _latest_child_orm(ctx.session, plan_id)
    if child is not None:
        after = _plan_from_orm(child.plan_id, await get_plan_items(ctx.session, child.plan_id))
    else:
        after = _recomputed_plan(plan_before, done_task_ids)
    before_of = {i.task_id: s.sprint_no for s in plan_before.sprints for i in s.items}
    after_of = {i.task_id: s.sprint_no for s in after.sprints for i in s.items}
    shifted = [
        {"task_id": tid, "from_sprint": before_of[tid], "to_sprint": after_of[tid]}
        for tid in after_of
        if tid in before_of and after_of[tid] > before_of[tid]
    ]
    not_planned_new = [d.task_id for d in after.decisions if d.task_id not in before_of]
    return {"moved": shifted, "postponed_now": not_planned_new}


@router.get("/plans/{plan_id}/metrics")
async def plan_metrics(plan_id: str, ctx: Context = Depends(require_context)) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    plan = _plan_from_orm(plan_id, items)
    facts = (await ctx.session.execute(select(SprintFactORM).where(SprintFactORM.plan_id.in_(await _plan_chain_ids(ctx.session, plan_id))))).scalars().all()
    # факты считаются по всей цепочке версий (первоначальные спринты считаются
    # в знаменателе SP: спринты до пересчёта — их факт игнорируем уже не нужно)
    initial = await _initial_plan_for(ctx.session, plan)
    planned_sp_by_sprint: dict[int, float] = {}
    for s in initial.sprints:
        planned_sp_by_sprint[s.sprint_no] = sum(i.step_points_sp or 0.0 for i in s.items)
    done_sp_by_sprint = {f.sprint_no: f.completed_sp for f in facts}
    done_task_ids = {tid for f in facts for tid in (f.completed_task_ids or [])}
    tasks_map, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    initial_items = [
        {"task_id": i.task_id,
         "parent_id": tasks_map[i.task_id].parent_id if i.task_id in tasks_map else None,
         "step_points_sp": i.step_points_sp or 0.0,
         "sprint_no": s.sprint_no}
        for s in initial.sprints for i in s.items
    ]
    quarter_finished = len(facts) >= SPRINTS_PER_QUARTER
    from src.services.metrics import compute_metrics_initiatives

    report = compute_metrics_initiatives(initial_items, sorted(done_task_ids),
                                         planned_sp_by_sprint, done_sp_by_sprint,
                                         quarter_finished=quarter_finished)
    return report.model_dump()


async def _initial_plan_for(session, plan: Plan) -> Plan:
    """Первый план в цепочке снапшотов родителя (is_initial=True)."""
    seen = {plan.plan_id}
    cur_id = plan.plan_id
    while True:
        cur_orm = await get_plan_orm(session, cur_id)
        if not cur_orm:
            return plan
        if cur_orm.is_initial or not cur_orm.parent_plan_id or cur_orm.parent_plan_id in seen:
            items = (await session.execute(select(PlanItemORM).where(
                PlanItemORM.plan_id == cur_id))).scalars().all()
            return _plan_from_orm(cur_id, items)
        seen.add(cur_orm.parent_plan_id)
        cur_id = cur_orm.parent_plan_id


async def _plan_chain_ids(session, plan_id: str) -> set[str]:
    """Все версии цепочки (текущая → root): факты спринтов привязаны к той версии,
    на которой их загрузили, а статистика смотрит на любую версию цепочки (047)."""
    chain_ids = {plan_id}
    cur = plan_id
    while True:
        orm = await get_plan_orm(session, cur)
        if not orm or not orm.parent_plan_id or orm.parent_plan_id in chain_ids:
            break
        chain_ids.add(orm.parent_plan_id)
        cur = orm.parent_plan_id
    return chain_ids


@router.get("/plans/{plan_id}/tasks/{task_id}/explanation")
async def task_explanation(plan_id: str, task_id: str, ctx: Context = Depends(require_context)) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    matches = [i for i in items if i.task_id == task_id]
    if not matches:
        raise HTTPException(status_code=404, detail=f"задача {task_id} не найдена в плане {plan_id}")
    it = matches[0]
    return {
        "task_id": task_id,
        "decision": it.decision,
        "sprint_no": it.sprint_no,
        "reason": it.reason,
        "planned_sp": it.planned_sp,
    }


@router.get("/plans/{plan_id}/bus-risk")
async def plan_bus_risk_endpoint(plan_id: str, ctx: Context = Depends(require_context)) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    planned = [{"task_id": i.task_id, "sprint_no": i.sprint_no} for i in items
               if i.decision == PlanDecision.planned.value]
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    from src.services.bus_factor import plan_bus_risk
    return plan_bus_risk(planned, tasks, engineers)


@router.get("/plans/{plan_id}/bus-forecast")
async def plan_bus_forecast_endpoint(plan_id: str, ctx: Context = Depends(require_context)) -> dict:
    """Прогноз bus factor по плановой загрузке (change 023): assignments версии
    плана → загрузка по спринтам, критичные роли, перегруз, риск «если уйдёт»."""
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    plan = _plan_from_orm(plan_id, items)
    tasks, engineers, _, _ = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    from src.services.bus_factor import plan_bus_forecast
    return plan_bus_forecast(plan, tasks, engineers)


@router.get("/bus-factor")
async def bus_factor(
    scope_type: str | None = None,
    scope_id: str | None = None,
    ctx: Context = Depends(require_context),
) -> dict:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    known_teams = {e.team_id for e in engineers} | {t.team_id for t in tasks.values() if t.team_id}

    if scope_type:
        st = scope_type.lower()
        if st not in ("company", "team"):
            raise HTTPException(status_code=404, detail=f"неизвестный scope_type: {scope_type}")
        if st == "team" and scope_id and scope_id not in known_teams:
            raise HTTPException(status_code=404, detail=f"команда {scope_id} не найдена")
    from src.services.bus_factor import compute_bus_factor

    report = compute_bus_factor(engineers, scope_type=scope_type, scope_id=scope_id)
    return report.model_dump()


@router.get("/teams/{team_id}/bus-factor")
async def team_bus_factor(team_id: str, ctx: Context = Depends(require_context)) -> dict:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    known_teams = {e.team_id for e in engineers} | {t.team_id for t in tasks.values() if t.team_id}
    if team_id not in known_teams:
        raise HTTPException(status_code=404, detail=f"команда {team_id} не найдена")

    from src.services.bus_factor import compute_bus_factor

    report = compute_bus_factor(engineers, scope_type="team", scope_id=team_id)
    return report.model_dump()


@router.get("/plans/{plan_id}/optimization-report")
async def optimization_report_endpoint(plan_id: str, ctx: Context = Depends(require_context)) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    plan = _plan_from_orm(plan_id, items)
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    facts = (await ctx.session.execute(select(SprintFactORM).where(SprintFactORM.plan_id.in_(await _plan_chain_ids(ctx.session, plan_id))))).scalars().all()
    initial = await _initial_plan_for(ctx.session, plan)
    planned_sp_by_sprint = {s.sprint_no: sum(i.step_points_sp or 0.0 for i in s.items) for s in initial.sprints}
    done_sp_by_sprint = {f.sprint_no: f.completed_sp for f in facts}
    done_task_ids: list[str] = sorted({tid for f in facts for tid in (f.completed_task_ids or [])})
    initial_items = [
        {"task_id": i.task_id,
         "parent_id": tasks[i.task_id].parent_id if i.task_id in tasks else None,
         "step_points_sp": i.step_points_sp or 0.0,
         "sprint_no": s.sprint_no}
        for s in initial.sprints for i in s.items
    ]
    quarter_finished = len(facts) >= SPRINTS_PER_QUARTER
    strategy_used = plan_orm.strategy or "priority"
    baseline_plan = generate_plan(PlannerInput(list(tasks.values()), engineers, history, deps), strategy="priority")
    from src.services.metrics import compute_metrics_initiatives
    from src.services.optimization import generate_optimization_report

    metrics_report = compute_metrics_initiatives(
        initial_items, done_task_ids, planned_sp_by_sprint, done_sp_by_sprint,
        quarter_finished=quarter_finished,
    ).model_dump()
    metrics_report["strategy_used"] = strategy_used
    return generate_optimization_report(
        plan, baseline_plan, tasks, metrics_report,
    )


@router.get("/plans/{plan_id}/staffing-suggestions")
async def staffing_suggestions_endpoint(plan_id: str, ctx: Context = Depends(require_context)) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")

    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    from src.services.optimization import generate_staffing_suggestions

    suggestions = generate_staffing_suggestions(engineers, tasks)
    return {"plan_id": plan_id, "suggestions": suggestions}


@router.get("/plans/{plan_id}/advice")
async def advice_endpoint(plan_id: str, comment: str | None = None,
                          ctx: Context = Depends(require_context)) -> dict:
    """AI-советник (change 015): одноразовые советы по сводке состояния плана.

    comment (опционально, ≤ 500 симв.) — весь контекст прогона в одном комментарии
    (например «ENG-405 заболел»); никогда не сохраняется и не влияет на план.
    """
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    from pydantic import ValidationError
    from src.ai.llm import LLMUnavailable, get_client
    from src.services.metrics import compute_metrics_initiatives
    from src.services.optimization import generate_staffing_suggestions

    comment = (comment or "").strip()[:500]
    items = await get_plan_items(ctx.session, plan_id)
    plan = _plan_from_orm(plan_id, items)
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    facts = (await ctx.session.execute(select(SprintFactORM).where(SprintFactORM.plan_id.in_(await _plan_chain_ids(ctx.session, plan_id))))).scalars().all()
    initial = await _initial_plan_for(ctx.session, plan)
    planned_sp_by_sprint = {s.sprint_no: sum(i.step_points_sp or 0.0 for i in s.items) for s in initial.sprints}
    done_sp_by_sprint = {f.sprint_no: f.completed_sp for f in facts}
    done_task_ids: list[str] = sorted({tid for f in facts for tid in (f.completed_task_ids or [])})
    initial_items = [
        {"task_id": i.task_id,
         "parent_id": tasks[i.task_id].parent_id if i.task_id in tasks else None,
         "step_points_sp": i.step_points_sp or 0.0,
         "sprint_no": s.sprint_no}
        for s in initial.sprints for i in s.items
    ]
    quarter_finished = len(facts) >= SPRINTS_PER_QUARTER
    metrics_report = compute_metrics_initiatives(
        initial_items, done_task_ids, planned_sp_by_sprint, done_sp_by_sprint,
        quarter_finished=quarter_finished,
    ).model_dump()

    pinned_ids: set[str] = set()
    for s in plan.sprints:
        for it in s.items:
            if it.pinned_sprint or it.pinned_engineer_id:
                pinned_ids.add(it.task_id)

    warnings = await _advice_warnings(plan_id, plan, plan_orm, tasks, deps, engineers, done_task_ids, ctx)
    optimization_report = optimization_report_endpoint_auto(plan_id, plan, plan_orm, tasks, engineers, history, deps, metrics_report)
    staffing = generate_staffing_suggestions(engineers, tasks)

    from src.ai.pipelines.advisor import (AdviceReport, fallback_advice, facts_json,
                                          llm_advice_async)

    snapshot = facts_json(warnings=warnings, metrics=metrics_report,
                          optimization_report=optimization_report, staffing=staffing,
                          comment=comment or None)
    # pinned-задачи: в сводку не попадают «переносные» options — фильтр вывода
    advice: list = []
    mode = "fallback"
    comment_considered = bool(comment)
    client = get_client()
    if client.enabled:
        for attempt in (1, 2):
            try:
                advice = await llm_advice_async(snapshot, client)
                advice = [a for a in advice if not (set(a.affected_task_ids) & pinned_ids)]
                advice = advice[:6]
                mode = "llm"
                break
            except (ValidationError, ValueError, LLMUnavailable) as e:
                logger.warning("advisor LLM attempt %s failed: %s", attempt, e)
        else:
            advice = fallback_advice(warnings, optimization_report, staffing, metrics_report, comment)
    else:
        advice = fallback_advice(warnings, optimization_report, staffing, metrics_report, comment)
        advice = [a for a in advice if not (set(a.affected_task_ids) & pinned_ids)]

    report = AdviceReport(mode=mode, comment_considered=bool(comment), advice=advice)
    # change 043: прогон сохраняется в историю (comment теперь сохраняется — решение лида)
    ctx.session.add(AdviceReportORM(
        workspace_id=ctx.workspace_id, plan_id=plan_id, mode=mode,
        advice=[a.model_dump() for a in advice], comment=(comment or "")[:500],
        comment_considered=bool(comment),
    ))
    await ctx.session.commit()
    return report.model_dump()


@router.get("/plans/{plan_id}/advice/history")
async def advice_history(plan_id: str, ctx: Context = Depends(require_context)) -> list[dict]:
    """change 043: история прогонов советов по версии плана (per-plan_id),
    каждая запись с version_label (номер версии в цепочке + дата)."""
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail="план не найден")
    from sqlalchemy import select

    rows = (await ctx.session.execute(select(AdviceReportORM).where(
        AdviceReportORM.plan_id == plan_id,
        AdviceReportORM.workspace_id == ctx.workspace_id,
    ).order_by(AdviceReportORM.created_at.desc()))).scalars().all()
    # version_label: порядковый номер версии в цепочке parent_plan_id (1=initial)
    chain = [plan_orm]
    cur = plan_orm
    while cur.parent_plan_id:
        parent = await get_plan_orm(ctx.session, cur.parent_plan_id, ctx.workspace_id)
        if not parent:
            break
        chain.insert(0, parent)
        cur = parent
    version_no = {p.plan_id: i + 1 for i, p in enumerate(chain)}
    return [
        {
            "advice_id": r.advice_id, "mode": r.mode, "comment": r.comment,
            "comment_considered": r.comment_considered,
            "advice": r.advice or [], "created_at": str(r.created_at),
            "version_label": f"версия {version_no.get(plan_id, '?')} · {str(r.created_at)[:16]}",
        }
        for r in rows
    ]


async def _advice_warnings(plan_id, plan, plan_orm, tasks, deps, engineers, done_task_ids, ctx):
    """Сводка рисков (тот же compute_warnings, что в /warnings) + справочник причин."""
    child = None
    items = []
    if plan_orm.parent_plan_id:
        child = None  # советы строятся от текущей версии
    done = set(done_task_ids)
    after = _recomputed_plan(plan, done)
    q_start = plan_orm.quarter_start or calculate_quarter_start(list(tasks.values()))
    from src.services.replanner import compute_warnings

    warnings = compute_warnings(plan, after, sorted(done), tasks, deps, engineers, quarter_start=q_start)
    out = [w.model_dump() for w in warnings]
    cat_rows = (await ctx.session.execute(select(ReferenceValueORM).where(
        ReferenceValueORM.category == "deviation_reason",
        ReferenceValueORM.workspace_id == ctx.workspace_id))).scalars().all()
    from src.services.reasons import attach_reason_categories

    return attach_reason_categories(out, [r.value for r in cat_rows if r.value != "Причины расхождения планов заказчика и исполнителя"])


def optimization_report_endpoint_auto(plan_id, plan, plan_orm, tasks, engineers, history, deps, metrics_report):
    baseline_plan = generate_plan(PlannerInput(list(tasks.values()), engineers, history, deps), strategy="priority")
    from src.services.optimization import generate_optimization_report

    return generate_optimization_report(plan, baseline_plan, tasks, metrics_report)


@router.get("/star-map/summary")
async def star_map(ctx: Context = Depends(require_context)) -> dict:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    from src.services.starmap import star_map_summary

    return star_map_summary(engineers)


@router.get("/teams")
async def teams(ctx: Context = Depends(require_context)) -> list[dict]:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    from src.services.starmap import teams_overview

    return teams_overview(engineers)
api_router = router



# --- версии планов и история фактов (change 002b) -----------------------

@router.get("/plans")
async def plans_list(ctx: Context = Depends(require_context)) -> list[dict]:
    """Все версии планов (цепочка снапшотов: initial → recompute)."""
    rows = (await ctx.session.execute(select(PlanORM).where(
        PlanORM.workspace_id == ctx.workspace_id).order_by(PlanORM.created_at))).scalars().all()
    out = []
    for r in rows:
        out.append({
            "plan_id": r.plan_id,
            "is_initial": r.is_initial,
            "parent_plan_id": r.parent_plan_id,
            "recomputed_after_sprint": r.recomputed_after_sprint,
            "created_by": r.created_by,
            "created_at": str(r.created_at),
            "strategy": r.strategy,
        })
    return out


@router.get("/plans/{plan_id}/facts")
async def facts_list(plan_id: str, ctx: Context = Depends(require_context)) -> list[dict]:
    """Факты спринтов по всей цепочке версии (root → current)."""
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    chain_ids = await _plan_chain_ids(ctx.session, plan_id)
    facts = (await ctx.session.execute(select(SprintFactORM).where(
        SprintFactORM.plan_id.in_(chain_ids)))).scalars().all()
    return [{
        "sprint_no": f.sprint_no,
        "completed_sp": f.completed_sp,
        "completed_task_ids": f.completed_task_ids or [],
        "notes": f.notes,
    } for f in sorted(facts, key=lambda x: x.sprint_no)]


# --- ручки-источники для фронтенда (change 002b) ------------------------

@router.get("/tasks")
async def tasks_list(team_id: str | None = None, status: str | None = None,
                     search: str | None = None,
                     ctx: Context = Depends(require_context)) -> list[dict]:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    dep_map: dict[str, list[dict]] = defaultdict(list)
    for blocking, blocked in deps:
        dep_map[blocked].append({"blocking_task_id": blocking})
    out = []
    for tid, task in tasks.items():
        if team_id and task.team_id != team_id:
            continue
        if status and task.status.lower() != status.lower():
            continue
        if search and search.lower() not in (task.summary or "").lower():
            continue
        out.append({
            "task_id": tid, "parent_id": task.parent_id, "team_id": task.team_id,
            "summary": task.summary, "status": task.status,
            "estimation_sp": task.estimation_sp, "estimated_hh": task.estimated_hh,
            "role_hours": task.role_hours,
            "blocks": [d for d in deps if d[0] == tid],
            "blocked_by": [b for b in dep_map.get(tid, [])],
        })
    return sorted(out, key=lambda x: x["task_id"])


@router.get("/tasks/{task_id}")
async def task_detail(task_id: str, ctx: Context = Depends(require_context)) -> dict:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="задача не найдена")
    from src.db.models import TaskRoleHoursORM

    actual_rows = (await ctx.session.execute(select(TaskRoleHoursORM).where(
        TaskRoleHoursORM.task_id == task_id,
        TaskRoleHoursORM.workspace_id == ctx.workspace_id,
    ))).scalars().all()
    actual_hours = {r.role: r.hours for r in actual_rows}
    res = task.model_dump() | {
        "blocks": [b for a, b in deps if a == task_id],
        "blocked_by": [a for a, b in deps if b == task_id],
    }
    if actual_hours:
        res["role_hours_actual"] = actual_hours
    return res


@router.get("/engineers")
async def engineers_list(team_id: str | None = None, role: str | None = None,
                          grade: str | None = None, skill: str | None = None,
                          min_rate: float | None = None,
                          ctx: Context = Depends(require_context)) -> list[dict]:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    out = []
    for e in engineers:
        if team_id and e.team_id != team_id:
            continue
        if role and role.lower() not in e.role.lower():
            continue
        if grade and grade.lower() != e.grade.lower():
            continue
        if min_rate is not None and e.capacity_rate < min_rate:
            continue
        if skill and skill.lower() not in e.skills_declared.lower():
            continue
        out.append(e.model_dump())
    return out


@router.get("/engineers/{engineer_id}")
async def engineer_detail(engineer_id: str, ctx: Context = Depends(require_context)) -> dict:
    from src.services.starmap import engineer_profile

    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    profile = engineer_profile(engineers, engineer_id)
    if not profile:
        raise HTTPException(status_code=404, detail="не найден")
    return profile


@router.get("/dependencies")
async def dependencies_list(ctx: Context = Depends(require_context)) -> list[dict]:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    return [{"blocking_task_id": a, "blocked_task_id": b} for a, b in deps]


@router.get("/teams/{team_id}")
async def team_detail(team_id: str, ctx: Context = Depends(require_context)) -> dict:
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    from src.services.capacity import team_capacity_sp

    members = [e for e in engineers if e.team_id == team_id]
    hist = [h for h in history if h.team_id == team_id]
    if not members and not hist:
        raise HTTPException(status_code=404, detail="команда не найдена")
    return {
        "team_id": team_id,
        "members": [e.model_dump() for e in members],
        "capacity_sp_per_sprint": team_capacity_sp(hist),
        "sprint_history": [h.model_dump() for h in hist],
    }


# --- ручки приоритетов и отмен (change 003) -----------------------------

@router.put("/tasks/{task_id}/priority")
async def set_priority(task_id: str, body: dict, ctx: Context = Depends(require_permission("edit_priority"))) -> dict:
    """human-in-loop: приоритет задачи (меньше — раньше)."""
    priority = body.get("priority")
    if priority is None:
        raise HTTPException(status_code=422, detail="priority обязателен")
    try:
        priority = int(priority)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="priority — целое число")
    task = (await ctx.session.execute(select(TaskORM).where(
        TaskORM.task_id == task_id, TaskORM.workspace_id == ctx.workspace_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="задача не найдена")
    task.priority = priority
    task.source = "manual"
    await ctx.session.commit()
    return {"status": "updated", "task_id": task_id, "priority": priority}


@router.post("/plans/{plan_id}/tasks/{task_id}/cancel-request")
async def cancel_request(plan_id: str, task_id: str,
                         ctx: Context = Depends(require_permission("cancel_request"))) -> dict:
    """Сервис предлагает отмену: перевод postponed-задачи в cancelled_pending."""
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail="план не найден")
    items = (await ctx.session.execute(select(PlanItemORM).where(
        PlanItemORM.plan_id == plan_id, PlanItemORM.task_id == task_id))).scalars().all()
    if not items:
        raise HTTPException(status_code=404, detail="задача не в плане")
    for item in items:
        if item.decision == PlanDecision.postponed.value:
            item.decision = PlanDecision.cancel_pending.value
            item.reason = (item.reason or "") + f" (кандидат на отмену — ресурс/роли недоступны; предложил {ctx.user.email})"
    await ctx.session.commit()
    return {"status": "pending_confirmation", "task_id": task_id}


@router.post("/plans/{plan_id}/tasks/{task_id}/confirm-cancel")
async def confirm_cancel(plan_id: str, task_id: str,
                         ctx: Context = Depends(require_permission("confirm_cancel"))) -> dict:
    """Лид подтверждает отмену: cancelled_pending → cancelled."""
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail="план не найден")
    items = (await ctx.session.execute(select(PlanItemORM).where(
        PlanItemORM.plan_id == plan_id, PlanItemORM.task_id == task_id))).scalars().all()
    if not items:
        raise HTTPException(status_code=404, detail="задача не в плане")
    if not any(i.decision == PlanDecision.cancel_pending.value for i in items):
        raise HTTPException(status_code=409, detail="нет отложенной отмены (cancel-request)")
    for item in items:
        if item.decision == PlanDecision.cancel_pending.value:
            if "(кандидат на отмену" in (item.reason or ""):
                item.reason = item.reason.replace(
                    "(кандидат на отмену", f"(отмена подтверждена {ctx.user.email}: ")
            else:
                item.reason = f"отмена подтверждена {ctx.user.email} (лидом)"
    await ctx.session.commit()
    return {"status": "cancelled", "task_id": task_id}


# --- 016-person-planner: личный план и pin/unpin -------------------

@router.get("/plans/{plan_id}/people/{engineer_id}")
async def get_person_plan(
    plan_id: str,
    engineer_id: str,
    ctx: Context = Depends(require_context),
) -> PersonPlanResponse:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")

    tasks, engineers, _, _ = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    engineer = next((e for e in engineers if e.engineer_id == engineer_id), None)
    if not engineer:
        raise HTTPException(status_code=404, detail=f"инженер {engineer_id} не найден")

    items = await get_plan_items(ctx.session, plan_id)
    plan = _plan_from_orm(plan_id, items)

    schedules: dict[int, list[PersonScheduleItem]] = defaultdict(list)
    for sprint in plan.sprints:
        for item in sprint.items:
            for ass in item.assignments:
                if ass.engineer_id == engineer_id:
                    task = tasks.get(item.task_id)
                    schedules[sprint.sprint_no].append(PersonScheduleItem(
                        task_id=item.task_id,
                        role=ass.role,
                        hours=ass.hours,
                        position=len(schedules[sprint.sprint_no]) + 1,
                        is_pinned=ass.is_pinned or (item.pinned_engineer_id == engineer_id),
                        summary=task.summary if task else "",
                    ))

    return PersonPlanResponse(
        engineer_id=engineer.engineer_id,
        team_id=engineer.team_id,
        role=engineer.role,
        capacity_rate=engineer.capacity_rate,
        hours_per_sprint=engineer.hours_per_sprint,
        schedules=dict(schedules),
    )


@router.post("/plans/{plan_id}/tasks/{task_id}/pin")
async def pin_task(
    plan_id: str,
    task_id: str,
    body: PinRequest,
    ctx: Context = Depends(require_permission("plans_generate")),
) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")

    # change 040-QA: спринт пина всегда в границах квартала (0/7 проходили)
    if not 1 <= body.sprint_no <= SPRINTS_PER_QUARTER:
        raise HTTPException(status_code=422, detail=f"sprint_no должен быть 1..{SPRINTS_PER_QUARTER}")

    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail=f"задача {task_id} не найдена")

    blocking_ids = [a for a, b in deps if b == task_id]
    items = await get_plan_items(ctx.session, plan_id)
    existing_pins: dict[str, dict] = {}
    for item in items:
        if item.pinned_sprint is not None and item.task_id != task_id:
            existing_pins[item.task_id] = {
                "sprint_no": item.pinned_sprint,
                "engineer_id": item.pinned_engineer_id,
                "position": item.pinned_position,
            }

    for b_id in blocking_ids:
        b_sprint = existing_pins.get(b_id, {}).get("sprint_no")
        if b_sprint and b_sprint >= body.sprint_no:
            raise HTTPException(
                status_code=409,
                detail=f"Конфликт закрепления: задача {task_id} зависит от {b_id}, которая закреплена на спринт {b_sprint} >= {body.sprint_no}",
            )

    if body.engineer_id:
        eng = next((e for e in engineers if e.engineer_id == body.engineer_id), None)
        if not eng:
            raise HTTPException(status_code=404, detail=f"инженер {body.engineer_id} не найден")

    # change 039: пин применяется немедленно к ДАННЫМ задачи (перемещение —
    # фиксация данных), без пересборки остального плана (032).
    # 409 по ёмкости инженера в целевом спринте — до записи.
    item = next((it for it in items if it.task_id == task_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail=f"задача {task_id} не входит в план (закреплять можно плановые)")
    if item.decision == PlanDecision.done_actual.value:
        raise HTTPException(status_code=409, detail="задача закрыта фактом — закреплять нельзя")

    # change 047: part-level pin — двигается только часть из from_sprint_no,
    # остальные части задачи остаются на своих спринтах
    moved_rows = [
        it for it in items
        if it.task_id == task_id and (body.from_sprint_no is None or it.sprint_no == body.from_sprint_no)
    ]
    if not moved_rows:
        raise HTTPException(status_code=404, detail=f"у задачи {task_id} нет части в спринте {body.from_sprint_no}")
    if any(it.decision == PlanDecision.done_actual.value for it in moved_rows):
        raise HTTPException(status_code=409, detail="задача закрыта фактом — закреплять нельзя")
    moved_ids = {id(it) for it in moved_rows}

    if body.engineer_id:
        # лёгкая проверка ёмкости: часы КОНКРЕТНОГО инженера в перемещаемых строках
        # + его загрузка в целевом спринте другими задачами > лимит → 409
        need = sum(
            (a.get("hours") or 0.0)
            for it2 in moved_rows
            for a in (it2.assignments or [])
            if a.get("engineer_id") == body.engineer_id
        )
        limit = 80.0 * next(
            (e.capacity_rate for e in engineers if e.engineer_id == body.engineer_id), 1.0)
        placed = sum(
            (a.get("hours") or 0.0)
            for it2 in items
            if id(it2) not in moved_ids and (it2.pinned_sprint == body.sprint_no or it2.sprint_no == body.sprint_no)
            for a in (it2.assignments or [])
            if a.get("engineer_id") == body.engineer_id
        )
        if placed + need > limit + 1e-9:
            raise HTTPException(
                status_code=409,
                detail=f"нужно {need:.0f} ч, свободно {max(0.0, limit - placed):.0f} ч — инженер {body.engineer_id} в спринте {body.sprint_no} не загрузится")

    # все строки задачи в целевом спринте (перенесённые + уже стоявшие там)
    # сливаются в одну: одна строка на (задача × спринт)
    target_rows = [
        it for it in items
        if it.task_id == task_id and (id(it) in moved_ids or it.sprint_no == body.sprint_no)
    ]
    keep = target_rows[0]
    merged_assignments: list[dict] = []
    planned_sp = 0.0
    has_sp = False
    for row in target_rows:
        if row.planned_sp is not None:
            planned_sp += row.planned_sp
            has_sp = True
        for a in (row.assignments or []):
            merged_assignments.append({**a, "sprint_no": body.sprint_no})
    keep.sprint_no = body.sprint_no
    keep.planned_sp = planned_sp if has_sp else None
    keep.assignments = merged_assignments  # новый список — JSON-колонка видит изменение
    if not keep.reason:
        keep.reason = next((r.reason for r in target_rows if r.reason), "")
    keep.pinned_sprint = body.sprint_no
    keep.pinned_engineer_id = body.engineer_id
    keep.pinned_position = body.position
    for row in target_rows[1:]:
        await ctx.session.delete(row)
    await ctx.session.commit()

    return {"status": "pinned", "plan_id": plan_id, "task_id": task_id,
            "sprint_no": body.sprint_no, "applied": True,
            "message": "закреплено (перемещено немедленно)"}


@router.delete("/plans/{plan_id}/tasks/{task_id}/pin")
async def unpin_task(
    plan_id: str,
    task_id: str,
    ctx: Context = Depends(require_permission("plans_generate")),
) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")

    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=ctx.workspace_id)
    items = await get_plan_items(ctx.session, plan_id)

    existing_pins: dict[str, dict] = {}
    for item in items:
        if item.pinned_sprint is not None and item.task_id != task_id:
            existing_pins[item.task_id] = {
                "sprint_no": item.pinned_sprint,
                "engineer_id": item.pinned_engineer_id,
                "position": item.pinned_position,
            }

    # change 032: unpin — снятие намерения без пересборки; задача будет
    # расставляться планировщиком на общих основаниях при следующем пересчёте
    # «Вернуть» снимает закрепление задачи целиком — со всех её частей (047)
    rows = [it for it in items if it.task_id == task_id]
    for item in rows:
        item.pinned_sprint = None
        item.pinned_engineer_id = None
        item.pinned_position = None
    if rows:
        await ctx.session.commit()

    return {"status": "unpinned", "plan_id": plan_id, "task_id": task_id, "applied": False}
