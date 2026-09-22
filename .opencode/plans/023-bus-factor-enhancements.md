# Plan: change 023-bus-factor-enhancements

Статус: change `023-bus-factor-enhancements` создан (`openspec new change`, schema spec-driven).
Артефакты: proposal → specs → design → tasks (ждут записи после выхода из plan mode).

## Суть изменений (черновик proposal)

**Why**: `plan_bus_risk` учитывает только company-область — задача в команде с единственным
носителем роли не помечается риском, если в компании носителей много. Наивное сопоставление
ролей по строке раздувает одиночные зависимости («Тестировщик» vs «Тестировщик
(Автотестирование)» — оба factor 1, хотя автотестировщик покрывает ручное тестирование).

**What Changes**:
1. Team-scope в `plan_bus_risk` (GET /plans/{plan_id}/bus-risk): риск = factor ≤ 1 в
   области команды задачи (`task.team_id`) ИЛИ компании; в ответе указывается затронутый scope.
2. Группировка ролей: таксономия родительских ролей конфигурируемым словарём
   («Тестировщик (Автотестирование)» → «Тестировщик»); dataset/*.csv не меняются.
3. Обогащения: `at_risk_hours` (требуемые часы рискованной роли в задаче),
   `parttime_holder` (флаг неполной ставки у единственного носителя).
4. Обновление `METHODOLOGY`; обратная совместимость полей ответа.

**Capabilities** (modified):
- `bus-factor` — требование «Риски плана в терминах задач» (дельта: ADDED/MODIFIED).
- `api` — требование «Ручка Bus-риска плана» (расширенный контракт ответа).

**Impact**: `src/services/bus_factor.py`, `src/api/routes.py`,
`frontend/src/mocks/index.ts` (порт формулы), тесты `test_frontend_readiness.py`,
`test_bus_factor_scopes.py`. Dataset не трогаем.

## Шаги после выхода из plan mode

1. `openspec instructions proposal` → записать `proposal.md` (по черновику выше).
2. Записать дельта-спеки `specs/bus-factor/spec.md` и `specs/api/spec.md`
   (формат как в archive/2026-09-20-014: `## ADDED/MODIFIED Requirements` + сценарии).
3. Записать `design.md` (как: словарь группировки ROLE_GROUPS в bus_factor.py,
   нормализация роли через группу перед подсчётом holders; двойная проверка scope;
   порт на фронт).
4. Записать `tasks.md` (сервис → API → фронт-моки → тесты → validate).
5. `npx openspec validate 023-bus-factor-enhancements`.

## Попутное замечание (вне скоупа)

`openspec/specs/api/spec.md:185` — незакрытый merge-конфликт `<<<<<<< ours`.
Стоит починить отдельным change/фиксом (правка specs напрямую запрещена AGENTS.md).
