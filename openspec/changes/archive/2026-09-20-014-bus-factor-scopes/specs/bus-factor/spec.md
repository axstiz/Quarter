# Update capability: bus-factor

## ADDED Requirements

### Requirement: Расчёт по каждой команде

Для каждой команды сервис SHALL вычислять отдельный набор факторов Bus Factor по ролям и заявленным навыкам (область team): инженеры одной команды не учитываются в факторе другой; инженер с частичной занятостью (0.5 ставки в двух командах) — носитель в обеих. Командные факторы — первоклассная область расчёта (не побочный продукт company-расчёта), доступная по фильтру и через ручку команды.

#### Scenario: Фактор команды

- **GIVEN** команда Team-L, роль «Дизайнер» — единственный носитель в этой команде (ENG-405, 0.5 ставки)
- **WHEN** расчёт по области team=Team-L
- **THEN** item {scope_type: team, scope_id: Team-L, key: «дизайнер», factor: 1, holders: [ENG-405]}

#### Scenario: Границы команды

- **GIVEN** инженер ENG-999 (не состоит в Team-K) владеет навыком «Spark»
- **WHEN** расчёт по области team=Team-K
- **THEN** ENG-999 (не-человек-команды) не входит в holders фактора «spark» для Team-K

### Requirement: Расчёт в границах workspace

Расчёт Bus Factor SHALL выполняться в границах одного workspace (capability workspace, change 008): engineers разных workspace-ов не смешиваются в одной области. Термин `company` в существующей спеке после реализации 008 читается как «текущий workspace» (дефолт при единственном workspace — прежнее одно-датасетное поведение).

#### Scenario: Одинаковый навык в двух компаниях

- **GIVEN** навык «Spark» — единственный носитель в workspace A (factor 1) и два носителя в workspace B (factor 2)
- **WHEN** расчёт выполняется отдельно в контексте workspace A и в контексте workspace B
- **THEN** области независимы: workspace A → factor 1, workspace B → factor 2; смешения нет

#### Scenario: Дефолт без workspace

- **GIVEN** workspace-контекст не указан (change 008 не реализован или default)
- **WHEN** GET /bus-factor
- **THEN** расчёт по всем инженерам default workspace — прежнее поведение
