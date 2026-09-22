# Tasks: fix-import-preserves-plans

- [x] 1.1 `reset_dataset_tables`: удалять только tasks, task_role_requirements, task_dependencies, engineers_profiles, team_history
- [x] 1.2 Тест: generate план → повторный POST /data/import → план и его items остались (плюс: тест-фикстуры переведены на per-test tmp-DB через setattr settings — изоляция, раньше маскировалась destructive reset'ом)
- [x] 1.3 openspec validate (17/17); pytest (36 passed)
