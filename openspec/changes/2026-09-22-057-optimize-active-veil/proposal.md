# Proposal: 057-optimize-active-veil

## Why

Вуаль «solver работает» на странице плана была привязана к состоянию mutation: пользователь запустил оптимизацию, ушёл на другую страницу, вернулся — вуаль пропала, хотя solver ещё считает; кнопку «Оптимизировать» можно было нажать повторно (409 с бэка).

## What Changes

- `GET /plans/optimize/active`: текущая активная задача оптимизации workspace (queued/solving) или null; зарегистрирована до роута `{job_id}` (иначе «active» ушло бы в path-параметр)
- Фронт: `useActiveOptimizeJob` — глобальный опрос (2 с пока активна, 4 с в фоне); переход «активна → завершена» инвалидирует кэш планов (новая версия подтянется, где бы пользователь ни был)
- PlanPage: вуаль и статус показываются по активному job независимо от навигации; кнопка «Оптимизировать» disabled с индикатором, пока solver занят

## Capabilities

### Modified Capabilities

- `planning` — видимость активной оптимизации независимо от навигации.

## Impact
`src/api/routes.py`, `frontend/src/api/{endpoints,queries}.ts`, `frontend/src/features/plan/PlanPage.tsx`, тесты.
