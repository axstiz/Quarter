# Proposal: 059-keep-done-actual-on-recompute

## Why

После загрузки факта 2-го спринта задачи, выполненные в 1-м, пропадали с ганта и из «по командам»: `_recompute_plan_version` копировал в новую версию только planned-строки, попавшие в done_ids; строки, уже имевшие статус `done_actual` (выполненные по прошлым фактам), молча отбрасывались.

## What Changes

- `_recompute_plan_version`: существующие `done_actual`-строки копируются в новую версию как есть (спринт, причина, SP, назначения); новые выполненные (planned → done_actual) — как раньше
- QA live: факт 1 (SRV-4023) → факт 2 (KP-3898) → в версии после 2-го факта done_actual обеих задач с корректными спринтами

## Capabilities

### Modified Capabilities

- `replanning` — сохранение выполненных по прошлым фактам задач при пересчёте.

## Impact
`src/api/routes.py`, тесты (`test_facts_chain_047.py::test_second_fact_keeps_first_sprint_done_items`).
