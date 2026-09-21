# Change: 025-fix-double-confirm (bugfix, skip_specs)

## Why

Задокументированный баг (README бэка и фронта, №4 расхождений мока): повторный confirm job'а поверх уже загруженных данных / второй импорт того же датасета **дублирует** `task_role_requirements` (часы ролей удваиваются — планирование разъезжается) и `team_history` (velocity усредняется неверно). Причина: `_upsert_task`/engineers/dependencies в `stage_import` мержатся по ключам, а `team_history` и `role_requirements` вставляются безусловно. Спека data (сквозное требование «Последующие импорты dataset SHALL не перезатирать manual; обновляются только записи из импорта») уже требует идемпотентности — код ей не соответствует. Это багфикс к существующей спеке: дельты в specs не нужны (skip_specs).

## What Changes

1. `src/db/staging.py::stage_import`:
   - `team_history` мержится по ключу (workspace, team, snapshot_date): imported → обновляются часы; manual → не трогаем; иначе вставка.
   - `role_requirements` дедуплицируются батчево по (task_id, role) внутри импорта и мержатся против БД по (workspace, task_id, role): imported → обновляются часы; manual → не трогаем; иначе вставка.
2. Защита повторного confirm того же job'а уже есть (409 «job не готов»), не меняется.
3. Фронт-README: снять предупреждение «импортируйте один раз» (расхождение №4 закрывается).

## Non-goals

- Изменение контракта API (counts остаются той же формы).
- Моки: ведут себя по спеке и так — правок не требует.
