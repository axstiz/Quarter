# Update capability: api

## ADDED Requirements

### Requirement: Даты спринтов и прогнозные интервалы в ответе плана

`GET /plans/{plan_id}` SHALL дополнительно возвращать `sprint_dates` (sprint_no → {start, end}) и прогнозный интервал дат каждой запланированной задачи; существующие поля (decision/reason/SP/роли) не меняются — обратная совместимость.

#### Scenario: Даты в план-ответе

- **GIVEN** план со сгенерированным календарём
- **WHEN** GET /plans/{plan_id}
- **THEN** доп. поле sprint_dates есть; каждая запланированная задача дополнительно содержит date_forecast {start, end}

### Requirement: Форма факта с часами ролей

POST /plans/{plan_id}/sprints/{n}/facts SHALL принимать опциональное поле role_hours_fact (роль → часы); формат ответа прежний (new_plan_id).

#### Scenario: Факт с role_hours_fact

- **WHEN** POST .../facts с {"completed_task_ids": [...], "role_hours_fact": {"Тестировщик": 32}}
- **THEN** 200 с new_plan_id; 409 при повторе — как раньше
