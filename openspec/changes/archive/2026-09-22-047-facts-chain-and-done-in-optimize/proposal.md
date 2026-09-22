# Proposal: 047-facts-chain-and-done-in-optimize

## Why

Два бага на стыке версий плана:
1. Факты спринтов привязаны к версии, на которой их загрузили (`SprintFactORM.plan_id`). После пересчёта/оптимизации статистика новой версии (`/metrics`, `/warnings`, `/diff`, `/optimization-report`, `/advice`) не видит завершённые спринты — запрос шёл только по текущему plan_id.
2. `apply_draft` оптимизации писал только planned/postponed из черновика — выполненные по факту задачи (`done_actual`) не копировались в новую версию и пропадали с ганта и из «ролей по задачам».

## What Changes

- Helper `_plan_chain_ids` (текущая версия → root); запросы фактов во всех эндпоинтах статистики/метрик/советника — по всей цепочке версий (`plan_id.in_(chain)`)
- Загрузка факта: дубль спринта на любой версии цепочки → 409 (не только на исходной)
- `apply_draft`: `done_actual`-задачи исходной версии копируются в оптимизированную (как в `_recompute_plan_version`)
- QA live: metrics дочерней версии — спринт 1 pct 45.6 (не forecast); дубль факта → 409; оптимизированная версия содержит done_actual; metrics оптимизированной версии видит факт

## Capabilities

### Modified Capabilities

- `replanning` — видимость фактов по цепочке версий; сохранение done_actual при оптимизации.

## Impact
`src/api/routes.py`, `src/services/optimize_plan.py`, `tests/test_facts_chain_047.py`.
