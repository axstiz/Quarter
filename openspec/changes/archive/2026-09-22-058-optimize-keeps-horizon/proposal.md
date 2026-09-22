# Proposal: 058-optimize-keeps-horizon

## Why

После загрузки факта спринта 1 пользователь оптимизировал — и solver ставил задачи в закрытый спринт 1. Корень: `apply_draft` создавал оптимизированную версию БЕЗ `recomputed_after_sprint` — горизонт «спринт 1 закрыт» терялся; следующая оптимизация этой версии считала `first_free = 1`.

## What Changes

- `apply_draft`: оптимизированная версия наследует `recomputed_after_sprint` от исходной
- `run_optimization`: горизонт = `max(recomputed_after_sprint версии, последний загруженный факт workspace) + 1` — устойчиво к версиям, созданным до фикса (поле потеряно, но факты есть)
- QA live: факт спринта 1 → optimize (after=1 унаследован) → повторный optimize → planned-части только в спринтах 2–6

## Capabilities

### Modified Capabilities

- `planning` — оптимизация сохраняет горизонт закрытых фактом спринтов.

## Impact
`src/services/optimize_plan.py`, тесты (`test_optimize_jobs.py::test_optimize_after_fact_keeps_horizon`).
