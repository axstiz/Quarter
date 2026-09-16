# Tasks: 001-service-skeleton-and-api

## 1. Каркас

- [x] 1.1 Зависимости: fastapi, uvicorn[standard], sqlalchemy[asyncio], asyncpg, aiosqlite, alembic, pydantic-settings, httpx (для проверки тестами API)
- [x] 1.2 docker-compose.yml: postgres:16-alpine, volume, healthcheck; README-инструкция
- [x] 1.3 src/core/config.py (DSN по env, DATABASE_URL), src/main.py: FastAPI, lifespan, /healthz, подключение роутеров
- [ ] 1.4 alembic init + миграция 0001 (таблицы импорта и планов)

## 2. Данные

- [x] 2.1 db/models.py: tasks, engineers_profiles, task_dependencies, task_role_requirements, team_history, plans, plan_items, sprint_facts
- [x] 2.2 db/importer.py: dataset/*.csv → БД (все 7 csv, без правок трансформаций; counts сверяются с README)
- [x] 2.3 POST /api/v1/data/import

## 3. Domain и сервисы

- [x] 3.1 domain: Task, Engineer, TeamHistory, PlanRequest, Plan, PlanItem, Explanation, Warning, BusFactorReport, MetricsReport
- [x] 3.2 services/capacity.py: team capacity по velocity×0.8; часы ролей по capacity_rate (макс 80/40 ч за спринт)
- [x] 3.3 services/dependencies.py: топологическая сортировка, выборка цепочек за блюкером
- [x] 3.4 services/planner.py: жадный planner на 6 спринтов с reasons (planned/postponed/cancelled)
- [x] 3.5 services/replanner.py: факт спринта → пересчёт остатка, warnings (4 вида из spec replanning), diff планов
- [x] 3.6 services/starmap.py, bus_factor.py, metrics.py

## 4. Тесты

- [x] 4.1 юнит-тесты сервисов (pytest, SQLite in-memory): capacity, dependencies+cycles, planner, replanner warnings, starmap, bus_factor, metrics
- [x] 4.2 smoke-тесты API (TestClient): /healthz, generate plan, facts → warnings, star-map

## 5. API

- [x] 5.1 /api/v1/plans (generate/get/explanation) с pydantic-контрактами
- [x] 5.2 /api/v1/plans/{plan_id}/sprints/{n}/facts, /warnings, /diff
- [x] 5.3 /api/v1/teams, /engineers/{id}, /star-map/summary, /bus-factor
- [x] 5.4 /api/v1/plans/{id}/metrics

## 6. Проверки и доки

- [x] 6.1 README: быстрый старт (docker compose, uv run uvicorn), curl-примеры
- [x] 6.2 openspec validate --all; pytest зелёный; dataset byte-идентичен
