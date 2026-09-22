# Update capability: ui

## ADDED Requirements

### Requirement: Список статусов файлов при импорте

Страница импорта SHALL отображать список выбранных файлов со статусами каждого job'а (uploaded/mapping/questions/ready/failed) и прогрессом, ошибка одного файла не валит оставшиеся.

#### Scenario: Статус per-file

- **GIVEN** два файла загружаются
- **WHEN** первый попал в failed (парс-ошибка)
- **THEN** второй продолжаетWAIT, тост по каждому; failed-строка с причиной
