# Proposal: 055-advisor-live-hiring

## Why

Советник на вопрос «кого нанять до 1 спринта?» отвечал generic-переносами задач: схема `AdviceItem.kind` не имела найма, в сводке не было данных о дефиците ролей, промпт не требовал отвечать на вопрос комментария. Плюс одиночный вызов GigaChat без ретраев делал советника «мёртвым» при 429/5xx/обрывах.

## What Changes

- `role_deficit_by_sprint(plan, engineers)`: требуемые часы роли (assignments плана) − суммарный лимит носителей в компании → `{sprint, role, deficit_hours, hires}` для всех 6 спринтов; попадает в facts_json
- `AdviceItem.kind` += `hiring`, поле `affected_roles`; промпт: первый совет отвечает на вопрос `user_comment`; найм — из блока дефицитов (честное «нанимать не требуется» при отсутствии дефицита)
- Fallback: детерминированный hiring-совет (при вопросе о найме — первым; дефицит в спринте 1 — и без вопроса)
- GigaChat-клиент: до 3 попыток с backoff (1с/2с) на транспортные сбои
- Фронт: лейбл «Найм» + отображение `affected_roles`
- QA live: GigaChat отвечает kind=hiring первым советом с реальными дефицитными ролями (Руководитель проекта, Специалист поддержки, Архитектор 1С…)

## Capabilities

### Modified Capabilities

- `metrics` — AI-советник: найм по дефициту ролей, живость GigaChat.

## Impact
`src/ai/pipelines/advisor.py`, `src/ai/gigachat.py`, `src/api/routes.py`, `frontend/src/features/plan/AdvicePanel.tsx`, `frontend/src/api/types.ts`, тесты.
