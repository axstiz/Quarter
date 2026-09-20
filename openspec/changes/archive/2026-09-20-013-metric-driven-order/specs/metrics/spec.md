# Update capability: metrics

## ADDED Requirements

### Requirement: Целевые нормы KPI (PDF Демо_онбординг)

Показатели SHALL нести целевые нормы из PDF: PI Predictability норма 80–100 % (KPI №1), Sprint Say/Do Ratio норма 90–105 % (KPI №2). Каждый показатель MUST содержать `target_band` (min..max) и признак соответствия (`within_norm: true|false` для фактических и прогнозных значений). Терминология PDF «Неделя 0» SHALL фиксироваться как initial-план (первый снапшот согласован capability planning/replanning).

#### Scenario: Норма соблюдена

- **GIVEN** PI Predictability = 87 %
- **WHEN** GET /plans/{id}/metrics
- **THEN** quarter_completion_pct=87.0 с target_band {min:80, max:100} и within_norm=true

#### Scenario: Вне нормы (прогноз)

- **GIVEN** прогноз Say/Do спринта 3 = 72 %
- **WHEN** метрики середины квартала
- **THEN** sprint_completion_pct[3]=72.0, target_band {90..105}, within_norm=false, пометка «прогноз» сохраняется

#### Scenario: Неделя 0

- **WHEN** документируется знаменатель KPI №1
- **THEN** «запланированные на Неделе 0» = задачи initial-плана (is_initial=True корень снапшот-цепочки)
