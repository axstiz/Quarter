# Tasks: 011-references-and-hours (реализация — будущий бэкендер)

Все задачи `- [ ]`: change spec-only, реализация отдельным change по этим пунктам. Реализация рекомендуется в одном проходе с фикс-reset-import (fix/import-preserves-plans) — общая зона importer/reset.

## 1. Импорт

- [ ] 1.1 Таблица reference_values (id, category, value, source) + import в importer.py (counts["reference_values"]=19)
- [ ] 1.2 Таблица task_role_hours (task_id, role, hours) + import (6 задач)
- [ ] 1.3 reset_dataset_tables: справочники и фактические часы очищаются с импорта (координация с фикс-reset-change)

## 2. Витрина

- [ ] 2.1 GET /tasks/{task_id}: поле role_hours_actual (когда данные есть)
- [ ] 2.2 Отсутствие фактических разбивок у 39 задач — пусто/без поля, без ошибки

## 3. Причины расхождений

- [ ] 3.1 Сопоставление типов предупреждений/расхождений → категории справочника при формировании reason
- [ ] 3.2 Пояснение в ответах warnings/diff видит пользователь: понятная формулировка причины

## 4. Тесты и проверки

- [ ] 4.1 Тесты импорта (counts, idempotent, byte-identical dataset не тронут)
- [ ] 4.2 Тест карточки задачи с/без фактических часов
- [ ] 4.3 README: допущение «task_role_hours — витринно, не в расчётах» в разделе допущений
