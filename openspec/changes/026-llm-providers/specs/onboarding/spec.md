## ADDED Requirements

### Requirement: Выбор LLM-провайдера конфигурацией

LLM-провайдер SHALL выбираться переменной окружения (`POSTCODE_LLM_PROVIDER`): `gigachat` (Sber GigaChat, ключи `GIGACHAT_CLIENT_*`), `ollama` (локальный OpenAI-совместимый endpoint, `POSTCODE_OLLAMA_BASE_URL`/`POSTCODE_OLLAMA_MODEL`), `none` (LLM отключён). Смена провайдера MUST NOT требовать изменений кода; оба провайдера реализуют единый интерфейс `complete(system, user)`.

#### Scenario: Локальный запуск через Ollama

- **GIVEN** заданы `POSTCODE_LLM_PROVIDER=ollama` и доступный Ollama-сервер
- **WHEN** пайплайн нормализации или советник обращается к LLM
- **THEN** запрос уходит в Ollama, ответ валидируется pydantic-схемой как у GigaChat

#### Scenario: Недоступность выбранного провайдера

- **GIVEN** выбранный провайдер недоступен (нет ключа GigaChat / Ollama не отвечает)
- **WHEN** выполняется LLM-шаг пайплайна или советника
- **THEN** сервис снижается до шаблонного режима/детерминированных советов без hard-fail

#### Scenario: LLM отключён

- **GIVEN** `POSTCODE_LLM_PROVIDER=none`
- **WHEN** выполняется LLM-шаг
- **THEN** LLM не вызывается, поведение как при недоступном провайдере
