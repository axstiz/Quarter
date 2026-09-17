# architecture Specification

## Purpose
Слои и стек бэкенда, правила изменения — чтобы командная разработка и агенты писали одинаково.

## Requirements

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

### Requirement: CORS для фронтенда

Бэкенд SHALL подключать CORSMiddleware с origins из env `CORS_ORIGINS` (разделитель — запятая); дефолт `*` (auth отсутствует до change 005, секретов нет; `allow_credentials=False` — сочетание `*`+credentials запрещено спецификацией CORS).

#### Scenario: Dev-сервер фронта на другом порте

- **GIVEN** фронтенд работает на http://localhost:5173, бэкенд на http://localhost:8000
- **WHEN** фронтенд выполняет запрос к `/api/v1/...`
- **THEN** ответ содержит заголовок `Access-Control-Allow-Origin`, запрос не блокируется браузером

#### Scenario: Конкретные origin через env

- **GIVEN** задано `CORS_ORIGINS=https://planner.example.com`
- **WHEN** запрос с Origin `https://planner.example.com`
- **THEN** запрос разрешён; запрос с прочих origin получает CORS-запрет браузера
