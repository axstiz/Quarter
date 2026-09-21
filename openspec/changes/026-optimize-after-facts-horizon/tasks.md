# Tasks: 026-optimize-after-facts-horizon

## 1. Снапшот с контекстом

- [ ] 1.1 `optimizer_client.build_snapshot(..., done_ids: frozenset[str] = frozenset(), first_free_sprint: int = 1)`: фильтр задач `status == "Done" or task_id in done_ids`; `"sprints": list(range(first_free_sprint, SPRINTS_PER_QUARTER + 1))`. Проверка: unit-тест снапшота — done-задача отсутствует, `sprints == [2..6]` при `first_free_sprint=2`
- [ ] 1.2 Вызовы `build_snapshot` без аргументов (если есть вне run_optimization) — без изменений поведения. Проверка: `uv run pytest tests/test_optimizer_sidecar.py -q` (марка solver) не сломалась

## 2. Контекст в run_optimization и эвристике

- [ ] 2.1 `run_optimization`: загрузить source через `load_plan_orm`; `first_free = (source.recomputed_after_sprint or 0) + 1`; `done_ids` = `completed_task_ids` всех `SprintFactORM` workspace ∪ `{t.task_id for t in tasks_map.values() if t.status == "Done"}`; передать в `build_snapshot` и `_heuristic_draft`. Проверка: `uv run pytest tests/test_optimize_jobs.py -q`
- [ ] 2.2 `_heuristic_draft(..., done_ids, first_free_sprint)`: фильтр словаря задач, `generate_plan(..., first_free_sprint=first_free_sprint)`. Проверка: unit-тест эвристики — выполненная задача не в items

## 3. Тесты инвариантов (test_optimize_jobs.py)

- [ ] 3.1 Solver-режим: факт спринта 1 (`completed_task_ids` из planned) → recompute → `POST /plans/optimize` → новая версия: выполненные задачи не planned (нет в items), нет items с `sprint_no <= 1`
- [ ] 3.2 Heuristic-режим (solver недоступен): тот же сценарий — те же инварианты

## 4. Проверки

- [ ] 4.1 `openspec validate --all` — без ошибок
- [ ] 4.2 `uv run pytest tests/ -q` — все зелёные (102 + новые)
- [ ] 4.3 Живая связка: import → generate → факт спринта 1 → recompute → «Оптимизировать» → отчёт без прошедших спринтов и без выполненных задач
