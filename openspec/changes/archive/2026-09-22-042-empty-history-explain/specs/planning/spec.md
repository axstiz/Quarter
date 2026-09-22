# Update capability: planning

## ADDED Requirements

### Requirement: Объяснение пустой генерации при отсутствии team_history

Если у команды, чьи задачи планироваться, нет строк в team_history (velocity=0), генерация плана SHALL создавать Explanation для каждой задачи этой команды: «истории velocity нет — capacity=0; задачи не запланированы». Ручка也可能 возвращать предупреждение noise composition_change. Юзер SHALL видеть причину, а не молчаливый пустой план. README MUST документировать это ограничение (наполнить team_history или задать velocity).

#### Scenario: Новый workspace без истории

- **GIVEN** задачи добавлены руками, team_history отсутствует
- **WHEN** POST /plans/generate
- **THEN** план содержит только explanations с явной cause «истории нет», никаких «молчаливых» пропусков; юзер понимает, что нужно задать velocity
