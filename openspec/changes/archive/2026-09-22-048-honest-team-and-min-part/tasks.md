# Tasks: 048-honest-team-and-min-part
- [x] 1.1 Диагностика live: спринт 1 = 0 после факта — норма; перегрузы SP — артефакт team_id владельца в API (по БД перегрузов нет); осколки 0.2–0.9 ч — пропорциональное деление ролей в _split_parts (18 шт). Проверка: live generate/optimize/факт
- [x] 1.2 _split_parts: MIN_ROLE_PART_HOURS=2 — мелкие роли целиком в последнюю часть. Проверка: unit-тесты
- [x] 1.3 PlanItem.team_id + _plan_from_orm + get_plan: team_id исполнителя, owner_team_id владельца. Проверка: API-тест (solver отдал часть T-1 в Team-B)
- [x] 1.4 pytest полный (137 passed)
- [x] 1.5 QA live: осколки 18→8 (остаток — лимиты специалистов), SP по исполнителям без перегрузов. Проверка: live
- [x] 1.6 openspec validate + коммит + архивация + push
