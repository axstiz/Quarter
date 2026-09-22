# Proposal: 030-gigachat-ca-container

## Why

`GIGACHAT_CA_BUNDLE` указывает на файл хоста (/etc/nixos/certs), которого нет внутри контейнера api/worker — SDK падает `FileNotFoundError`, который не является `GigaUnavailable`, поэтому советник возвращает 500 вместо штатного fallback (найдено живьём на QA).

## What Changes

- compose: монтируется каталог `/etc/nixos/certs` (rid-onlhy) в `api` и `worker` по тому же пути — `.env` менять не нужно
- `GigaChatClient._ensure`: конструирование SDK в try/except (OSError/FileNotFoundError → `GigaUnavailable`) — кривой/отсутствующий CA_BUNDLE даёт fallback-советы, не 500
- Юнит-тест: несуществующий CA_BUNDLE → GigaUnavailable (советник деградирует, не 500)

## Capabilities

### Modified Capabilities

- `api` — советник SHALL не возвращать 500 при недоступном/кривом CA-бандле: ошибка инициализации SDK LLMannah превращается в штатную деградацию fallback.

## Impact
`docker-compose.yml`, `src/ai/gigachat.py`, тест advisor.
