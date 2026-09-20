# Update capability: api

## MODIFIED Requirements

### Requirement: Ручки онбординга

API SHALL предоставлять: POST /data/upload (загрузка файла → job), GET /data/jobs/{job_id} (статус/вопросы/превью), POST /data/jobs/{job_id}/answers, POST /data/jobs/{job_id}/confirm, POST /ai/normalize/{job_id}, и CRUD по сущностям: /teams, /engineers, /tasks, /dependencies (POST/PUT/DELETE) с опциональными полями.

#### Scenario: CRUD человека

- **WHEN** POST /engineers с минимальным телом (id, team, роль)
- **THEN** 201, source=manual

#### Scenario: Прогресс job

- **WHEN** GET /data/jobs/{job_id} во время LLM-фазы
- **THEN** status: mapping|questions|ready|confirmed|failed
