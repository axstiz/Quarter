# Tasks: fix-crud-teams-dependencies

- [x] 1.1 PUT /teams/{team_id} ({name}) — переименование, правка → source=manual
- [x] 1.2 PUT /dependencies?blocking_task_id=&blocked_task_id= ({dependency_type}) → 200/manual; 404 без пары
- [x] 1.3 DELETE /dependencies?blocking_task_id=&blocked_task_id= → 200; 404 без пары
- [x] 1.4 Перенесено: правка имени сценария «48→45» — отдельным spec-only change (MODIFIED-дельта требует прежнего имени сценария)
- [x] 1.5 Тесты: переименование команды; смена типа/удаление зависимости по паре; 404
- [x] 1.6 openspec validate (19/19); pytest (38 passed); openapi.json перегенерирован
