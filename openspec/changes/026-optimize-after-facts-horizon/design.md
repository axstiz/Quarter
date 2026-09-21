# Design: 026-optimize-after-facts-horizon

## Context

`run_optimization` строит снапшот через `build_snapshot(tasks_map, ...)` — все не-Done задачи мира, горизонт `1..6`. Факты (`SprintFactORM.completed_task_ids`) не влияют на снапшот: статусы задач в таблице фактами не обновляются, поэтому выполненные задачи участвуют в расстановке заново. Горизонт не сужается — solver может размещать части в прошедшие спринты.

## Goals / Non-Goals

- **Goals**: снапшот и эвристика строятся от контекста текущей версии (done-фильтр, суженный горизонт); без фактов поведение идентично прежнему.
- **Non-Goals**: авто-запуск оптимизации после факта (решение — ручная цепочка «факт → recompute → Оптимизировать»); перенос пинов при recompute; изменения Java-сайдкара и контракта `/solve`.

## Decisions

1. **done-множество — по workspace, как в `build_report`**: все `SprintFactORM.completed_task_ids` workspace ∪ data-Done. Факты привязаны к версии плана, но `build_report` уже читает их по workspace — единая семантика, одна точка истины для KPI и снапшота.
2. **Горизонт из `recomputed_after_sprint` исходной версии**: `first_free = (source.recomputed_after_sprint or 0) + 1`. Цепочка версий: optimization-версия наследует parent, у initial — 0.
3. **Сигнатура `build_snapshot(..., done_ids=frozenset(), first_free_sprint=1)`** — дефолты сохраняют прежнее поведение существующих вызовов (sidecar-тесты, advisor-факты не меняются).
4. **`_heuristic_draft` фильтрует задачи и передаёт `first_free_sprint` в `generate_plan`** — тот же механизм, что в `_recompute_plan_version`; переиспользуем, не дублируем.
5. **Валидация без изменений**: черновик в принципе не может содержать прошедшие спринты (их нет в снапшоте) и выполненные задачи — `validate_draft`/`allocate_engineers` не трогаем.

## Risks / Trade-offs

- Фильтр по workspace-фактам включает факты «чужих» версий-цепочек в том же workspace — принят (та же семантика уже в KPI); в демо один workspace-цикл.
- Solver получает меньше задач → score ниже прежнего — ожидаемо, отчёт сравнивает before/after корректно (обе стороны от фактов).

## Migration Plan

Без миграций: параметры с дефолтами, БД-схема не меняется.

## Open Questions

- Нет — демо-сценарий и права подтверждены (ручная цепочка, авто-запуск отложен).
