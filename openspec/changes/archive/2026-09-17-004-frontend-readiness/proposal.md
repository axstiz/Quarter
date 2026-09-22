# Change: 004-frontend-readiness

## Why

Фронтендер начинает разработку (user flow v0.4 в docs/product-plan.md). Три блокера/пробела:

1. **CORS отсутствует**: dev-сервер фронта (Vite/webpack, порт 3000/5173) обращается к бэку на :8000 — браузер без `CORSMiddleware` заблокирует все запросы. Старта фронта без этого нет.
2. **Опечатка** в описании Swagger («Кор картальное») — мелочь, но это лицо-API при проверке задания.
3. **Виджет Bus-риска дашборда** (change 004 по роадмапу) требует склейки `role_hours` задач плана и `/bus-factor` на фронте — ломает самодостаточность контракта. Нужна единая ручка `GET /plans/{id}/bus-risk`.

## What changes

1. **CORS**: в `src/main.py` подключается `CORSMiddleware`; `allow_origins` задаётся env-ом `CORS_ORIGINS` (список через запятую); дефолт `*` — auth ещё нет (change 005), секретов нет.
2. **Опечатка**: описание FastAPI «Кор картальное» → «Квартальное».
3. **Ручка `GET /api/v1/plans/{plan_id}/bus-risk`**: сервисная функция в `services/bus_factor.py` (`plan_bus_risk`) сопоставляет запланированные задачи плана с компетенциями/ролями Bus Factor ≤ 1 (область company, плюс роли без носителей — виртуальные держатели); ответ: всего под угрозой, список `{task_id, summary, sprint_no, at_risk_keys, holders}`.

## Non-goals

- Auth (change 005) — пока все ручки открыты.
- Frontend UI (change 006) — только ручка и CORS.
- Изменение planner/metrics — не трогаем.

## Risks

- `allow_origins=["*"]` с `allow_credentials=True` запрещён спецификацией CORS — используем `allow_credentials=False`, т.к. auth нет; при появлении auth (005) env переводится на конкретные origin.
- Роли задач хранятся как в датасете («Разработчик Java»), в bus-factor они нормализуются `.lower()` — сопоставление делаем так же, нечувствительно к регистру.
