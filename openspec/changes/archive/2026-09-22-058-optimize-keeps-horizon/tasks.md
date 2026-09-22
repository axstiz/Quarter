# Tasks: 058-optimize-keeps-horizon
- [x] 1.1 apply_draft: наследование recomputed_after_sprint от исходной версии. Проверка: test_optimize_after_fact_keeps_horizon
- [x] 1.2 run_optimization: first_free = max(поле версии, последний факт) + 1. Проверка: тот же тест
- [x] 1.3 pytest полный (150 passed) + QA live (opt1 after=1; opt2 без спринта 1, after=1)
- [x] 1.4 openspec validate + коммит + архивация + push
