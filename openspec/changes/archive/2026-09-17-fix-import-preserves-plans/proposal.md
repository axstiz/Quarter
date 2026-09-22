# Change: fix-import-preserves-plans

## Why

Спека architecture требует: «Повторный импорт: датасет загружается заново, накопленные планы не затрагиваются». Но `reset_dataset_tables` (src/db/importer.py:60) удаляет ВСЕ таблицы, включая `plans`, `plan_items`, `sprint_facts` — повторный import уничтожает планы и факты. Это реальный баг демо-сценария («повторный импорт после правки xlsx»).

## What changes

1. `reset_dataset_tables` удаляет только импортные таблицы датасета (tasks, task_role_requirements, task_dependencies, engineers_profiles, team_history) — таблицы планов (`PlanORM`, `PlanItemORM`, `SprintFactORM`) не трогаются.
2. Уточнение в спеке architecture: перечислены затрагиваемые таблицы.
3. Тест: повторный импорт сохраняет созданный ранее план.

## Non-goals

- Reset справочников `reference_values`/`task_role_hours` — инфраструктура появится с реализацией change 011; уточнение спеки — в дельте 011.
- merge-семантика по записям (source=manual сохраняются) — отдельные требования data capability, не этот фикс.

## Risks

- Некоторый риск «осиротевших» фактов при импорте нового состава задач — приемлем: планы хранят task_id как текст; план пересчитывается от актуального БД при generate/recompute.
