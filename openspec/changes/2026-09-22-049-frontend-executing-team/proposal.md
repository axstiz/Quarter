# Proposal: 049-frontend-executing-team

## Why

После 048 API отдаёт честного исполнителя части (`team_id`) и владельца (`owner_team_id`), но фронт в трёх местах опирался на первую попавшуюся часть задачи: RolesView mini-stats приписывал весь SP задачи одной команде, Гант группировал/фильтровал cross-team задачу только по одной команде, TaskPanel не показывал различие «владелец vs исполнитель».

## What Changes

- `planModel`: `TaskSummary.exec_teams` — все команды-исполнители частей задачи
- RolesView: mini-stats SP по `row.team_id` (исполнитель каждой части)
- Гант: группировка по командам — задача входит во **все** группы своих исполнителей; фильтр по команде находит cross-team задачу; чип команды при группировке по инициативам показывает всех исполнителей
- TaskPanel: строка «Исполнители: владелец → исполнители» для cross-team задач
- `types.ts`: `PlanTask.owner_team_id`

## Capabilities

### Modified Capabilities

- `planning` — отображение команды-исполнителя на фронте (продолжение 048).

## Impact
`frontend/src/lib/planModel.ts`, `frontend/src/api/types.ts`, `RolesView.tsx`, `GanttView.tsx`, `TaskPanel.tsx`. Бэк не тронут (048 уже отдаёт данные).
