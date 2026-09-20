from __future__ import annotations

import logging
import tempfile
import uuid

from collections import defaultdict
from datetime import date, timedelta

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.importer import import_dataset, reset_dataset_tables
from src.db.models import (
    DependencyORM,
    EngineerORM,
    PlanItemORM,
    PlanORM,
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
    Engineer,
    Explanation,
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
            bucket.items.append(PlanItem(
                task_id=it.task_id,
                decision=PlanDecision.planned,
                sprint_no=it.sprint_no,
                reason=it.reason,
                step_points_sp=it.planned_sp,
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
    ctx: Context = Depends(require_permission("plans_generate")),
) -> dict:
    workspace_id = ctx.workspace_id
    tasks, engineers, history, deps = await load_world(ctx.session, workspace_id=workspace_id)
    if not tasks:
        raise HTTPException(status_code=400, detail="нет данных в базе; сначала POST /api/v1/data/import")
    plan = generate_plan(PlannerInput(list(tasks.values()), engineers, history, deps))
    q_start = calculate_quarter_start(list(tasks.values()))
    plan_orm = PlanORM(workspace_id=workspace_id, is_initial=True, quarter_start=q_start, sprint_length_days=14, created_by=ctx.user.id)
    ctx.session.add(plan_orm)
    await ctx.session.flush()
    for sprint in plan.sprints:
        for item in sprint.items:
            ctx.session.add(PlanItemORM(
                plan_id=plan_orm.plan_id,
                task_id=item.task_id,
                team_id=tasks[item.task_id].team_id if item.task_id in tasks else "",
                decision=item.decision.value,
                sprint_no=item.sprint_no,
                reason=item.reason,
                planned_sp=item.step_points_sp,
            ))
    for d in plan.decisions:
        ctx.session.add(PlanItemORM(
            plan_id=plan_orm.plan_id,
            task_id=d.task_id,
            team_id=tasks[d.task_id].team_id if d.task_id in tasks else "",
            decision=d.decision.value,
            sprint_no=None,
            reason=d.reason,
        ))
    await ctx.session.commit()
    return {"plan_id": plan_orm.plan_id, "sprints": {str(s.sprint_no): [i.task_id for i in sorted(
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
            "team_id": task.team_id if task else "",
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
    from src.ai.pipelines.normalization import run_stage, save_job_db as _save
    try:
        run_stage(job)
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
    from src.ai.pipelines.normalization import get_job_db, run_stage, save_job_db

    job = await get_job_db(ctx.session, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job не найден")
    if job.workspace_id != ctx.workspace_id:
        raise HTTPException(status_code=404, detail="job не найден")
    answers = body.get("answers", {})
    try:
        run_stage(job, answers)
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
    from src.ai.pipelines.normalization import get_job_db, run_stage, save_job_db

    job = await get_job_db(ctx.session, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job не найден")
    if job.workspace_id != ctx.workspace_id:
        raise HTTPException(status_code=404, detail="job не найден")
    run_stage(job)
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
    exists = (await ctx.session.execute(select(SprintFactORM).where(
        SprintFactORM.plan_id == plan_id, SprintFactORM.sprint_no == sprint_no))).scalar_one_or_none()
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
        SprintFactORM.plan_id == plan_id))).scalars().all()
    done_ids: set[str] = {str(x) for f in facts for x in (f.completed_task_ids or [])}
    # выполненные задачи также те, что в данных уже Done
    done_ids |= {t.task_id for t in tasks.values() if t.status == "Done"}

    first_free = max(after_sprint, 0) + 1
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
    child = generate_plan(planner_in, first_free_sprint=first_free)

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
    facts = (await ctx.session.execute(select(SprintFactORM).where(SprintFactORM.plan_id == plan_id))).scalars().all()
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
    return [w.model_dump() for w in warnings]


@router.get("/plans/{plan_id}/diff")
async def plan_diff(plan_id: str, ctx: Context = Depends(require_context)) -> dict:
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    items = await get_plan_items(ctx.session, plan_id)
    plan_before = _plan_from_orm(plan_id, items)
    facts = (await ctx.session.execute(select(SprintFactORM).where(SprintFactORM.plan_id == plan_id))).scalars().all()
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
    facts = (await ctx.session.execute(select(SprintFactORM).where(SprintFactORM.plan_id == plan_id))).scalars().all()
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
        })
    return out


@router.get("/plans/{plan_id}/facts")
async def facts_list(plan_id: str, ctx: Context = Depends(require_context)) -> list[dict]:
    """Факты спринтов по всей цепочке версии (root → current)."""
    plan_orm = await get_plan_orm(ctx.session, plan_id, ctx.workspace_id)
    if not plan_orm:
        raise HTTPException(status_code=404, detail=f"план {plan_id} не найден")
    chain_ids = {plan_id}
    cur = plan_id
    while True:
        orm = await get_plan_orm(ctx.session, cur)
        if not orm or not orm.parent_plan_id or orm.parent_plan_id in chain_ids:
            break
        chain_ids.add(orm.parent_plan_id)
        cur = orm.parent_plan_id
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
