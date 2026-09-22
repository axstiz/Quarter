# Tasks: 028-queue-solver-llm

## 1. Настройка и LLM-примитив

- [x] 1.1 `src/core/config.py`: поле `llm_max_concurrency: int` (alias `POSTCODE_LLM_MAX_CONCURRENCY`, default 2). Проверка: `uv run pytest tests/test_llm_providers.py -q`
- [x] 1.2 `src/ai/llm.py`: `async def complete_async(client, system, user, temperature=0.0)` — модульный (ленивый) `asyncio.Semaphore` + `asyncio.to_thread(client.complete, ...)`. Проверка: unit-тест — 5 параллельных вызовов при лимите 2 дают максимум 2 одновременных

## 2. Перевод вызовов на complete_async

- [x] 2.1 `src/api/routes.py::advice_endpoint`: `llm_advice` через `complete_async` (retry/фильтр pinned — без изменений). Проверка: `uv run pytest tests/test_advisor.py -q`
- [x] 2.2 `src/ai/pipelines/normalization.py`: LLM-фаза через `complete_async` (воркер не блокирует loop). Проверка: `uv run pytest tests/test_jobs.py -q`

## 3. Solver через очередь

- [x] 3.1 `src/ai/jobs_worker.py`: arq-задача `run_optimization_job(ctx, job_id)` — новая сессия, job -> solving -> run_optimization(require_staffing из args) -> ready|failed (текст ошибки в job.error); в `WorkerSettings.functions`. Проверка: unit — задача завершает job до ready
- [x] 3.2 `src/api/routes.py::optimize_plan_endpoint`: при `get_queue()` не None — job queued → `enqueue_job("run_optimization_job", job.job_id, require_staffing=...)` → ответ `{status: "queued", job_id}`; иначе прежний синхронный код. 409-логика и права — без изменений. Проверка: `uv run pytest tests/test_optimize_jobs.py -q` (деградация: existing тесты проходят без Redis)

## 4. Тесты очереди и лимита

- [x] 4.1 `tests/test_optimize_queue.py`: fake arq pool → POST optimize → статус queued (ответ быстрый), работающий `run_optimization_job` доводит до ready/failed с прежними ошибками; 409 на повтор при queued
- [x] 4.2 `tests/test_llm_providers.py` (или отдельный): лимит конкурентности — semaphore пропускает ≤ N одновременных `complete_async`

## 5. Проверки

- [x] 5.1 `openspec validate --all` — без ошибок
- [x] 5.2 `uv run pytest tests/ -q` — все зелёные
- [x] 5.3 Живая связка (Redis профиль jobs): POST /plans/optimize → 200 queued быстро; worker доводит до ready; без Redis (JOBS_MODE=sync) — прежний синхронный ответready в запросе
