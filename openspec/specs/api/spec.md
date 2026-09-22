# api Specification

## Purpose
Контракт REST API сервиса (v1). Все логические требования спек (planning, replanning, star-map, bus-factor, metrics) выражаются через эти ручки. Автодокументация OpenAPI на /docs.

## Requirements

### Requirement: Планирование через API

Система SHALL предоставлять ручки генерации и чтения квартального плана.

#### Scenario: Генерация плана

- **WHEN** POST /api/v1/plans/generate
- **THEN** создаётся план на 6 спринтов, возвращается 201 с plan_id

#### Scenario: Чтение плана с причинами

- **WHEN** GET /api/v1/plans/{plan_id}
- **THEN** ответ содержит распределение задач по спринтам и решение по каждой задаче (planned/postponed/cancelled) с причиной

### Requirement: Пересчёт и риски через API

Система SHALL предоставлять ручки загрузки факта спринта, предупреждений о рисках и diff планов.

#### Scenario: Загрузка факта спринта

- **WHEN** POST /api/v1/plans/{plan_id}/sprints/{n}/facts
- **THEN** план пересчитывается; повторная загрузка факта того же спринта возвращает 409

#### Scenario: Риски плана

- **WHEN** GET /api/v1/plans/{plan_id}/warnings
- **THEN** ответ содержит предупреждения 4 видов (выход за квартал, сдвиг цепочки, дефицит ролей, изменения состава) с причинами

### Requirement: Звёздная карта через API

Система SHALL предоставлять ручки команд, инженеров, сводки star-map и Bus Factor с методикой.

#### Scenario: Bus Factor с методикой

- **WHEN** GET /api/v1/bus-factor
- **THEN** ответ содержит расчёт и текстовое описание методики и области расчёта

### Requirement: Метрики через API

Система SHALL предоставлять ручку метрик плана с пометкой факт/прогноз.

#### Scenario: Метрики середины квартала

- **WHEN** GET /api/v1/plans/{plan_id}/metrics до завершения квартала
- **THEN** фактические и прогнозные значения помечены соответственно

### Requirement: Коды ответов

Система SHALL возвращать осмысленные HTTP-коды: 404 для отсутствующих объектов, 409 для конфликтов, 422 для нарушенного формата.

#### Scenario: Несуществующий план

- **WHEN** GET /api/v1/plans/nonexistent
- **THEN** 404 с идентификатором ошибки в теле

### Requirement: Ручки онбординга

API SHALL предоставлять: POST /data/upload (загрузка файла → job), GET /data/jobs/{job_id} (статус/вопросы/превью), POST /data/jobs/{job_id}/answers, POST /data/jobs/{job_id}/confirm, POST /ai/normalize/{job_id}, и CRUD по сущностям: /teams, /engineers, /tasks, /dependencies (POST/PUT/DELETE) с опциональными полями.

#### Scenario: CRUD человека

- **WHEN** POST /engineers с минимальным телом (id, team, роль)
- **THEN** 201, source=manual

#### Scenario: Прогресс job

- **WHEN** GET /data/jobs/{job_id} во время LLM-фазы
- **THEN** status: mapping|questions|ready|confirmed|failed

### Requirement: AI-слой

AI-пайплайны SHALL жить в src/ai (LangGraph-графы, клиент провайдера, JSON-схемы); вызовы LLM всегда через pydantic-валидацию; клиент GigaChat конфигурируется env-ом, отсутствие ключа ≤ слой деградации (шаблонные маппинги). Ошибка инициализации SDK (недоступный/неверный CA-бандл и т.п.) SHALL превращаться в деградацию fallback (advice 200, mode=fallback), а не 500.

#### Scenario: Новая AI-фича

- **WHEN** добавляется AI-советник (change 003+)
- **THEN** он реализуется новым графом в src/ai/pipelines с общей обёрткой провайдера

#### Scenario: CA-бандл недоступен

- **GIVEN** GIGACHAT_CA_BUNDLE указывает на файл, которого нет в контейнере
- **WHEN** GET /plans/{id}/advice
- **THEN** 200, mode=fallback (советы детерминированные), не 500

#### Scenario: LLM-режим при валидном бандле

- **GIVEN** CA-бандл смонтирован и валиден
- **WHEN** GET /plans/{id}/advice
- **THEN** mode=llm при живом ключе GigaChat

