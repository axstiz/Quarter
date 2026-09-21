# Tasks: 024-admin-single-user

Упрощение входа и UI до одного пользователя-админа. Бэк и моки backend-ручек ролей/участников не меняются.

## 1. Вход

- [x] 1.1 LoginPage: единственная кнопка «Войти как администратор» (`demoLogin('admin')`); список демо-ролей и форма email/пароля убраны. Проверка: `npm run build`, вход ведёт на `/workspaces`
- [x] 1.2 auth.ts: mock-ветка demoLogin остаётся (роль admin); `getRole()`/`canEdit()` не тронуты — UI-гейтинги выполняются у admin. Проверка: сборка зелёная, правки доступны

## 2. Снятие admin-экранов

- [x] 2.1 Маршруты `/workspace/people` и `/permissions` удалены (router.tsx), файлы `PeoplePage.tsx`, `PermissionsPage.tsx` удалены; `ADMIN_NAV` и бейдж «роль: …» убраны из Layout. Проверка: `npm run build && npm run lint` зелёные; прямые URL отдают редирект на онбординг (`*` → `/workspaces`)
- [x] 2.2 Хвосты почищены: queries (useRemoveMember/usePermissionsMatrix/useAuditLog/useUpdateRolePermission) и endpoints (listMembers/addMember/removeMember/getPermissionsMatrix/updateRolePermission/getAuditLog) удалены; мок-хендлеры 008/009 и бэк-ручки сохранены (пригодятся 023/invite). Проверка: `node --test tests/*.test.mjs` — 18/18
- [x] 2.3 WorkspaceSelectPage: бейджи ролей и reader-примечание убраны; создание workspace без ролевого гейтинга; WorkspaceSwitcher без ролевой логики. Проверка: онбординг-сценарий в мок-режиме (селектор, активный помечен, создание → чистый лист)

## 3. Документация и регресс

- [x] 3.1 README (корневой + frontend/README): демо-вход одной кнопкой admin; экраны участников/прав не в UI (бэк-ручки сохранены для 023); строки `/workspace/people` и `/permissions` из таблицы экранов убраны. Проверка: тексты соответствуют UI
- [x] 3.2 Статические тесты фронта обновлены под 024 (нет PeoplePage/PermissionsPage/ADMIN_NAV, одна кнопка входа, нет members/permissions в endpoints). Проверка: 18/18 зелёные
- [x] 3.3 Прогон: `npm run build` + `npm run lint` зелёные; бэк не тронут. Проверка: коммит `feat(ui): …`
