"""Фоновые задачи upload-нормализации (change 007).

Стек: arq + Redis (asyncio-native). Деградация: если Redis недоступен или
JOBS_MODE=sync → выполнение в процессе API (тот же GRAPH.invoke), без hard-fail.
Состояние job персистентно в БД (upload_jobs), воркер и API видят общее состояние.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from src.core.config import settings

logger = logging.getLogger(__name__)

_pool: ArqRedis | None = None
_queue_unavailable: bool = False


async def get_queue() -> ArqRedis | None:
    """Пул arq или None (деградация → синхронно)."""
    global _pool, _queue_unavailable
    if _queue_unavailable or settings.jobs_mode == "sync":
        return None
    if _pool is None:
        try:
            # change 028: без timeout= — у create_pool такого kwargs нет,
            # прежний вызов падал и всегда уводил пайплайны в sync-деградацию
            _pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        except Exception as e:
            logger.warning("Redis недоступен (%s): jobs будут выполняться синхронно в процессе", e)
            _queue_unavailable = True
            return None
    return _pool


async def reset_queue_cache() -> None:
    """Пересостояние деградации (клиентский код вызывает после изменения настроек)."""
    global _pool, _queue_unavailable
    if _pool:
        await _pool.close()
    _pool = None
    _queue_unavailable = False


# --- задача воркера --------------------------------------------------------


async def run_normalization(ctx, job_id: str) -> dict:
    """arq-задача: прогон пайплайна по job (тот же код, что и синхронный режим)."""
    from src.ai.pipelines.normalization import get_job_db, run_stage_async, save_job_db
    from src.db.session import SessionLocal

    async with SessionLocal() as session:
        job = await get_job_db(session, job_id)
        if not job:
            return {"ok": False, "error": f"job {job_id} не найден"}
        try:
            await run_stage_async(job)
            await save_job_db(session, job)
            return {"ok": True, "status": job.status}
        except Exception as e:  # failed с причиной; повторный прогон через POST /ai/normalize
            job.status = "failed"
            job_snapshot_error = str(e)
            try:
                await save_job_db(session, job)
            except Exception:
                pass
            logger.error("job %s failed: %s", job_id, job_snapshot_error)
            return {"ok": False, "error": job_snapshot_error}


async def run_optimization_job(ctx, job_id: str, author_id: str = "worker",
                               require_staffing: bool = False) -> dict:
    """arq-задача (change 028): полный проход оптимизации вне HTTP-запроса.

    Права и автор вычислены в роуте и переданы enqueue-параметрами; воркер
    не решает о правах. Job ведётся solving → ready | failed с той же
    семантикой причин, что в синхронном режиме (невалидный черновик/
    перенос без права/домен).
    """
    from sqlalchemy import select

    from src.db.models import OptimizationJobORM
    from src.db.session import SessionLocal
    from src.services.optimize_plan import (
        DraftValidationError,
        OptimizationError,
        StaffingPermissionError,
        run_optimization,
    )

    async with SessionLocal() as session:
        job = (await session.execute(select(OptimizationJobORM).where(
            OptimizationJobORM.job_id == job_id))).scalars().first()
        if job is None:
            return {"ok": False, "error": f"job {job_id} не найден"}
        if job.status not in ("queued", "solving"):
            return {"ok": False, "error": f"job {job_id} в статусе {job.status}"}
        job.status = "solving"
        try:
            await session.commit()
            result = await run_optimization(session, job.workspace_id, job.plan_id,
                                            author_id, require_staffing=require_staffing)
            job.status = "ready"
            job.mode = result.get("mode")
            job.result = result
            await session.commit()
            return {"ok": True, "status": "ready", "plan_id": result.get("plan_id")}
        except DraftValidationError as e:
            job.status = "failed"
            job.error = f"валидация черновика solver не прошла: {e}"
        except StaffingPermissionError as e:
            job.status = "failed"
            job.error = str(e)
        except OptimizationError as e:
            job.status = "failed"
            job.error = str(e)
        except Exception as e:  # непредвиденное — честный failed с причиной
            job.status = "failed"
            job.error = f"ошибка оптимизации: {e}"
        try:
            await session.commit()
        except Exception:
            pass
        logger.error("optimize job %s failed: %s", job_id, job.error)
        return {"ok": False, "status": "failed", "error": job.error}


class WorkerSettings:
    """Настройки arq-воркера (запуск: arq src.ai.jobs_worker.WorkerSettings)."""
    functions = [run_normalization, run_optimization_job]
    job_timeout = settings.jobs_timeout_sec
    max_tries = settings.jobs_max_tries
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
