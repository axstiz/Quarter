# Контракт API (v1) для фронтендера

Все ручки под префиксом `/api/v1` (кроме `/healthz`). Полная машина-читаемая схема — **`openapi.json` в корне репо** (OpenAPI 3), импортируется в Postman/Insomnia или в `openapi-typescript`. Живой UI — `http://localhost:8000/docs` (Swagger).

Ответы ниже — **реальные примеры с демо-датасета** (45 задач / 34 инженера / 6 спринтов). Пример транслитерирован без требуемой аутентификации (change 005).

## Подъём бэка

```bash
docker compose up -d      # PostgreSQL
uv sync                   # зависимости
uv run uvicorn src.main:app --reload
# NixOS: после каждого uv sync — ./scripts/fix-venv-nix.sh
```

Правила: не менять `dataset/*.csv` руками (правки только через xlsx/скрипт); auth секции пока нет (change 005) — все ручки открыты; все ответы JSON, коды 200/201/400/404/409/422.

---

## Стр. 0.1 «Загрузка данных»

| Ручка | Метод | Вход | Ответ |
|---|---|---|---|
| Upload файла | `POST /data/upload` | multipart: `file` (xlsx/csv/json) | job: `job_id`, `status` (ready/questions), превью маппинга |
| Статус/превью | `GET /data/jobs/{job_id}` | — | job снапшот (status, column_guesses, questions, preview_counts) |
| Ответы на вопросы маппинга | `POST /data/jobs/{job_id}/answers` | `{"answers":{"колонка":"entity.field"}}` | обновлённый job |
| Импорт подтверждения | `POST /data/jobs/{job_id}/confirm` | — | counts по сущностям |
| Повторный прого́н пайплайна | `POST /ai/normalize/{job_id}` | — | job снапшот |
| CRUD (опц-ные поля) | `POST/PUT/DELETE /engineers, /tasks, /dependencies, /teams` | JSON-тело | `{"status":"created|updated|deleted",...,"source":"manual"}` |

Пример `POST /data/upload` → 201:
```json
{"job_id":"<uuid>","filename":"Датасет_с_правками_основной.xlsx","status":"ready",
 "column_guesses":[{"column":"task_id","entity":"task","field":"task_id","confidence":"high"}],
 "questions":[],"unmapped":[],
 "preview_counts":{"task":112,"engineer":57,"role_requirement":23,"dependency":16,"team_history":12}}
```
Наш формат (датасет организаторов) маппится автоматически — `questions` пусто; для незнакомых форматов появится массив вопросов (каждый: `{question, options:["пропустить"], context_column}`).

Пример `POST /data/jobs/{id}/confirm` → 200:
```json
{"status":"confirmed","counts":{"tasks":45,"engineers":30,"dependencies":15,"team_history":12,"role_requirements":359}}
```

## Стр. 1 «План квартала» (дашборд)

| Ручка | Метод | Вход | Что даёт |
|---|---|---|---|
| Сгенерировать план | `POST /plans/generate` | — | 201 + `{plan_id, sprints}`; при пустой БД — 400 (значит, сначала импорт) |
| План по спринтам | `GET /plans/{id}` | — | 6 спринтов, у каждой задачи: decision (planned/postponed/cancelled/cancelled_pending/done_actual), reason, SP, summary, часы ролей, parent_id, team_id |
| Список версий | `GET /plans` | — | цепочка снапшотов (initial → recompute), чтобы дашборд знал «актуальный план» |
| Зависимости | `GET /dependencies` | — | 15 пар (blocking/blocked) |
| Приоритет (human) | `PUT /tasks/{task_id}/priority` | `{"priority": 1}` | порядок задач (меньше — раньше); после пересчёта применяется |
| Отмена (двухшаговая) | `POST /plans/{id}/tasks/{tid}/cancel-request` → `.../confirm-cancel` | | postponed → cancelled_pending → cancelled |

