# Design: 028-queue-solver-llm

## Context

`run_optimization` синхронен внутри HTTP-запроса (routes.py), LLM-вызовы (`client.complete`, sync httpx) блокируют event loop и не ограничены по параллелизму. Очередь уже есть: arq + Redis, задача `run_normalization`, деградация через `get_queue()` (change 007).

## Goals / Non-Goals

- **Goals**: solver в воркере очереди (та же семантика статусов/ошибок), общий лимит конкурентности LLM, sync httpx не блокирует event loop. Нули в деградации: без Redis — ровно прежний код.
- **Non-Goals**: Celery, персистентная очередь задач в БД (job уже в БД), ретраи optimize-job (arq max_tries=2 у normalization — для optimize выключаем именной job_timeout), изменения прав.

## Decisions

1. **Новая arq-задача `run_optimization_job(ctx, job_id)`**: воркер создаёт свою `SessionLocal`, читает job (workspace/plan/author из `OptimizationJobORM`), ставит `solving`, вызывает `run_optimization(...)` с `require_staffing`... — права известны в момент постановки: роли серверные, но `ctx` в воркере нет → передадим намерение enqueue-параметром (`require_staffing`, вычисленный в роуте из `ctx.role`). Ошибки: `DraftValidationError` → failed + текст ошибки (роут 422 отдаёт для polling-клиента через GET), `StaffingPermissionError`/`OptimizationError` → failed с причиной.
2. **Вычисление require_staffing в роуте**: `require_staffing=(ctx.role == "admin")` — единая точка прав, воркер не решает о правах.
3. **422 при валидации в очереди**: HTTP уже отдан (200 queued) — нарушение видно через GET job: `status=failed`, `error=…`; 422 в синхронном режиме остаётся. Дельта спеки фиксирует оба.
4. **`complete_async(client, system, user, temperature)`** в llm.py: `asyncio.Semaphore(settings.llm_max_concurrency)` (модульный, ленивый) + `asyncio.to_thread(client.complete, ...)`. Advisor-роут и normalization идут через него; retry-логика и pydantic-валидация не меняются.
5. **JOBS_MODE без новых значений**: очередь включается тем же `auto|queue`; `sync` — принудительно по-старому.

## Risks / Trade-offs

- Воркер теперь держит второй HTTP-клиент к Java (60 с) — arq `job_timeout` больше solve-таймаута (настройка `jobs_timeout_sec` уже ≥ 60).
- Если воркер умер после `queued`, job висит polling'ом — приёмлемо (как у upload); подтверждение healthcheck воркера уже есть.

## Migration Plan

Без миграций кода БД: `OptimizationJobORM` уже персистентен.

## Open Questions

- Нет — следуем зафиксированному todo (внедрён change 027).
