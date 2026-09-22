## Context

`src/ai/gigachat.py` содержит `GigaChatClient.complete(system, user, temperature)` и синглтон `get_client()`; потребители (`normalization.py`, `advisor.py`, `routes.py` — ручка советника) импортируют `GigaUnavailable`/`get_client` напрямую. Интерфейс уже совпадает с нужным — достаточно фабрики. httpx в зависимостях (optimizer_client). Настройки — pydantic-settings с `env_prefix=POSTCODE_`, `env_file=.env` (config.py).

## Goals / Non-Goals

**Goals:**
- Ollama как равноправный провайдер рядом с GigaChat; выбор через `.env`.
- Ноль изменений поведения при существующей конфигурации (default gigachat).
- Деградация при недоступности любого провайдера — как сейчас.

**Non-Goals:**
- Очередь LLM-вызовов через Redis (отдельный пункт в todo).
- Стриминг, function-calling, другие провайдеры (OpenAI Cloud и т.п.).
- Перевод GigaChat-ключей под префикс POSTCODE_ (совместимость `.env` не ломаем).

## Decisions

1. **`src/ai/llm.py` — фабрика + протокол**: `LLMUnavailable` (alias `GigaUnavailable`), протокол `enabled`/`complete()`, `get_client()` выбирает по `settings.llm_provider`. Старый `src/ai/gigachat.py` остаётся gigachat-адаптером; `llm.py` реэкспортирует для обратной совместимости импортов (миграция импортов потребителей в том же change).
2. **Ollama через OpenAI-совместимый `/v1/chat/completions`** (httpx sync-клиент, как `GigaChatClient.complete` — синхронный): не тянем SDK. Нативный `/api/chat` отвергнут — OpenAI-совместимость даст бесплатную заменяемость на другие локальные серверы (vLLM, LM Studio).
3. **Доступность Ollama — ленивая**: `enabled=True` при выбранном провайдере; сетевые ошибки/таймаут на вызове → `LLMUnavailable` → существующий fallback. Не делаем health-check на старте (локальный сервер может подняться позже).
4. **`llm_provider=none`**: клиент-заглушка с `enabled=False` — потребители уходят в fallback без единого вызова.

## Risks / Trade-offs

- Модель Ollama может хуже держать JSON-контракт советника — смягчается существующей pydantic-валидацией и retry/fallback (2 попытки, затем fallback).
- Синхронный вызов Ollama в event loop (как и GigaChat сейчас) — принимаем; очередь/асинхронность — отдельный пункт todo.
