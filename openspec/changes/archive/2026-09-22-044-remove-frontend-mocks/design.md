# Design: 044-remove-frontend-mocks

Удаление по собственной инструкции в коде (client.ts: «Чтобы убрать моки: удалить src/mocks/, этот флаг и блок if (USE_MOCKS)»). Фронт становится pure consumer реального API; dev — через docker compose (api/db), не через in-memory mock. Режима без бэка нет (по решению лида — реальный бэк всегда доступен).
