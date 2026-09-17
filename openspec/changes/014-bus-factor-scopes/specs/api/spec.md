# Update capability: api

## ADDED Requirements

### Requirement: Фильтр области расчёта Bus Factor

API SHALL предоставлять фильтр области в `GET /bus-factor?scope_type={company|team}&scope_id={team_id}`: ответ содержит только items выбранной области (методика сохраняется); несуществующая область — 404 с идентификатором ошибки.

#### Scenario: Фильтр по команде

- **GIVEN** демо-датасет импортирован
- **WHEN** GET /bus-factor?scope_type=team&scope_id=Team-L
- **THEN** только team-items Team-L (роли и навыки с их факторами), methodology присутствует

#### Scenario: Несуществующая команда

- **WHEN** GET /bus-factor?scope_type=team&scope_id=NOPE
- **THEN** 404 с идентификатором ошибки

### Requirement: Bus Factor страницы команды

API SHALL предоставлять `GET /teams/{team_id}/bus-factor`: расчёт, фиксированный областью этой команды (roles + skills), с текстом методики и предупреждениями factor ≤ 1.

#### Scenario: Ручка страницы команды

- **WHEN** GET /teams/Team-K/bus-factor
- **THEN** 200: items только области team=Team-K, methodology присутствует; 404 для несуществующей команды
