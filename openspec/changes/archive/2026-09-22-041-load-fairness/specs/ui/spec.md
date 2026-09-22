# Update capability: ui

## ADDED Requirements

### Requirement: Баннер-сводка управляемого improvement после optimize

После успешного optimize (job ready) на странице плана SHALL показываться закрываемый баннер со сводкой: «что изменилось» по реальным числам из отчёта (σ SP, хвост квартала, role-дефициты, transferred moves); при heuristic/degradation — причина честно. Баннер не перекрывает контент.

#### Scenario: solver улучшил

- **GIVEN** optimize job ready, mode=solver
- **WHEN** готов отчёт с split_by_team_role
- **THEN** баннер «Оптимизация улучшила план: σ→…; хвост задействован …»; контент плановой страницы открыт, селектор на новую версию

#### Scenario: эвристика honesty

- **GIVEN** solver не уложился
- **WHEN** advice ready in heuristic
- **THEN** баннер «построен эвристикой (reason)», без красного
