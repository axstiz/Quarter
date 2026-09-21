## Why

LLM сейчас жёстко привязан к GigaChat (`src/ai/gigachat.py`, ключи только Sber). Для локальной разработки/демо без доступа к GigaChat нужен локальный провайдер — Ollama; выбор провайдера должен настраиваться через `.env`, не трогая код.

## What Changes

- Новый модуль `src/ai/llm.py`: провайдер-агностичный клиент с фабрикой `get_client()`; провайдеры `gigachat` (текущий) и `ollama` (OpenAI-совместимый `/v1/chat/completions`); исключение `LLMUnavailable` (alias `GigaUnavailable` для совместимости).
- Настройки `.env`: `POSTCODE_LLM_PROVIDER=gigachat|ollama|none` (default gigachat), `POSTCODE_OLLAMA_BASE_URL` (default `http://localhost:11434`), `POSTCODE_OLLAMA_MODEL`. Ключи GigaChat остаются как есть (`GIGACHAT_CLIENT_*`).
- Пайплайны (`normalization`, `advisor`) и ручка советника переключаются на `src/ai/llm.py` без смены поведения: недоступный провайдер → текущая деградация (шаблонный режим/fallback-советы).
- Шаблон `example.env` с LLM-настройками.

## Capabilities

### New Capabilities

(пусто)

### Modified Capabilities

- `onboarding`: требование о деградации LLM обобщается — провайдер выбирается конфигурацией (GigaChat или Ollama), недоступность любого провайдера снижает пайплайн до шаблонного режима.

## Impact

- Код: `src/ai/llm.py` (новый), `src/ai/gigachat.py` (становится gigachat-адаптером), `src/core/config.py` (+3 настройки), точечно импорты в `normalization.py`, `advisor.py`, `api/routes.py`.
- API: контракты не меняются; `mode` в ответе советника остаётся `llm|fallback`.
- Зависимости: без новых (Ollama через httpx, уже в проекте).
- Тесты: выбор провайдера по настройкам, Ollama-клиент (мок HTTP), деградация при недоступности Ollama.
