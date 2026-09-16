# New capability: architecture

## Purpose

Слои и стек бэкенда, правила изменения — чтобы командная разработка и агенты писали одинаково.

## ADDED Requirements

### Requirement: Слои и стек

Бэкенд SHALL состоять из слоёв api (тонкие роутеры), services (бизнес-логика без HTTP), db (SQLAlchemy async + alembic), domain (pydantic), на стеке Python 3.13 + uv, FastAPI, PostgreSQL через docker-compose (fallback SQLite через env — для тестов).

#### Scenario: Новый эндпоинт

- **WHEN** разрабатывается новая ручка
- **THEN** логика размещается в services/, роутер остаётся тонким, схема ответа — в domain/

### Requirement: Импорт данных

Бэкенд SHALL импортировать dataset/*.csv в БД через db/importer.py; source of truth остаётся xlsx (capability data).

#### Scenario: Повторный импорт

- **WHEN** POST /api/v1/data/import после правки xlsx
- **THEN** датасет загружается заново, hồнакопленные планы не затрагиваются

### Requirement: Конфигурация через env

Конфигурация (DSN БД, пути dataset) SHALL задаваться переменными окружения с дефолтами, позволяющими запустить без настройки.

#### Scenario: Чистая машина

- **GIVEN** docker compose up и uv run uvicorn без .env
- **THEN** сервис поднимается со стандартной DSN localhost postgres
