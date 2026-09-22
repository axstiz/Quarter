# Tasks: 056-dependency-safe-moves
- [x] 1.1 repair_dependencies после allocate_engineers + синхронизация assignments[].sprint_no при сдвиге. Проверка: test_allocate_shift_then_repairs_dependencies
- [x] 1.2 Нарушения черновика (пред/пост-валидация) → деградация в эвристику с degradation_reason, не 422. Проверка: test_optimize_invalid_draft_degrades_to_heuristic
- [x] 1.3 pin_task: зависимости по фактическим позициям плана (блокер < цели < зависимая), 409 с причиной. Проверка: pytest + live
- [x] 1.4 RolesView: depBounds (min/max спринт по зависимостям), жёсткий запрет drag, причина в invalidReason. Проверка: build + lint
- [x] 1.5 pytest полный (148 passed) + QA live (pin 409; optimize ready solver)
- [x] 1.6 openspec validate + коммит + архивация + push
