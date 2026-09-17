# Update capability: architecture

## ADDED Requirements

### Requirement: CORS для фронтенда

Бэкенд SHALL подключать CORSMiddleware с origins из env `CORS_ORIGINS` (разделитель — запятая); дефолт `*` (auth отсутствует до change 005, секретов нет; `allow_credentials=False` — сочетание `*`+credentials запрещено спецификацией CORS).

#### Scenario: Dev-сервер фронта на другом порте

- **GIVEN** фронтенд работает на http://localhost:5173, бэкенд на http://localhost:8000
- **WHEN** фронтенд выполняет запрос к `/api/v1/...`
- **THEN** ответ содержит заголовок `Access-Control-Allow-Origin`, запрос не блокируется браузером

#### Scenario: Конкретные origin через env

- **GIVEN** задано `CORS_ORIGINS=https://planner.example.com`
- **WHEN** запрос с Origin `https://planner.example.com`
- **THEN** запрос разрешён; запрос с прочих origin получает CORS-запрет браузера
