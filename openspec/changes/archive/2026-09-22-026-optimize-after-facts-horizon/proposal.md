# Proposal: 026-optimize-after-facts-horizon

## Why

Оптимизация плана (`POST /plans/optimize`) после загрузки фактов спринта работает некорректно: снапшот для solver'а строится из всего мира без учёта выполненных по факту задач (статусы задач в данных фактами не обновляются) и с полным горизонтом спринтов 1..6. В результате solver может заново спланировать уже выполненные задачи и расставить остаток в прошедшие спринты.

## What Changes

- `build_snapshot` получает параметры `done_ids` (выполненные задачи: факт + data-Done) и `first_free_sprint` (первый незавершённый спринт): выполненные задачи не попадают в снапшот, горизонт сужается до `range(first_free_sprint, 7)`
- `run_optimization` вычисляет контекст из исходной версии плана: `first_free = (recomputed_after_sprint or 0) + 1`, `done_ids` = `completed_task_ids` фактов workspace ∪ data-Done
- `_heuristic_draft` (деградация без solver) получает те же параметры: фильтр задач + `generate_plan(first_free_sprint=...)`
- Цепочка «факт → recompute → кнопка Оптимизировать» даёт корректную optimization-версию: без выполненных задач и без items в прошедших спринтах

## Capabilities

### Modified Capabilities

- `planning` — уточнение требования «Оптимальная расстановка запускается по кнопке и применяется сразу»: снапшот/эвристика строятся от текущей версии плана с учётом фактов (done-фильтр) и суженного горизонта спринтов (после `recomputed_after_sprint`).

## Impact

- `src/services/optimizer_client.py` — сигнатура `build_snapshot`, фильтр задач, горизонт спринтов
- `src/services/optimize_plan.py` — `run_optimization` (контекст фактов/горизонта), `_heuristic_draft` (параметры)
- `tests/test_optimize_jobs.py` — +2 теста инвариантов (solver-режим и heuristic-режим)
- Обратная совместимость: без фактов поведение идентично прежнему (`done_ids` пуст, `first_free_sprint = 1`); Java-контракт не меняется
