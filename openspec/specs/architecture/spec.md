# architecture Specification

## Purpose
Слои и стек бэкенда, правила изменения — чтобы командная разработка и агенты писали одинаково.

## Requirements

### Requirement: Слои и стек

Бэкенд SHALL состоять из слоёв api (тонкие роутеры), services (бизнес-логика без HTTP), db (SQLAlchemy async + alembic), domain (pydantic), на стеке Python 3.13 + uv, FastAPI, PostgreSQL через docker-compose (fallback SQLite через env — для тестов).

#### Scenario: Новый эндпоинт

- **WHEN** разрабатывается новая ручка
- **THEN** логика размещается в services/, роутер остаётся тонким, схема ответа — в domain/

### Requirement: Импорт данных

Бэкенд SHALL импортировать dataset/*.csv в БД через db/importer.py; source of truth остаётся xlsx (capability data). Повторный импорт (reset_dataset_tables) очищает ТОЛЬКО импортные таблицы датасета (tasks, task_role_requirements, task_dependencies, engineers_profiles, team_history); таблицы планов (plans, plan_items, sprint_facts) НЕ затрагиваются.

#### Scenario: Повторный импорт

- **WHEN** POST /api/v1/data/import повторно после правки xlsx
- **THEN** данные датасета обновлены; созданные ранее планы и факты спринтов сохранены

### Requirement: Конфигурация через env

Конфигурация (DSN БД, пути dataset) SHALL задаваться переменными окружения с дефолтами, позволяющими запустить без настройки.

#### Scenario: Чистая машина

- **GIVEN** docker compose up и uv run uvicorn без .env
- **THEN** сервис поднимается со стандартной DSN localhost postgres

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

### Requirement: Сайдкар-сервис optimizer

Платформа SHALL включать отдельный сервис `optimizer` на Java/Kotlin со Timefold Solver, доступный через docker-compose profile `optimizer` (как Redis-воркер в change 007): бэкенд общается по HTTP на внутреннем порту. Контракт solve: бэк отправляет снапшот задачи оптимизации (плановые задачи с role_hours, SP, зависимости, инженеры с командами/ставками/компетенциями, история velocity, параметры целевой функции) и получает черновик расстановки (части задач по спринтам + переносы людей) и score за отведённый лимит времени. Отсутствие или сбой сайдкара SHALL восприниматься как штатная деградация — бэк не теряет функцию (планирование продолжается жадной стратегией), благодаря деградации change 018 planning.

#### Scenario: Solver поднят через профиль

- **GIVEN** `docker compose --profile optimizer up` поднят
- **WHEN** бэк получает `POST /plans/optimize`
- **THEN** снапшот уходит в optimizer, черновик возвращается бэку для валидации

#### Scenario: Solver не поднят — работоспособность сохраняется

- **GIVEN** сайдкар не запущен
- **WHEN** бэк стартует и пользователь запускает оптимизацию
- **THEN** работа продолжается в режиме «эвристика» (жадная стратегия 013), запуск бэка и остальной планирования не затронуты

### Requirement: Конфигурация оптимизатора

Seed, лимит времени решения, порог прироста для переноса людей и таймауты HTTP-контракта SHALL задаваться конфигурацией (env/файл), а не константами в коде. Повторный solve с тем же seed и доменом SHALL давать одинаковую выборку черновика на стороне optimizer (детерминизм в пределах лимита времени; специфика Timefold — стресс-тест не прерванный по таймауту).

#### Scenario: Конфигурация переноса

- **GIVEN** конфиг задаёт порог прироста для переноса людей
- **WHEN** solver находит улучшение ниже порога
- **THEN** перенос не включается в черновик

### Requirement: AI-советник как LangGraph-граф

AI-советник SHALL реализоваться новым графом в `src/ai/pipelines/advisor` по правилам существующего AI-слоя: вход — facts-JSON (компактная сводка: риски, KPI, отчёты 013 — не полный датасет), выход — pydantic-схема `advisory` (валидация каждого совета); вызовы planner-гейтов и мутации данных из графа запрещены. Провайдер — GigaChat через env (как capability onboarding), деградация без ключа — детерминированные подсказки.

#### Scenario: Новый вызов советера

- **WHEN** добавляется советник
- **THEN** это новый граф в src/ai/pipelines (advisor) с общей обёрткой провайдера — без изменения planner/services (ядро не зависит от агента)

#### Scenario: Границы контекста

- **GIVEN** датасет 45 задач × 307 строк ролей
- **WHEN** формируется запрос к LLM
- **THEN** в контекст подаётся сводка (факты/риски/KPI/отчёты — плоский JSON ограниченного объёма), а не весь датасет