### Requirement: Ручки приоритета и отмены

API SHALL предоставлять: PUT /tasks/{task_id}/priority (перестановка порядка), POST /plans/{plan_id}/tasks/{task_id}/cancel-request (сервис предлагает отмену), POST /plans/{plan_id}/tasks/{task_id}/confirm-cancel (лид подтверждает).

#### Scenario: Подтверждение отмены

- **WHEN** POST confirm-cancel на отложенную (cancelled_pending) задачу
- **THEN** решение задачи становится cancelled с фиксацией причины

# Update capability: data

### Requirement: Seed приоритетов

Первичный импорт SHALL заполнять приоритеты задач: задачи заказчика (`planned_in_sprint='Да'`) получают высокий приоритет; остальным — исходный порядок следования, растущий с порядком. Допущение фиксируется в README по capability data.

#### Scenario: Seed приоритета

- **GIVEN** задачи с пустым полем priority
- **WHEN** импортируется датасет
- **THEN** задачам с флагом заказчика присваивается приоритет выше прочих

### Requirement: Ручка Bus-риска плана

API SHALL предоставлять GET /plans/{plan_id}/bus-risk: задачи плана (decision=planned), зависящие от компетенций/ролей с Bus Factor ≤ 1, с указанием одиночных носителей; роли без носителей тоже считаются риском (виртуальный держатель).

#### Scenario: Задачи под угрозой

- **GIVEN** план содержит задачу с требуемой ролью, носитель которой в компании единственный
- **WHEN** GET /plans/{plan_id}/bus-risk
- **THEN** ответ содержит задачу с at_risk_keys=[роль], holders=[engineer_id]

#### Scenario: Нет риска

- **GIVEN** все роли задач плана имеют ≥2 носителей
- **WHEN** GET /plans/{plan_id}/bus-risk
- **THEN** total_at_risk = 0, tasks = []

#### Scenario: План не найден

- **WHEN** GET /plans/nonexistent/bus-risk
- **THEN** 404 с идентификатором ошибки в теле

### Requirement: Даты спринтов и прогнозные интервалы в ответе плана

`GET /plans/{plan_id}` SHALL дополнительно возвращать `sprint_dates` (sprint_no → {start, end}) и прогнозный интервал дат каждой запланированной задачи; существующие поля (decision/reason/SP/роли) не меняются — обратная совместимость.

#### Scenario: Даты в план-ответе

- **GIVEN** план со сгенерированным календарём
- **WHEN** GET /plans/{plan_id}
- **THEN** доп. поле sprint_dates есть; каждая запланированная задача дополнительно содержит date_forecast {start, end}

### Requirement: Форма факта с часами ролей

POST /plans/{plan_id}/sprints/{n}/facts SHALL принимать опциональное поле role_hours_fact (роль → часы); формат ответа прежний (new_plan_id).

#### Scenario: Факт с role_hours_fact

- **WHEN** POST .../facts с {"completed_task_ids": [...], "role_hours_fact": {"Тестировщик": 32}}
- **THEN** 200 с new_plan_id; 409 при повторе — как раньше

### Requirement: Стратегия генерации и отчёты оптимизации

API SHALL предоставлять: `POST /plans/generate` с опциональным body `{"strategy": "metrics" | "priority"}` (дефолт `priority`); `GET /plans/{plan_id}/optimization-report` — сравнение текущего плана с приоритетным эталоном (KPI №1 прогноз, KPI №2 по спринтам, число закрываемых инициатив, перенесённые задачи); `GET /plans/{plan_id}/staffing-suggestions` — рекомендации по людям (см. capability planning).

#### Scenario: Генерация метрического плана

- **WHEN** POST /plans/generate с {"strategy": "metrics"}
- **THEN** 201 + plan_id; версия плана хранит стратегию; GET /plans/{plan_id} возвращает её

#### Scenario: Отчёт оптимизации

- **WHEN** GET /plans/{id}/optimization-report для метрического плана
- **THEN** ответ содержит сравнение с priority-эталоном: KPI №1 (факт/прогноз пометки), число закрываемых инициатив, отличия состава (какие задачи вошли/вышли) — без изменения базовой метрики (знаменатель — initial-план)

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

