# Tasks: 005-auth (реализация — будущий бэкендер)

Все задачи `- [ ]`: change spec-only, реализация отдельным change по этим пунктам.

## 1. Модель

- [x] 1.1 Таблица users (id, email, password_hash; роли — по workspace-ам, см. workspace/change 009)
- [x] 1.2 Зависимость user_id в изменяющих таблицах (plans.created_by, sprint_facts.author_id; plan_items.reason — авторство в тексте отмен)

## 2. Ручки

- [x] 2.1 POST /auth/register, POST /auth/login, POST /auth/demo-login, GET /auth/me
- [x] 2.2 Зависимость-проверка сессии в Depends для всех /api/v1 (кроме healthz), 401/403
- [x] 2.3 Разграничение прав по ролям (reader — только чтение, editor — правки, admin — всё)

## 3. Конкурентность и авторство

- [x] 3.1 Снапшот-цепочка сохраняется: правки разных пользователей создают версии, никакого last-write-wins-merge
- [x] 3.2 Авторство в reasons правок (отмена/факт/пересчёт, plans.created_by; приоритет — source=manual в TaskORM)

## 4. Инфраструктура

- [x] 4.1 CORS_ORIGINS: дефолт конкретный (не *), allow_credentials=True
- [x] 4.2 docker-compose: без новых сервисов (auth — часть монолита); пароли — bcrypt/argon2

## 5. Тесты и проверки

- [x] 5.1 Фикстура аутентификации в tests/ (все e2e-тесты переезжают на сессию)
- [x] 5.2 Тесты ролей (reader 403, без сессии 401, демо-вход)
