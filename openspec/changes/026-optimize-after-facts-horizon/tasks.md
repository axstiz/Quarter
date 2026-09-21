# Tasks: 026-optimize-after-facts-horizon

## 1. Снапшот с контекстом

- [x] 1.1 `optimizer_client.build_snapshot(..., done_ids: frozenset[str] = frozenset(), first_free_sprint: int = 1)`: фильтр задач `status == "Done" or task_id in done_ids`; `"sprints": list(range(first_free_sprint, SPRINTS_PER_QUARTER + 1))`. Проверка: unit-тест снапшота — done-задача отсутствует, `sprints == [2..6]` при `first_free_sprint=2`
- [x] 1.2 Вызовы `build_snapshot` без аргументов (если есть вне run_optimization) — без изменений поведения. Проверка: `uv run pytest tests/test_optimizer_sidecar.py -q` (марка solver) не сломалась
- [x] 1.3 Pre-split частей ограничивается SP-ёмкостью команды: `k = max(⌈часы÷80⌉, ⌈SP÷ёмкость_команды⌉)` (ёмкость из team_history; без истории — только часовой лимит) — часть задачи с SP больше ёмкости (InProgress 7.66 при ёмкости 7.6) не остаётся атомарной, solver получает размещаемые части. Проверка: unit-тест — задача SP 10 при ёмкости 8 → 2 части; живой сценарий optimize после факта — ready, не 422

## 2. Контекст в run_optimization и эвристике

- [x] 2.1 `run_optimization`: загрузить source через `load_plan_orm`; `first_free = (source.recomputed_after_sprint or 0) + 1`; `done_ids` = `completed_task_ids` всех `SprintFactORM` workspace ∪ `{t.task_id for t in tasks_map.values() if t.status == "Done"}`; передать в `build_snapshot` и `_heuristic_draft`. Проверка: `uv run pytest tests/test_optimize_jobs.py -q`
- [x] 2.2 `_heuristic_draft(..., done_ids, first_free_sprint)`: фильтр словаря задач, `generate_plan(..., first_free_sprint=first_free_sprint)`. Проверка: unit-тест эвристики — выполненная задача не в items

## 3. Тесты инвариантов (test_optimize_jobs.py)

- [x] 3.1 Solver-режим: факт спринта 1 (`completed_task_ids` из planned) → recompute → `POST /plans/optimize` → новая версия: выполненные задачи не planned (нет в items), нет items с `sprint_no <= 1`
- [x] 3.2 Heuristic-режим (solver недоступен): тот же сценарий — те же инварианты

## 4. Проверки

- [x] 4.1 `openspec validate --all` — без ошибок
- [x] 4.2 `uv run pytest tests/ -q` — все зелёные (102 + новые)
- [x] 4.3 Живая связка: import → generate → факт спринта 1 → recompute → «Оптимизировать» → отчёт без прошедших спринтов и без выполненных задач
- [x] 1.4 Java-констрейнты `teamSpCapacity`/`roleHoursCapacity` — сравнение в сотых (×100) вместо десятых: solver видит те же нарушения, что и бэковская валидация (стопка 5.33+1.33+1.0 = 7.66 при ёмкости 7.6 ранее «влезала» в десятых → 422 на бэке). Проверка: пересборка optimizer-образа, живой optimize после факта — ready; sidecar-детерминизм не сломан
