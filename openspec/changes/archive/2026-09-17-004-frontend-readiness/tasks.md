# Tasks: 004-frontend-readiness

## 1. CORS

- [x] 1.1 `CORSMiddleware` в `src/main.py`: origins из `settings.cors_origins` (запятая-разделённый), дефолт `*`; `allow_credentials=False`, `allow_methods=["*"]`, `allow_headers=["*"]`
- [x] 1.2 Настройка в `src/core/config.py` (pydantic-settings, поле `cors_origins` с alias `CORS_ORIGINS`/`POSTCODE_CORS_ORIGINS`)
- [x] 1.3 Тест: preflight/заголовки `Access-Control-Allow-Origin` (дефолт `*` и конкретный origin через env) — tests/test_frontend_readiness.py

## 2. Опечатка Swagger

- [x] 2.1 `src/main.py`: описание «Кор картальное» → «Квартальное»

## 3. Ручка bus-risk

- [x] 3.1 `services/bus_factor.py`: `plan_bus_risk(planned_items, tasks, engineers)` — planned-задачи с ролями factor ≤ 1 (нижний регистр); роль без носителей → holders = [] (виртуальный держатель)
- [x] 3.2 `GET /plans/{plan_id}/bus-risk` в `api/routes.py`: 404 на отсутствующий план; ответ `{total_at_risk, tasks:[{task_id, summary, sprint_no, at_risk_keys, holders}]}`
- [x] 3.3 Тесты: e2e-ручка на демо-датасете + 404; unit (одиночная роль / 2+ носителя / ноль носителей)

## 4. Документация

- [x] 4.1 `docs/api-contract.md`: секция CORS + пример ответа bus-risk
- [x] 4.2 `docs/product-plan.md`: виджет Bus-риска — «есть ручка»

## 5. Проверки

- [x] 5.1 `openspec validate --all` — 10 passed
- [x] 5.2 `uv run pytest tests/ -q` — 35 passed