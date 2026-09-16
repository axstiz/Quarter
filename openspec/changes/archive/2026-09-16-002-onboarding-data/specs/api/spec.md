# Update capability: api

## ADDED Requirements

### Requirement: Ручки онбординга

API SHALL предоставлять: POST /data/upload (загрузка файла → job), GET /data/jobs/{job_id} (статус/вопросы/превью), POST /data/jobs/{job_id}/answers, POST /data/jobs/{job_id}/confirm, POST /ai/normalize, и CRUD по сущностям: /teams, /engineers, /tasks, /dependencies (POST/PUT/DELETE) с опциональными полями.

#### Scenario: CRUD человека

- **WHEN** POST /engineers с минимальным телом (id, team, роль)
- **THEN** 201, source=manual

#### Scenario: Прогресс job

- **WHEN** GET /data/jobs/{job_id} во время LLM-фазы
- **THEN** status: mapping|questions|ready|confirmed|failed

# Update capability: architecture

## ADDED Requirements

### Requirement: AI-слой

AI-пайплайны SHALL жить в src/ai (LangGraph-графы, клиент провайдера, JSON-схемы); вызовы LLM always через pydantic-валидацию; клиент GigaChat конфигурируется env-ом, отсутствие ключа ≤ пласт деградации (шаблонные маппинги).

#### Scenario: Новая AI-фича

- **WHEN** добавляется AI-советник (change 003+)
- **THEN** он реализуется новым графом в src/ai/pipelines с общей обёрткой провайдера
