# Tasks: 030-gigachat-ca-container

- [x] 1.1 compose: volume `/etc/nixos/certs:/etc/nixos/certs:ro` в api и worker. Проверка: `docker compose config`
- [x] 1.2 `src/ai/gigachat.py`: try/except (FileNotFoundError/OSError) на конструировании SDK → GigaUnavailable. Проверка: unit — кривой CA_BUNDLE → GigaUnavailable (не 500)
- [x] 1.3 Пересборка api/worker + живой GET /advice (mode llm|fallback, не 500)
- [x] 1.4 openspec validate + pytest зелёные
