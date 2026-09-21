## Context

См. proposal.md — Why. Текущее состояние: `tasks.task_id` и `teams.team_id` — глобальные PK; `RoleRequirementORM.task_id` — одноколоночный FK на `tasks.task_id`; upsert'ы импорта (`src/db/staging.py`) ищут записи без workspace-фильтра, причём `team_history` и `role_requirements` не ищут вовсе — всегда INSERT (дубликаты при повторном импорте уже сегодня). Alembic в проекте нет — схема создаётся `create_all`, тесты поднимают чистую БД. Чтения (`load_world`, роуты, ручной CRUD в `src/api/crud.py`) уже фильтруют по `workspace_id` — проблема только в идентичности и upsert-путях записи. `src/db/importer.py` (демо-импорт) уже workspace-scoped.

## Goals / Non-Goals

**Goals:**
- Один и тот же датасет независимо живёт в нескольких workspace: импорт в B не трогает A.
- Повторный импорт в тот же workspace — merge по `(workspace_id, бизнес-id)`, как прежде в рамках default.
- Минимальный дифф: без смены API-контрактов и публичных идентификаторов.

**Non-Goals:**
- Отдельная БД на компанию (уже вне рамок спеки workspace).
- Миграция данных существующих БД (alembic нет; демо-данные пересоздаются импортом).
- Переименование/смена бизнес-id (`task_id` остаётся тем, что видит UI/API).

## Decisions

1. **Составной PK `(workspace_id, task_id)` на `tasks`, `(workspace_id, team_id)` на `teams`.**
   Альтернатива — суррогатный uuid-PK + `UniqueConstraint(workspace_id, task_id)`: отвергнута, т.к. потребовала бы переключения всех ссылок (`plan_items.task_id`, JSON `assignments`, `sprint_facts.completed_task_ids`, API-payloads) на uuid — инвазивно и бесполезно: эти ссылки и так достижимы только через workspace-scoped план. `teams` чиним заодно: импорт их не пишет, но ручное создание команды с тем же `team_id` во втором workspace сегодня упадёт по глобальному PK (CRUD уже scoped — `crud.py`).
2. **FK `task_role_requirements` → составной, старый удалить.** Сейчас колонка `task_id` несёт `ForeignKey("tasks.task_id")` — после перевода `tasks` на составной PK она перестаёт быть уникальной и `create_all` упадёт. Поэтому явно: убрать одноколоночный `ForeignKey` и добавить `ForeignKeyConstraint(["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.task_id"], ondelete="CASCADE")`. CASCADE осознан: ручное удаление задачи (`crud.py`) не чистит зависимые role_requirements, и enforced FK иначе даст 500. `task_role_hours.task_id` FK не имеет — оставляем без FK (см. риски про орфанов).
3. **Все upsert/insert-пути импорта работают по паре `(workspace_id, бизнес-id)`**: `_upsert_task` (`staging.py:53`), upsert зависимостей (`staging.py:144`), инженеров (`staging.py:114`) — добавить workspace-фильтр; для `role_requirements` и `team_history` (`staging.py:165, 182-199`) ввести dedupe-upsert (сейчас голый INSERT — дубликаты даже при повторном импорте в тот же workspace). Перед правкой прогрепать все `select(...ORM).where(... бизнес-id ...)` без workspace-фильтра. `src/db/importer.py` (демо-импорт, `reset_dataset_tables`/`import_dataset`) уже scoped по workspace — после смены PK правок не потребует, проверить тестами.
4. **Миграция — пересоздание**: `docker compose down -v && up` + импорт демо-датасета; зафиксировать в README. Существующие данные не мигрируем (демо-проект, dataset воспроизводим из xlsx).

## Risks / Trade-offs

- **BREAKING схема**: старые volume несовместимы — смягчается документированной процедурой пересоздания.
- Скрытые обращения к `tasks`/`teams` без workspace-фильтра вне staging могут вскрыться в рантайме — покрывается регрессом всего набора тестов + сценарием «два workspace, один датасет».
- Составной PK усложняет будущие FK на tasks — принимаем как осознанную платформенную норму.
- После составного PK `(workspace_id, task_id)` исчезает индекс по голому `task_id`: lookup'ы по паре покрыты PK, голых lookup'ов по дизайну не остаётся.
- `task_role_hours.task_id` остаётся без FK: при удалении задачи её строки в `task_role_hours` станут орфанами в пределах workspace — принимаем (справочная производная таблица датасета, переимпорт перезаписывает).
