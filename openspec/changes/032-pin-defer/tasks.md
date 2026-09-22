# Tasks: 032-pin-defer

- [x] 1.1 POST /pin без generate_plan/новой версии: обнов Bot pinned-метаданных item'а (или deferred-запись postponed для задач вне плана), лёгкие валидации (спринт bounds, факт-спринт, 409 зависимость). Проверка: unit — pin не создаёт child-версию
- [x] 1.2 DELETE /pin без пересборки (сброс pinned_*). Проверка: unit
- [x] 1.3 `_recompute_plan_version` собирает пины текущей версии (не-Done) → generate_plan(..., pins=...), факт-роут тоже. Проверка: unit — pin → recompute: задача в целевом спринте
- [x] 1.4 Тест test_pin_defers_rebuild_and_recompute_applies; полный pytest 122 зелёные
- [x] 2.1 Фронт: тост «закреплена … (ожидает пересчёт)», метка чипа, баннер «неприменённые закрепления N — после "Пересчёта"» с кнопкой пересчёта. Проверка: npm run build
- [x] 2.2 Живой E2E: drag → без сдвига соседей, «Пересчёт» применяет
- [x] 3.1 openspec validate --all зелёные
