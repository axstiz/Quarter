# Tasks: 025-fix-double-confirm (bugfix)

## 1. Идемпотентный импорт в stage_import

- [x] 1.1 `team_history`: мерж по (workspace, team, snapshot_date) — imported обновляется, manual пропускается, дублей нет. Проверка: unit — повторный stage_import не увеличивает строки истории
- [x] 1.2 `role_requirements`: батч-дедуп по (task_id, role) внутри импорта + мерж против БД (imported → обновление часов, manual → пропуск). Проверка: unit — часы ролей после двух прогонов совпадают с одинарными
- [x] 1.3 guards повторного confirm не тронуты (409). Проверка: существующие тесты jobs зелёные

## 2. Тесты и регресс

- [x] 2.1 API/сервис-тест: два stage_import подряд одного job → counts совпадают, в БД ровно по одной строке (task, role) и (team, snapshot). Проверка: тест зелёный
- [x] 2.2 Прогон `uv run pytest tests/ -q` — 94 passed (вкл. идемпотентность); фронт-README №4 снято, README бэка — «повторный импорт идемпотентен». Проверка: всё зелёное
