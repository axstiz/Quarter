# Update capability: jobs

## ADDED Requirements

### Requirement: Честная деградация solver-очереди

Черновик solver'а SHALL проверяться на выполнимость: если `score.hard != 0` (solver не достиг выполнимой раскладки за бюджет), бэк SHALL уйти в эвристическую стратегию (как при недоступном сайдкаре), при этом job MUST получить mode `heuristic` и `degradation_reason` «solver не достиг выполнимости за бюджет» — без 422. 422 при записи версии SHALL сохраняться только для нерепарируемых структурных нарушений после repair (зависимости/sole-holder/SP-гейт/ёмкость ролей). Причину деградации SHALL видеть пользователь (degradation_reason в отчёте).

#### Scenario: Solver не успел — честная эвристика

- **GIVEN** solver вернул черновик с score.hard != 0 (не уложился в бюджет)
- **WHEN** бэк обрабатывает черновик
- **THEN** план построен эвристикой, mode=heuristic, degradation_reason «solver не достиг выполнимости за бюджет»; версия создана, 422 нет

#### Scenario: Гэп Java-vs-Python — repair и возможно 422

- **GIVEN** solver отдал score.hard == 0, Python-валидация нашла нарушение
- **WHEN** repair_dependencies сдвигает зависимые части за конец блокера
- **THEN** hard-валидация повторяется; успех — версия создаётся (сдвиги в reason задач), неудача — 422 failed с описанием нарушения

#### Scenario: Все бюджеты консистентны

- **GIVEN** solve budget 180 с
- **THEN** HTTP-таймаут бэка к сайдкару (200 с) > solve budget; arq job_timeout (300 с) > HTTP-таймаута — solve не обрывается по чужим лимитам
