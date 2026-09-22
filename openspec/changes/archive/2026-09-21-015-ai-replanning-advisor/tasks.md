# Tasks: 015-ai-replanning-advisor

Все задачи `- [ ]`: change spec-only, реализация отдельным change по этим пунктам. Реализация рекомендована после 013 (советник опирается на optimization-report и staffing-suggestions) и/или 016 (pinned-ограничение советов).

## 1. Граф советника (architecture)

- [x] 1.1 `src/ai/pipelines/advisor.py`: пайплайн enrich → draft (LLM) → validate (pydantic advisory) → fallback; валидация каждого совета retry ≤ 2 (прямой пайплайн без LangGraph — граф не потребовался: одна ветка LLM + fallback)
- [x] 1.2 facts-JSON компоновщик: риски (4 вида), KPI с нормами 013, optimization-report, staffing-suggestions, pin-список (не в контекст — только как фильтр вывода)
- [x] 1.3 Клиент GigaChat через существующий провайдер (env), без ключа — fallback-ветка (детерминированные советы из отчётов)

## 2. Контракт советов (api)

- [x] 2.1 Ручка советов (GET /plans/{id}/advice): на заданной версии плана — советы `task_move | staffing_shift | initiative_rescue | sprint_priority`, каждый с affected_task_ids/numeric_basis/expected_effect; параметр comment (опционально, ≤ 500 симв.) — одноразовый контекст прогона, никогда не сохраняется
- [x] 2.1a Тест comment pass-through: советы с comment=... учитывают контекст; без comment — нет; повторный вызов не хранит текст
- [ ] 2.1b Пианель UI (фронтендеру): поле «что важно учесть» (один комментарий на весь контекст, дозапрос недоступен — подпись), не персистентное — уходит в 021 §5
- [x] 2.2 Fallback == LLM-формат (единая pydantic-модель советов)
- [x] 2.3 Тесты: демо-датасет — советы не пустые; невалидный LLM-ответ → retry → данные (fallback); pinned-задачи не фигурируют в советах на перенос (retry-ветка LLM — только код-ревью, mock-клиента нет; pin-фильтр — tests/test_advisor.py::test_advice_excludes_pinned_tasks)

## 3. Integration

- [x] 3.1 Consumer-указания: в 006-ui дельтой при реализации (стр. 1 кнопка «Советы», стр. 2 блок рисков + советы) — ушли дельтой в 021 §5
- [x] 3.2 README: описание советника + деградация (упоминание в блоке AI-слоя)

## 4. Проверки

- [x] 4.1 Существующие e2e без изменений (советник — только чтение состояния)
- [x] 4.2 openspec validate; pytest зелёные (70 passed, 2026-09-21)
