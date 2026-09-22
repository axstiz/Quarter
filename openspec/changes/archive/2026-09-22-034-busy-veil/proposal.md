# Proposal: 034-busy-veil

## Why

Пока перестраивается/оптимизируется план, пользователь не видит «идёт работа»: кнопка-лоадер скромная, страница выглядит доступной, легко начать параллельные действия и получить неожиданную пересборку после завершения solve (найдено на живой QA).

## What Changes

- Новый компонент `ui/BusyVeil`: полноэкранная вуаль (spinner + текст статуса), весь контент страницы под ней приглушён (grayscale/opacity) и не интерактивен (pointer-events)
- PlanPage: busy = optimize.isPending || generate.isPending (polling 031 держит busy весь solve — флаг достоверный); статус-тексты: «в очереди (solver)…» / «Solver перестраивает расстановку…» / «Строим план заново…»
- SprintFactPage: busy = recompute.isPending || fact.isPending («Загрузка факта спринта…», «Пересчёт оставшихся спринтов…»)
- Локальные inline-статусы (RolesView-баннер пинов) сохраняются — глобальность не нужна на быстрых операциях

## Capabilities

### Modified Capabilities

- `ui` — процесс перестройки плана SHALL визуально блокировать страницу: вуаль со spinner и статус-текстом, под ней контент серый и не интерактивен до терминального статуса.

## Impact
Фронт-only: `frontend/src/components/ui/BusyVeil.tsx`, стили, `PlanPage.tsx`, `SprintFactPage.tsx`.
