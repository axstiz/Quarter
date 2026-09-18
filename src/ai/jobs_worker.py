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
            _pool = await create_pool(RedisSettings.from_dsn(settings.redis_url),
                                      timeout=settings.jobs_timeout_sec)
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
    from src.ai.pipelines.normalization import get_job_db, run_stage, save_job_db
    from src.db.session import SessionLocal

    async with SessionLocal() as session:
        job = await get_job_db(session, job_id)
        if not job:
            return {"ok": False, "error": f"job {job_id} не найден"}
        try:
            run_stage(job)
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


class WorkerSettings:
    """Настройки arq-воркера (запуск: arq src.ai.jobs_worker.WorkerSettings)."""
    functions = [run_normalization]
    job_timeout = settings.jobs_timeout_sec
    max_tries = settings.jobs_max_tries
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
