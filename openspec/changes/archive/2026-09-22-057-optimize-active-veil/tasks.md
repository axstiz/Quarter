# Tasks: 057-optimize-active-veil
- [x] 1.1 GET /plans/optimize/active (queued/solving job workspace или null; порядок роутов — до {job_id}). Проверка: test_optimize_active_endpoint
- [x] 1.2 useActiveOptimizeJob: опрос 2с/4с, инвалидация кэша планов при завершении. Проверка: build
- [x] 1.3 PlanPage: вуаль/статус по активному job независимо от навигации; кнопка disabled пока solver занят. Проверка: build + lint
- [x] 1.4 pytest полный (149 passed) + QA live (active отдаёт job во время solve, null после)
- [x] 1.5 openspec validate + коммит + архивация + push
