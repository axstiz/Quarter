## 1. Тесты (TDD: red)

- [x] 1.1 Тест фабрики: `llm_provider=gigachat|ollama|none` → соответствующий клиент; default — gigachat.
- [x] 1.2 Тест Ollama-клиента: мок HTTP 200 → текст ответа; сетевой сбой/500 → `LLMUnavailable`.
- [x] 1.3 Тест деградации советника с `llm_provider=ollama` и недоступным сервером → `mode=fallback`, 200 (как существующий fallback-путь).

## 2. Реализация (green)

- [x] 2.1 `src/core/config.py`: `llm_provider` (gigachat|ollama|none, default gigachat), `ollama_base_url`, `ollama_model`.
- [x] 2.2 `src/ai/llm.py`: `LLMUnavailable` (+ alias `GigaUnavailable`), протокол, `OllamaClient`, заглушка none, фабрика `get_client()`; `gigachat.py` — без изменений интерфейса.
- [x] 2.3 Импорты потребителей (`normalization.py`, `advisor.py`, `api/routes.py`) на `src.ai.llm`; регресс зелёный.
- [x] 2.4 `example.env` с LLM-блоком (без секретов).

## 3. Регресс и документация

- [x] 3.1 `uv run pytest tests/ -q` весь набор; `openspec validate --all`.
- [x] 3.2 README: раздел про LLM-провайдеры (gigachat/ollama/none, переменные).
- [ ] 3.3 (опц.) Живая проверка с локальным Ollama, если установлен.
