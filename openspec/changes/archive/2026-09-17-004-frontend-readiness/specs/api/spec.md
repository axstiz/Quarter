# Update capability: api

## ADDED Requirements

### Requirement: Ручка Bus-риска плана

API SHALL предоставлять GET /plans/{plan_id}/bus-risk: задачи плана (decision=planned), зависящие от компетенций/ролей с Bus Factor ≤ 1, с указанием одиночных носителей; роли без носителей тоже считаются риском (виртуальный держатель).

#### Scenario: Задачи под угрозой

- **GIVEN** план содержит задачу с требуемой ролью, носитель которой в компании единственный
- **WHEN** GET /plans/{plan_id}/bus-risk
- **THEN** ответ содержит задачу с at_risk_keys=[роль], holders=[engineer_id]

#### Scenario: Нет риска

- **GIVEN** все роли задач плана имеют ≥2 носителей
- **WHEN** GET /plans/{plan_id}/bus-risk
- **THEN** total_at_risk = 0, tasks = []

#### Scenario: План не найден

- **WHEN** GET /plans/nonexistent/bus-risk
- **THEN** 404 с идентификатором ошибки в теле
