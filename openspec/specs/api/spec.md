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

API SHALL предоставлять: POST /data/upload (загрузка файла → job), GET /data/jobs/{job_id} (статус/вопросы/превью), POST /data/jobs/{job_id}/answers, POST /data/jobs/{job_id}/confirm, POST /ai/normalize, и CRUD по сущностям: /teams, /engineers, /tasks, /dependencies (POST/PUT/DELETE) с опциональными полями.

#### Scenario: CRUD человека

- **WHEN** POST /engineers с минимальным телом (id, team, роль)
- **THEN** 201, source=manual

#### Scenario: Прогресс job

- **WHEN** GET /data/jobs/{job_id} во время LLM-фазы
- **THEN** status: mapping|questions|ready|confirmed|failed

# Update capability: architecture

### Requirement: AI-слой

AI-пайплайны SHALL жить в src/ai (LangGraph-графы, клиент провайдера, JSON-схемы); вызовы LLM always через pydantic-валидацию; клиент GigaChat конфигурируется env-ом, отсутствие ключа ≤ пласт деградации (шаблонные маппинги).

#### Scenario: Новая AI-фича

- **WHEN** добавляется AI-советник (change 003+)
- **THEN** он реализуется новым графом в src/ai/pipelines с общей обёрткой провайдера

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
