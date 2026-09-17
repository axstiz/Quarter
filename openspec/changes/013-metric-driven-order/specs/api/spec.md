# Update capability: api

## ADDED Requirements

### Requirement: Стратегия генерации и отчёты оптимизации

API SHALL предоставлять: `POST /plans/generate` с опциональным body `{"strategy": "metrics" | "priority"}` (дефолт `priority`); `GET /plans/{plan_id}/optimization-report` — сравнение текущего плана с приоритетным эталоном (KPI №1 прогноз, KPI №2 по спринтам, число закрываемых инициатив, перенесённые задачи); `GET /plans/{plan_id}/staffing-suggestions` — рекомендации по людям (см. capability planning).

#### Scenario: Генерация метрического плана

- **WHEN** POST /plans/generate с {"strategy": "metrics"}
- **THEN** 201 + plan_id; версия плана хранит стратегию; GET /plans/{plan_id} возвращает её

#### Scenario: Отчёт оптимизации

- **WHEN** GET /plans/{id}/optimization-report для метрического плана
- **THEN** ответ содержит сравнение с priority-эталоном: KPI №1 (факт/прогноз пометки), число закрываемых инициатив, отличия состава (какие задачи вошли/вышли) — без изменения базовой метрики (знаменатель — initial-план)
