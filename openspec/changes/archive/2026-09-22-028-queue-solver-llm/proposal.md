# Proposal: 028-queue-solver-llm

## Why

Тяжёлые операции - прогон Java-solver'а (до 60 с) и LLM-вызовы советника (до ~2 retry) выполняются синхронно внутри HTTP-запроса: запрос API висит, только upload-пайплайн (change 007) идёт через очередь. Очередь повышает устойчивость: API освобождается для других запросов, LLM-вызовы ограничены по параллелизму, деградация без Redis сохраняет текущее поведение.

## What Changes

- Оптимизация плана через очередь: при доступном брокере `POST /plans/optimize` ставит arq-задачу `run_optimization_job` (статусы queued → solving → ready|failed), результат опрашивается существующей ручкой `GET /plans/optimize/{job_id}`. Деградация: нет Redis или `JOBS_MODE=sync` — текущий синхронный режим без изменений.
- Общий лимит конкурентности LLM-вызовов: `src/ai/llm.py::complete_async` — asyncio-семофор (`POSTCODE_LLM_MAX_CONCURRENCY`, default 2) + `asyncio.to_thread` (sync httpx не блокирует event loop); советник и нормализация идут через него.
- Права и контракты не меняются: права editor/admin, 409 на параллельную оптимизацию, формат ответов и статусы job — прежние.

## Capabilities

### Modified Capabilities

- `jobs`: новое требование «Очередь тяжёлых операций (solver) и лимит LLM» — фоновый прогон solver'а в воркере очереди (деградация синхронно), ограничение параллелизма LLM-вызовов.

## Impact

- `src/ai/jobs_worker.py` (+1 arq-задача), `src/api/routes.py` (ветка очереди в optimize), `src/ai/llm.py` (+`complete_async`), `src/core/config.py` (+1 настройка), `normalization.py` и `advisor`-маршрут (перевод вызовов на `complete_async`)
- API: контракты не ломаются (структура ответов та же, статус `queued` дополнительный)
- Тесты: очередь optimize (fake pool), деградация без Redis, лимит конкурентности LLM
