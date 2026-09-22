# Proposal: 035-dataset-gate

## Why

Рабочее пространство можно выбрать, но до загрузки датасета все плановые страницы/Form доступны с пустыми данными («падают», 404/пустые планы мешают юзеру). Посимвольный generosity владельца (лида): воркспейс «полностью отделён» — планирование закрывается до загрузки датасета через redirect на /data.

## What Changes

- Бэк: `GET /data/status` → `{dataset_loaded, counts}` (быстрый статус по org омпозиту PK 025)
- Фронт require-gate `RequireDataset`: /plan, /sprint, /team-map, /metrics — редирект на /data с banner «Загрузите датасет…»; /data и /workspaces доступны всегда
- Layout: до датасета пункты NAV плановых страниц серые (aria-disabled), клики не работают; активны только «Данные» и «Рабочие пространства»

## Capabilities

### Modified Capabilities

- `workspace` — вход в планирование SHALL требовать загруженный датасет в текущическом workspace: redirect на /data при пустом датасете.
- `ui` — пункты навигации планирования SHALL быть disabled до загрузки датасета.

## Impact
`src/api/routes.py`, `frontend/src/api/queries.ts`, `router.tsx` (RequireDataset), `Layout.tsx`, стили. Спеки workspace/ui/jobs.