<<<<<<< ours

### Requirement: Назначения и личный план в API

Ответ `GET /plans/{plan_id}` SHALL дополнительно включать назначения (`engineer_id`, `role`) в каждой запланированной части задачи. API SHALL предоставлять `GET /plans/{plan_id}/people/{engineer_id}` — личный план: последовательные спринты с упорядоченным списком назначений (закреплённые помечены); ручки закрепления: POST /plans/{plan_id}/tasks/{task_id}/pin `{sprint_no, engineer_id?}` и DELETE .../pin (unpin); незакреплённый порядок MAY закрепляться через pin отдельных позиций личной очереди. Несуществующие план/инженер — 404.

#### Scenario: Личный план инженера

- **GIVEN** план на демо-датасете
- **WHEN** GET /plans/{id}/people/ENG-405
- **THEN** 200: упорядоченная очередь назначений по спринтам (закреплённые отмечены); незадействованный в плане инженер — пустой список, несуществующий — 404

#### Scenario: Назначения в плане

- **WHEN** GET /plans/{id}
- **THEN** каждая запланированная часть задачи содержит инженеров по ролям; у разбитой задачи назначения указаны в каждой части

### Requirement: Советы не трогают закреплённое (cross-link 015)

Советы AI-советника MUST NOT предлагать действия, сдвигающие закреплённые задачи/позиции (см. capability planning «Закреплённые назначения (pin)»).

#### Scenario: Совет про закреплённую задачу

- **GIVEN** задача A закреплена (pin)
- **WHEN** советник сформировал советы
- **THEN** советы «перенести A» отсутствуют (могут обсуждать соседей A)

### Requirement: Job оптимизации

`POST /plans/optimize` SHALL запускать персистентный job оптимизации текущей версии плана (по образцу change 007): статусы queued → solving → ready | failed (с причиной в `error`). Успешный ready-запуск MUST создавать новую версию плана сразу и возвращать её plan_id. Повторный запуск при незавершённой оптимизации SHALL отклоняться с 409. Один job не запускается дважды.

#### Scenario: Запуск и завершение

- **GIVEN** актуальный план существует
- **WHEN** editor запускает `POST /plans/optimize` и solver завершает расчёт
- **THEN** job проходит queued → solving → ready, ответ ready содержит новый plan_id

#### Scenario: Параллельная оптимизация блокируется

- **GIVEN** job оптимизации находится в queued/solving
- **WHEN** приходит ещё один `POST /plans/optimize`
- **THEN** ответ 409 с объяснением

### Requirement: Статус и результат оптимизации

`GET /plans/optimize/{job_id}` SHALL возвращать: статус job; при неуспехе — причину (timeout, solver недоступен, валидация черновика не прошла); при успехе — plan_id новой версии, режим расчёта (solver / эвристика), optimization-report (метрики нового плана против прежнего: % квартала по инициативам, SP-гейты, PI-норма с флагами «в норме»), применённые переносы людей (кто, откуда, куда, эффект), суммарную score-разбивку целевой функции.

#### Scenario: Просмотр эффекта

- **GIVEN** оптимизация завершена успешно
- **WHEN** открывается отчёт job
- **THEN** видны метрики до/после, переносы людей с эффектом и режим (solver)

#### Scenario: Причина отказа

- **GIVEN** solver превысил лимит времени
- **WHEN** опрашивается job
- **THEN** статус failed, причина «превышен лимит времени», версии плана не создано

### Requirement: Права и коды ошибок

Права SHALL как у планирования в целом: reader — GET статуса/отчёта (без запуска), editor — запуск оптимизации, admin — запуск и переносы людей. Перенос людей, требующий прав admin, при отсутствии роли MUST отклоняться с 403 и указанием отсутствующего права. Повторный факт/оптимизация над уже заменённой версией → 409; невалидный черновик → 422; несуществующий job → 404; job чужого workspace → 404 (по образцу 008/009).

#### Scenario: Reader не запускает

- **GIVEN** пользователь с ролью reader
- **WHEN** он вызывает `POST /plans/optimize`
- **THEN** ответ 403 с указанием права

#### Scenario: Workspace-изоляция

- **GIVEN** job создан в другом workspace
- **WHEN** запрашивается его статус
- **THEN** ответ 404
