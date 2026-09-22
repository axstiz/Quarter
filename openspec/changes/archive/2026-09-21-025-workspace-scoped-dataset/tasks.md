## 1. Тесты на изоляцию (TDD: сначала red)

- [x] 1.1 Тест: один и тот же датасет импортируется (upload → confirm) в два workspace — задачи/команды/зависимости/роль-требования создаются в обоих, записи первого не меняются (снять counts/хэши до и после). Красный на текущей схеме.
- [x] 1.2 Тест: повторный импорт в тот же workspace — merge без дубликатов всех сущностей (задачи, инженеры, зависимости, role_requirements, team_history: counts не растут), manual-записи сохраняются. Красный: role_requirements/team_history дублируются уже сегодня.
- [x] 1.3 Тест: `POST /plans/generate` во втором workspace после импорта — 201, план построен из его данных (регресс на «нет данных в базе»).
- [x] 1.4 Тест: полный сброс (`/data/import`) в одном workspace не трогает задачи и планы другого.

## 2. Схема (green для раздела 1)

- [x] 2.1 `TaskORM`: PK → `(workspace_id, task_id)`; `TeamORM`: PK → `(workspace_id, team_id)` — в `src/db/models.py`.
- [x] 2.2 `RoleRequirementORM`: **удалить** одноколоночный `ForeignKey("tasks.task_id")`, добавить `ForeignKeyConstraint(["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.task_id"], ondelete="CASCADE")`.
- [x] 2.3 Прогрепать чтения `TaskORM`/`TeamORM`/`DependencyORM` вне staging (routes, `crud.py`, сервисы) на отсутствие lookup без workspace-фильтра; найденное — поправить.

## 3. Импорт (upsert по паре workspace+biz-id)

- [x] 3.1 `src/db/staging.py`: workspace-фильтр в lookup задач (`:53`), зависимостей (`:144`), инженеров (`:114`); dedupe-upsert для `role_requirements` и `team_history` (раньше голый INSERT); auto-Done для задач-сирот + пропуск role_reqs на неизвестные task_id (design, решение 5).
- [x] 3.2 Проверить `src/db/importer.py` (`reset_dataset_tables`/`import_dataset`): уже workspace-scoped, правок не требуется — подтвердить тестами раздела 1.
- [x] 3.3 Зелёные тесты раздела 1.

## 4. Регресс и документация

- [x] 4.1 Полный прогон `uv run pytest tests/ -q` (весь набор, включая solver-маркер с compose); `openspec validate --all`.
- [x] 4.2 Перегенерация dataset без diff'а (`uv run scripts/split_dataset.py`).
- [x] 4.3 README: процедура пересоздания БД (`down -v` + импорт) помечена как обязательная после этого change.
- [x] 4.4 Демо-проверка вживую: новый workspace → импорт xlsx → построить план → 201 (сценарий из бага).