Пример объекта задачи в `GET /plans/{id}`:
```json
{"task_id":"AI-301","decision":"planned","sprint_no":1,"reason":"","step_points_sp":6.0,
 "summary":"Разметка датасета диалогов и пилотное обучение LLM","parent_id":"BR-157",
 "estimation_sp":6.0,"estimated_hh":150.0,"planned_in_sprint":true,"team_id":"Team-L",
 "role_hours":{"Аналитик Big Data":50.0,"Разработчик Big Data":50.0,"Руководитель BigData":50.0}}
```

Паренты дают и «инициативы» (grouping по parent_id) — для виджета метрик и фильтра.

## Стр. 2 «Спринт: факт и пересчёт»

- `POST /plans/{id}/sprints/{1..6}/facts` — **после факта создаётся новая версия плана**; в ответе `new_plan_id` (дальше UI переключается на неё). Повторный факт того же плана/спринта — **409**.
- `POST /plans/{id}/recompute` — кнопка «Пересчитать» (создаёт ещё одну версию).
- `GET /plans/{id}/facts` — какие спринты «зафиксированы»:

```json
[{"sprint_no":1,"completed_sp":10.0,"completed_task_ids":[],"notes":""}]
```

- `GET /plans/{id}/warnings` — риски после факта (4 вида):

```json
[{"kind":"dependency_shift","message":"сдвиг цепочки зависимых задач из-за невыполнения блокирующих","task_ids":["AI-301","ANL-3041"]},
 {"kind":"composition_change","message":"состав плана изменился: -['AI-302', …]","task_ids":["AI-302","AI-303"]}]
```

`kind` ∈ `deadline_overflow | dependency_shift | role_deficit | composition_change`.

- `GET /plans/{id}/diff` — сдвиги: `{"moved":[{"task_id":…,"from_sprint":1,"to_sprint":2}],"postponed_now":[…]}`.

## Стр. 3 «Звёздная карта»

- `GET /teams` — все команды с составом.
- `GET /teams/{team_id}` — подробнее: `{"team_id","members":[…],"capacity_sp_per_sprint":8.0,"sprint_history":[…]}`
- `GET /engineers?team_id=&role=&grade=&skill=&min_rate=` — фильтры для «выбрать тех или иных».
- `GET /engineers/{engineer_id}` — профиль: все команды (parttime), часы/спринт, single_holder_alerts.
- `GET /star-map/summary` — сводные: teams, fte_distribution, single_holder_competencies (focus-подсветка).
- `GET /bus-factor` — расчёт + **методика** (поле methodology — показывать обязательно).

## Стр. 4 «Метрики»

- `GET /plans/{id}/metrics` — от **первоначального плана** (изменения плана не подменяют знаменатель!):

```json
{"quarter_completion_pct":0.0,"quarter_completion_is_forecast":true,
 "sprint_completion_pct":{"1":18.2,"2":null,"3":null,"4":null,"5":null,"6":null},
 "sprint_completion_is_forecast":{"1":false,"2":true,"3":true,"4":true,"5":true,"6":true}}
```

## Модель job'ов (upload)

`status` ∈ `uploaded | mapping | questions | ready | confirmed | failed`.
Polling `GET /data/jobs/{job_id}` раз в ~500–1000 мс; продвинутые состояния вопросов — по ответам пользователя (`POST .../answers`) и снова polling.

## Коды ошибок

- 400 — нет данных (импортируй сначала), 404 — объект не найден, 409 — конфликт (повторный факт, повторное создание, отменена-pending отсутствует), 422 — неверный формат (см. detail).

## Мок-режим для разработки без бэка (по решению лида)

Бэкенд НЕ заглушается: все ручки реальные и быстрые. Если нужна временная «мок-версия» на фронте (нет сети/docker), в контракте достаточно трёх моков:
1. `GET /plans/{id}` — заменить на фиксированный JSON (образец выше);
2. `GET /bus-factor` — фиксированные items+methodology;
3. `POST /plans/{id}/sprints/{n}/facts` — эмулировать 200 + new_plan_id.

Всё остальное — просто fetch с этими JSON. Не смешивайте моки с реальными ручками: `mock`-флаг хранится в фронте, в бэк ничего не лезет.
