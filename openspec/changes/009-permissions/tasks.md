# Tasks: 009-permissions (реализация — после auth + workspaces)

Все задачи `- [ ]`: change spec-only, реализация отдельным change по этим пунктам.

## 1. Модель

- [x] 1.1 Таблица membership (из 008) используется как источник ролей по workspace-ам
- [x] 1.2 Переопределения матрицы: таблица role-override (workspace_id, role, permission, enabled) и/или user-override (workspace_id, user_id, permission)
- [x] 1.3 Audit-журнал прав (кто/кого/что и когда выдал-снял)

## 2. Движок проверки

- [x] 2.1 Зависимость require_permission("...") для изменяющих ручек (вместе с сессией из auth)
- [x] 2.2 Реестр прав (константы): import_data, crud_tasks, crud_engineers, edit_priority, cancel_request, confirm_cancel, sprint_facts, recompute, plans_generate, workspace_admin, members_admin
- [x] 2.3 Ручки управления правами (admin): GET матрицы, PATCH роли участника, PATCH права роли, журнал

## 3. Матрица по умолчанию

- [x] 3.1 Seed: admin — всё; editor — импорт/CRUD/приоритеты/отмена/факты/пересчёт; reader — только GET
- [x] 3.2 Admin-права неотчуждаемы (нельзя снять с владельца/передать нерегламентировано)

## 4. Тесты и проверки

- [x] 4.1 Reader 403 на изменяющих ручках, editor без отключённого права 403, admin — всё
- [x] 4.2 Изоляция по workspace (роль A не действует в B)
- [x] 4.3 Журнал: выдача/смена прав видны с автором
