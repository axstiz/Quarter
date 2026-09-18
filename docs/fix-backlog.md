# Backlog: известные недоделки после влития feature-веток (2026-09-18)

Ветки 005/007/008/009 содержат каркасы (~25–50% от tasks.md), влиты ради
дальнейшей сборки на них. Старые тесты проходят, потому что enforcement не
включён. Порядок правок — по зависимостям.

## 1. Auth enforcement (base для всего остального) — change 005

- [ ] Подключить `get_current_user` ко всем ручкам `/api/v1` в `src/api/routes.py` и `src/api/crud.py` (сейчас там везде bare `Depends(get_session)` — неавторизованный доступ ко всему).
- [ ] Роли reader/editor/admin фактически не проверяются нигде.
- [ ] Перевести e2e-фикстуры (`tests/test_api.py`, `test_onboarding.py`, …) на сессию.
- [ ] Дефолт CORS `cors_origins` не должен быть `*` в проде.
- [ ] PBKDF2 заменить на bcrypt/argon2 (tasks 4.2 change 005) — или зафиксировать отклонение в спеке.

## 2. Permissions: убрать подделываемые заголовки — change 009

- [ ] `src/api/permissions.py::require_permission` берёт роль из заголовка `X-User-Role` (`editor` по умолчанию!) — заменить на роль из membership/workspace бэка (после п.1 и п.3).
- [ ] Подключить `require_permission(...)` к изменяющим ручкам (0 вызовов сейчас).
- [ ] Протестировать reader 403 / editor 403 / admin 200 на реальных ручках.

## 3. Workspace: полная изоляция — change 008

- [ ] Фильтр `workspace_id` подключён только в 5 местах `routes.py`; планы, факты спринтов, warnings/diff/metrics/explanation, bus-factor, star-map, priority/cancel и CRUD видят чужие данные.
- [ ] 403/404 для не-участников workspace.
- [ ] PUT/DELETE workspace и members-ручки — только admin; удаление с подтверждением.
- [ ] `upload_jobs` не содержит workspace_id (change 007 влит раньше).

## 4. Jobs: фоновая обработка отсутствует — change 007

- [ ] Влита только персистентность job-состояния. Нет очереди/воркера/таймаутов/повторов — LLM-фаза всё ещё синхронна в HTTP-запросе.
- [ ] README «Фоновые задачи», compose с воркером (tasks 4.x).

## 5. Прочее, найденное при влитии

- [ ] `src/load_world`: `spent_time` жёстко `0.0` (routes.py `load_world`) — InProgress-остаток в API всегда полный.
- [ ] `src/api/routes.py`: `/warnings` и `/diff` используют наивный виртуальный сдвиг `_recomputed_plan` вместо реальной chain-версии плана после recompute.
- [ ] Дубли seed-логики UserORM устранены, но проверить уникальность `email` при повторном регистре (конфликт-правка models.py).
- [ ] `frontend/` не rebase'ился: тест готовости `tests/test_frontend_readiness.py` зелёный, но контракт 35 ручек см. `docs/api-contract.md` — сверить с `openapi.json` после влитий.
