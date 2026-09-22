# Tasks: 047-facts-chain-and-done-in-optimize
- [x] 1.1 _plan_chain_ids + chain-aware запросы фактов (load_facts 409-check, _recompute_plan_version, warnings, diff, metrics, optimization-report, advice); facts_list унифицирован с helper'ом. Проверка: pytest
- [x] 1.2 apply_draft: копирование done_actual-задач исходной версии в оптимизированную. Проверка: pytest
- [x] 1.3 Тесты: metrics дочерней версии видит факт; facts по цепочке; дубль факта на дочерней → 409; оптимизация сохраняет done_actual. Проверка: pytest (134 passed)
- [x] 1.4 QA live: факт спринта 1 → metrics дочерней (45.6%, не forecast), дубль 409, optimize (job ready) → done_actual на месте, metrics оптимизированной версии видит факт. Проверка: live
- [x] 1.5 openspec validate + коммит + архивация + push
