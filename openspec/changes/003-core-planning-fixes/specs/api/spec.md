# Update capability: api

## ADDED Requirements

### Requirement: Ручки приоритета и отмены

API SHALL предоставлять: PUT /tasks/{task_id}/priority (перестановка порядка), POST /plans/{plan_id}/tasks/{task_id}/cancel-request (сервис предлагает отмену), POST /plans/{plan_id}/tasks/{task_id}/confirm-cancel (лид подтверждает).

#### Scenario: Подтверждение отмены

- **WHEN** POST confirm-cancel на отложенную (cancelled_pending) задачу
- **THEN** решение задачи становится cancelled с фиксацией причины

# Update capability: data

## ADDED Requirements

### Requirement: Seed приоритетов

Первичный импорт SHALL заполнять приоритеты задач: задачи заказчика (`planned_in_sprint='Да'`) получают высокий приоритет; остальным — исходный порядок следования, растущий с порядком. Допущение фиксируется в README по capability data.

#### Scenario: Seed приоритета

- **GIVEN** задачи с пустым полем priority
- **WHEN** импортируется датасет
- **THEN** задачам с флагом заказчика присваивается приоритет выше прочих
