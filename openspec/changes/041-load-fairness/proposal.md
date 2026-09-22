# Proposal: 041-load-fairness

## Why

Solver-отчёт агрегирован по всему кварталу, не видно per (команда, роль, спринт) — откуда было «0 SP» в одних спринтах и «90 из 80» в других (QA-находка). Вес teamUtilizationPenalty (50) слишком слаб против инициативной награды (100 000) — пустые спринты остаются.

## What Changes

- Оптимизационный отчёт: разбиение по (team × role × sprint): SP, часы, limit_hours командного лимита, within_norm — до и после solve
- Java: WEIGHT_UTILIZATION 50 → 100 (чуть-чуть, benchmark демо — если хуже, откатываю)
- Фронт: баннер-сводка после optimize («SP выровнялись: σ 12.6 → 5.8» и т.п., режим solver/heuristic + degradation_reason)

## Capabilities

### Modified Capabilities

- `ui` — сводка improvement после optimize на странице плана (закрываемый баннер)
- `planning` — численное обоснование целевой функции: util-вес 100, объяснимо в score_breakdown

## Impact
`docker-compose`/optimizer-конфиг без изменений; Java-констрейнты, `optimize_plan.py`, `PlanPage.tsx`.
