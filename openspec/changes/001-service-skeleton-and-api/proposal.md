# Change: 001-service-skeleton-and-api

## Why

Проект на этапе данных и спек есть только логики (6 capability-спек) и dataset. Сервиса нет: нет ни каркаса бэкенда, ни API. Чтобы команда могла параллелённую разработку по спекам (planning, replanning, star-map, metrics), нужен сервисный фундамент и стабильно описанные API-ручки.

## What changes

1. Каркас бэкенда: FastAPI + SQLAlchemy (async) + alembic, подъём через docker-compose (postgres:16-alpine), fallback SQLite через env для тестов.
2. Перегонка dataset/*.csv в PostgreSQL при старте/загрузчике (`POST /api/v1/data/import`); исходный xlsx остаётся source of truth (спека data).
3. Новый domain-слой, сервисы: capacity (velocity×0.8, 80/40 ч), dependencies (топология), planner (жадный: СП + часы ролей + зависимости + причины), replanner (факт → пересчёт + 4 вида warnings), starmap и bus_factor, metrics.
4. REST API по спеке `api` (список ручек ниже), автодокументация OpenAPI (/docs).
5. Spec deltas: новые capability `api` и `architecture`.

## Non-goals

- Фронтенд (SPA) — отдельный change после созвона.
- Оптимизационный планировщик (MILP/оптимизация) — жадная эвристика с объяснением причин; улучшение последующим change.
- Методика Bus Factor — заглушка-допущение (число носителей компетенции в области, грейд не влияет); change после созвона (запланировано в spec bus-factor).
- Аутентификация, мульти-user доступ.

## Risks

- Жадный planner может давать неоптимальные планы — компенсируется объяснениями причин и станет лучше в последующих changes (задание требует объяснимость, а не оптимальность).
- NixOS-особенность этого проекта: uv run требует LD_LIBRARY_PATH (решение автоматически в .githooks/env.sh); у разработчиков на других ОС неактуально.
