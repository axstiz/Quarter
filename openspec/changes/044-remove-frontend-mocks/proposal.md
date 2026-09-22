# Proposal: 044-remove-frontend-mocks

## Why

Моки фронтенда (src/mocks) больше не нужны — реальный бэк полностью работает (compose). Их удаление упрощает фронт и убирает риск расхождения мок-логики с бэком.

## What Changes

- Удалены `frontend/src/mocks/*` (dataset.ts, engine.ts, index.ts, types.ts) и `USE_MOCKS`/`VITE_API_MOCKS` флаг из client.ts, auth.ts, Layout.tsx, vite-env.d.ts, .env.development (теперь `false`)
- Фронт ходит только в реальный API через Vite proxy → :8000; режима без бэка нет
- README фронта: раздел про моки заменён заметкой «моки удалены»

## Capabilities

### Modified Capabilities

- `ui` — фронт работает только с реальным бэком; мок-режим исключён.

## Impact
`frontend/src/api/{client,auth}.ts`, `Layout.tsx`, `vite-env.d.ts`, `.env.development`, README фронта.
