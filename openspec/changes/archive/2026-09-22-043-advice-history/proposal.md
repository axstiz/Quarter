# Proposal: 043-advice-history

## Why

Совет AI-советника слетает при переключении вкладок (локальный useState в панели), а результаты не сохраняются — пользователь не может перечитать советы позже. Решение лида: советы сохраняются в историю с версией плана и комментарием (меняет семантику спеки 015).

## What Changes

- Бэк: `AdviceReportORM` (advice_id, workspace_id, plan_id, mode, advice JSON, comment, comment_considered, created_at); POST /plans/{id}/advice записывает прогон; GET /plans/{id}/advice/history — история по версии плана с version_label (номер версии + дата)
- Фронт: совет уходит из локального state в react-query (ключ ['advice', planId], manual refetch) — не слетает при переключении вкладок/закрытии панели; секция «История советов» с версией, временем, режимом, комментарием; раскрытие — advice items прогона
- Спек-дельта planning: советы сохраняются с комментарием (меняет «комментарий никогда не сохраняется» из 015), история по версии плана

## Capabilities

### Modified Capabilities

- `planning` — AI-советник пересчёта: прогоны сохраняются в историю (comment теперь сохраняется), история per-plan_id с version_label
- `ui` — панель советов не теряет состояние при переключении вкладок; история советов видна с версией

## Impact
`src/db/models.py`, `src/api/routes.py`, `src/ai/pipelines/advisor.py` (без изменений логики), `frontend/src/features/plan/AdvicePanel.tsx`, `queries.ts`.
