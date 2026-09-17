# Update capability: architecture

## MODIFIED Requirements

### Requirement: Импорт данных

Бэкенд SHALL импортировать dataset/*.csv в БД через db/importer.py; source of truth остаётся xlsx (capability data). Повторный импорт (reset_dataset_tables) очищает ТОЛЬКО импортные таблицы датасета (tasks, task_role_requirements, task_dependencies, engineers_profiles, team_history); таблицы планов (plans, plan_items, sprint_facts) НЕ затрагиваются.

#### Scenario: Повторный импорт

- **WHEN** POST /api/v1/data/import повторно после правки xlsx
- **THEN** данные датасета обновлены; созданные ранее планы и факты спринтов сохранены
