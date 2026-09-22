# Tasks: 008-workspaces (реализация — бэкендер, после auth)

Все задачи `- [ ]`: change spec-only, реализация отдельным change по этим пунктам.

## 1. Модель

- [x] 1.1 Таблица workspaces (id, name, created_by, created_at); workspace_id во ALL сущностных таблицах (tasks, role_requirements, dependencies, engineers, team_history, plans, plan_items, sprint_facts, upload_jobs)
- [x] 1.2 Таблица membership (user_id, workspace_id, role admin/editor/reader) — роли по workspace (см. capability auth)
- [x] 1.3 Миграция: существующие записи → default workspace

## 2. Контекст

- [x] 2.1 Зависимость workspace-контекста (Depends): заголовок/путь — решает реализация; без контекста → default workspace
- [x] 2.2 Фильтрация load_world и всех запросов services по текущему workspace
- [x] 2.3 reset_dataset_tables / import_dataset → по-workscope (не трогают соседей)

## 3. Ручки

- [x] 3.1 GET /workspaces (свои), POST /workspaces (создатель — владелец), PUT /workspaces/{id} (admin), DELETE (admin, с подтверждением)
- [x] 3.2 Участники/роли workspace: приглашение, изменение роли, удаление участника (admin) — стыкуется с auth
- [x] 3.3 403/404 для не-участников workspace

## 4. Тесты и проверки

- [x] 4.1 Изоляция: задачи/планы/метрики A не видны из B; импорт A не задевает B
- [x] 4.2 Совместимость: все существующие e2e-тесты без workspace-контекста работают (default)
- [x] 4.3 Демо-датасет: импорт создаёт/наполняет default workspace
