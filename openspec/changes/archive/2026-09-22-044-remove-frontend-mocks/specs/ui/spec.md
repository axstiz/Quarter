# Update capability: ui

## ADDED Requirements

### Requirement: Фронт работает только с реальным бэком

Фронт SHALL ходить только в реальный API (Vite proxy → backend); мок-режим (src/mocks, VITE_API_MOCKS) SHALL быть удалён целиком. Локальная разработка требует поднятый бэк (docker compose api/db).

#### Scenario: Без бэка — без моков

- **GIVEN** бэк недоступен
- **WHEN** пользователь открывает фронт
- **THEN** ошибка сети видна (не подменённый мок-ответ); мок-режим не подменяет отказ
