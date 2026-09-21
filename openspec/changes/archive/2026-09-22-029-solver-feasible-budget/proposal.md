# Proposal: 029-solver-feasible-budget

## Why

Solver Timefold — приближённый (time-bounded): в редких обрывах фазы поиска отдаёт раскладку с hard-нарушением, но без признака «не успел»; при малых бюджетах (30 с + unimproved 5 с) шанс «тихих» нарушений выше, а job оптимизации падает 422 без пояснения. Повышение устойчивости: длинный бюджет, конфигурируемый лимит «без улучшений», честное различение «solver успешен / не успел» и объясняемое падение на эвристику.

## What Changes

- Java-конфиг: unimproved-лимит терминации зашит (5 с) — становится `OPTIMIZER_UNIMPROVED_LIMIT_SECONDS`, default `min(timeLimit, 30)`.
- Бюджеты: `OPTIMIZER_TIME_LIMIT_SECONDS` default 30 → 180 (compose), `POSTCODE_OPTIMIZER_SOLVE_TIMEOUT_SEC` 60 → 200, `POSTCODE_JOBS_TIMEOUT_SEC` 120 → 300.
- Python: черновик solver'а с `score.hard != 0` → **эвристика-fallback** (не 422) с `degradation_reason` «solver не достиг выполнимости за бюджет»; repair_dependencies остаётся страховкой только для случая «solver отдал hard=0, Python нашёл нарушение» — после repair всё ещё hard-валидация (422 если не помогло).
- Отчёт/журнал: `degradation_reason` в job-отчёте при деградации; UI toast показывает режим и причину деградации уже частично — дополнено.

## Capabilities

### Modified Capabilities

- `jobs` — деградация оптимизационной очереди: не только «сайдкар недоступен», но и «solver не достиг выполнимости за бюджет» — с причиной в отчёте.
- `planning` — уточнение деградации: solver, не достигший hard=0, означает переход в эвристику (не 422); 422 остаётся только для нерепарируемых структурных нарушений.

## Impact

- Java: `OptimizerConfig`, `SolveService`; Python: `optimizer_client.py`, `optimize_plan.py`, `config.py`, `docker-compose.yml`
- API: новые поля отчёта (`degradation_reason`), статус-контракты прежние
- Тесты: feasible-деградация (mock), Java unimproved-конфиг и ответ, live E2E 180 с
