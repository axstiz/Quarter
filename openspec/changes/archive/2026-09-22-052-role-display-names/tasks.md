# Tasks: 052-role-display-names
- [x] 1.1 allocate_engineers: role assignments из orig_roles (display). Проверка: test_assignment_role_uses_display_name
- [x] 1.2 Импортёр: _role_key + маппинг колонок xlsx → display-имена требований. Проверка: test_imported_role_hours_actual_display_names
- [x] 1.3 Обновлён test_references_and_hours (display-имена — новое поведение); pytest полный (142 passed)
- [x] 1.4 QA live: переимпорт — task_role_hours display; optimize — assignments display. Проверка: live
- [x] 1.5 openspec validate + коммит + архивация + push
