# Proposal: 031-optimize-progress

## Why

После change 028 (очередь) фронт написан под синхронный solve: POST возвращает queued за ~1 c, мутация делает ОДИН запрос статуса и завершается — кнопка «разгружается» до конца solve, toast «План оптимизирован/эвристика» печатается с нейтральным/неверным modeLabel (mode null → «эвристика (сайдкар недоступен)»), хотя solve ещё идёт. Данные PLAN показываются старые — не ясно, что что-то выполняется.

## What Changes

- `useOptimizePlan`: opрос статуса job'а в цикле до терминального статуса (ready|failed), интервал 2 c, бюджет ~3.2 мин (с запасом к 300 с job_timeout)
- Кнопка оптимизации/индикатор остаётся loading до терминального статуса; финальный toast — только по терминальному статусу с корректным modeLabel и degradation_reason
- Subscription в UI не меняется (адресать polling).

## Capabilities

### Modified Capabilities

- `ui` — статус «выполняется оптимизация» виден весь solve: кнопка в busy-состоянии до терминального статуса job'а, тост после финала с корректным режимом и причиной деградации.

## Impact
`frontend/src/api/queries.ts` (useOptimizePlan), `frontend/src/features/plan/PlanPage.tsx` (toast) — backend не трогаем (все статусы уже в GET).
