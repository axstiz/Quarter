# Proposal: 052-role-display-names

## Why

Имена ролей протекали в UI в машинном виде:
1. `task_role_hours` (фактические часы) — импортёр писал имена колонок xlsx как есть («разработчик_java», «тестировщик_автотестирование»), тогда как секция требований даёт display-имена («Разработчик Java»).
2. Assignments оптимизированного плана — `allocate_engineers` брал отображаемое имя роли из нормализованных ключей части solver («тестировщик(автотестирование)»), хотя рядом уже был `orig_roles` с display-именами всех ролей.

## What Changes

- Импортёр: маппинг машинных колонок секции часов → display-имена из требований по каноническому ключу (без пробелов/подчёркиваний/скобок/регистра)
- `allocate_engineers`: role в assignments — `orig_roles` (display-имена из задач/инженеров), per-item `orig_names` удалён
- QA live: task_role_hours и assignments оптимизации — только display-имена; существующие БД чинятся повторным `POST /data/import`

## Capabilities

### Modified Capabilities

- `data` — display-имена ролей при импорте фактических часов и в назначениях оптимизации.

## Impact
`src/db/importer.py`, `src/services/optimize_plan.py`, тесты (`test_role_display_052.py`, `test_solver_allocation.py`, обновлён `test_references_and_hours.py`).
