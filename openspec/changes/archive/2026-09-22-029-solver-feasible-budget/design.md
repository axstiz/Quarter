# Design: 029-solver-feasible-budget

## Context

`SolveService.solve()` — time-bounded приближённый solver: `solve()` возвращает best-found даже с hard-нарушениями; unimproved-терминация 5 с жёстко зашита → обрывы до фазы восстановления. Python не различает «успех»/«не успел», ловит нарушения своей валидацией → 422 failed без объяснения. `solve_time_ms` и `score.hard` в ответе уже есть — отдельная Java-схема не нужна, только unimproved-конфиг.

## Goals / Non-Goals

- **Goals**: unimproved-лимит конфигурабелен (default min(timeLimit, 30)), бюджет 180/200/300, честная оценка (feasible) на бэке (score.hard==0), эвристика-fallback при infeasible с причиной, repair только для «Java hard=0 / Python нашёл нарушение».
- **Non-Goals**: гарантия оптимальности (невозножно для NP-трудной), repair внутри Java (дублирование правил — single source of truth в Python-валидаторе), переименование/удаление Repair scenario («черновик с нарушением отклоняется» остаётся для нерепарируемого).

## Decisions

1. **Java**: `OptimizerConfig.unimprovedLimitSeconds` (env `OPTIMIZER_UNIMPROVED_LIMIT_SECONDS`, default `min(timeLimit, 30)`); `SolveService` uses in termination. При infeasible Java отдаёт честный hard>0 — распознаётся бэком.
2. **Python**: `resp["score"]["hard"] != 0` → `raise SolverUnavailable("solver не достиг выполнимости за бюджет")` → существующий `except SolverUnavailable` → эвристика. Различение причин: словарь cause переводится в `degradation_reason` отчёта.
3. **Repair**: только вторая линия (score.hard == 0, но Python нашёл нарушение). После repair — обязательная повторная валидация (спека 018: 422 только нерепарейбл).
4. **Бюджеты**: Java timeLimit 180 (compose env), Python HTTP 200, arq job_timeout 300 — монотонная цепочка, никто не обрывает чужой таймаут.
5. **UI**: toast уже печатает режим; дополняется solve-time и degradation_reason.

## Risks / Trade-offs

- 180 с стоит ≈ живого solver-прогона на демо-машине: polling уже асинхронен (change 028) — UX не страдает.
- Если Java по-прежнему отдает hard=0 → гэп-нарушения → repair + возможный 422 — остаётся известным ограничением (README).

## Migration Plan

Без миграций: env-настройки + чтение уже существующих полей ответа.

## Open Questions

- Нет: fallback-поведение и бюджеты согласованы с лидом.
