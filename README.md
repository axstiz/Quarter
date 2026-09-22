# PostCode Challenge: квартальное планирование команд и звёздная карта

Решение [задания](задание%20PostCode.md). Сервис составляет **выполнимый квартальный план** (6 спринтов × 2 недели = 12 недель), пересчитывает его по фактическим результатам спринтов и показывает **риски загрузки и компетенций** команд (звёздная карта + Bus Factor).

Кому нужно: тимлидам, ресурсным менеджерам, ИТ-директору. Суммарной оценки задач недостаточно — выполнимость зависит от velocity команды, рабочего времени специалистов, потребности в ролях и зависимостей между задачами.

## Быстрый старт

Требования: **docker** (связка одной командой) или [uv](https://docs.astral.sh/uv/) + Node.js 22.

```bash
docker compose up -d --build
# http://localhost:5173 → «Войти как администратор» · Swagger: http://localhost:8000/docs
```

Поднимаются `db` (PostgreSQL 16) + `api` (uvicorn :8000, демо-датасет импортируется сразу) + `frontend` (nginx :5173, проксирует `/api` `/auth` `/workspaces` `/permissions`).

Профили compose: `jobs` — Redis + arq-воркер (фоновые джобы), `optimizer` — Timefold-solver (Java 21). Без них оптимизация отрабатывает жадной эвристикой.

```bash
docker compose --profile jobs --profile optimizer up -d --build

# залить демо-датасет (нужна демо-сессия editor/admin)
TOKEN=$(curl -s -X POST localhost:8000/auth/demo-login -H 'content-type: application/json' \
  -d '{"role":"admin"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
curl -X POST localhost:8000/api/v1/data/import -H "Authorization: Bearer $TOKEN"
```

Сценарий: `/plan` → «Построить план» → «Оптимизировать» (при живом optimizer — режим solver). Остановка: `docker compose --profile jobs --profile optimizer down`; `down -v` — пересоздать БД (обязательно после смены схемы, alembic-миграций нет).

Конфиг — `.env` (шаблон `example.env`): `POSTCODE_DATABASE_URL`, `POSTCODE_LLM_PROVIDER` (`gigachat` | `ollama` | `none`), ключи `GIGACHAT_*`, `POSTCODE_OLLAMA_*`, `POSTCODE_OPTIMIZER_BASE_URL`.

Локально: `uv sync`, `uv run scripts/split_dataset.py`, `docker compose up -d db`, `uv run uvicorn src.main:app --reload`. Тесты: `uv run pytest tests/ -q` (SQLite, без docker). NixOS: `./scripts/fix-venv-nix.sh`.

## Возможности

- **Квартальный план** — распределение задач по 6 спринтам, **причина каждого решения** (включена / перенесена / отменена), приоритеты, двухшаговая отмена.
- **Пересчёт по факту** — факт спринта → новая версия плана + 4 типа рисков: выход за квартал, сдвиг цепочки, дефицит роли, изменение состава.
- **Звёздная карта** — команды, роли, грейды, компетенции, распределение между командами, **Bus Factor** и единственные носители.
- **Метрики** — % выполнения квартала (по инициативам) и спринтов (по SP) от первоначальной базы, факт/прогноз.
- Дополнительно: AI-советник, оптимизация solver'ом, фоновые задачи (Redis), рабочие пространства, роли reader/editor/admin, редактор данных.

## Методологии расчёта

- **Ресурс команды** на спринт = средняя velocity из `team_history` × **0.8** (SP). Нет истории → capacity 0, задачи не планируются.
- **Лимит специалиста** = **80 ч/спринт** (полная ставка) / **40 ч** (0.5); суммируется по всем командам инженера (parttime — 40+40).
- **SP ≠ часы**: две независимые шкалы — SP-гейт (против velocity×0.8) и часовой гейт (против лимитов ролей). Прямой конверсии нет; в датасете `estimated_hh/SP` ≈ 7.5–40.5 (медиана 25).
- **Статусы/объём**: `Done` — вне плана; `InProgress` — остаток `estimated_hh − spent_time`; `ToDo` — полный объём.
- **Приоритет**: меньше — раньше; seed при импорте: `planned_in_sprint='Да'` → 10, остальные → 100 + порядок.
- **Зависимости**: блокер завершается не позже зависимого; ссылки на отсутствующие задачи игнорируются.
- **Разбиение**: задача на несколько спринтов (SP/часы пропорционально); зависимые — после последней части блокера.
- **Кросс-командный заём** роли + **виртуальный держатель** (полная ставка) для ролей без носителей — метится как риск.
- **Bus Factor** = число носителей компетенции/роли (по `engineers_profiles`) в области `company` (workspace) или `team`; 0.5-ставочник — носитель в обеих командах; грейд не влияет; риск при факторе **≤ 1**. Методика и область показываются рядом с показателем; `GET /plans/{id}/bus-risk` — задачи под угрозой, `GET /plans/{id}/bus-forecast` — прогноз уровня риска.
- **Метрики**: % квартала = завершённые инициативы / инициативы с ≥1 задачей в первоначальном плане × 100 % (инициатива завершена, когда все её плановые задачи `done_actual`); % спринта = факт SP / план SP × 100 %. Знаменатель — от первоначального плана (пересчёты не подменяют базу); прогноз помечается. Нормы: PI Predictability 80–100 %, Sprint Say/Do 90–105 %.

## Датасет

`Датасет_с_правками_основной.xlsx` → `uv run scripts/split_dataset.py` → `dataset/*.csv` (ручные правки CSV запрещены — реальные данные править только в xlsx и перегенерировать).

| Файл | Содержимое | Строк |
|---|---|---|
| `tasks.csv` | 45 задач: SP, статусы, даты, результаты | 45 |
| `task_role_requirements.csv` | часы по ролям на каждую задачу | 307 |
| `engineers_profiles.csv` | 34 инженера: команда, роль, грейд, ставка | 34 |
| `task_dependencies.csv` | зависимости между задачами | 16 (15 уник.) |
| `team_history.csv` | velocity спринтов по 5 командам | 12 |
| `reference_values.csv` | справочники (итоги, причины расхождений) | 19 |
| `task_role_hours.csv` | фактические часы по ролям (есть только у 6 задач) | 6 |

Преобразования: даты Excel-serial → ISO `YYYY-MM-DD` (время отбрасывается); колонки → snake_case; инженеры в двух командах — по две записи 0.5.

Аномалии источника (сервис показывает данные как есть, сверка xlsx↔CSV — 0 расхождений): 4 «висячие» зависимости игнорируются; фактические часы 6 задач превышают оценку (показываются витринно, в расчёт не идут); у всех InProgress пустой `spent_time`; 5 зависимостей «Done → не-Done»; 8 из 12 зависимостей межкомандные; 50 комбинаций (команда, роль) без носителя → заём; 9 ролей без носителей в компании → виртуальный держатель.

## API (v1)

```bash
curl -X POST localhost:8000/api/v1/data/import
curl -X POST localhost:8000/api/v1/plans/generate
curl localhost:8000/api/v1/plans/<id>                       # план + причины
curl -X POST localhost:8000/api/v1/plans/<id>/sprints/1/facts -H 'content-type: application/json' \
     -d '{"completed_sp":10,"completed_task_ids":["ONK-2475"]}'
curl localhost:8000/api/v1/plans/<id>/warnings              # 4 вида рисков
curl localhost:8000/api/v1/plans/<id>/diff                  # сдвиги после пересчёта
curl localhost:8000/api/v1/plans/<id>/metrics               # факт/прогноз
curl localhost:8000/api/v1/bus-factor                       # расчёт + методика
curl localhost:8000/api/v1/plans/<id>/bus-forecast          # прогноз bus factor по загрузке
curl localhost:8000/api/v1/plans/<id>/bus-risk              # задачи плана под угрозой
curl localhost:8000/api/v1/star-map/summary
```

Все ручки и схемы — Swagger `/docs`. До `data/import` планирование недоступно (400).

## Разработка

Спеки и change-процесс — [openspec/](openspec): `/opsx-propose "идея"` → ревью → `/opsx-apply` → `/opsx-archive`; `openspec validate` перед MR. Коммиты — Conventional Commits: `тип(scope): описание` (`feat/fix/spec/data/docs/refactor/…`). Хуки: `git config core.hooksPath .githooks` (`commit-msg`, `pre-commit`, `pre-push` — validate спеков + воспроизводимость `dataset/`). Подробности — `AGENTS.md`.

## Скриншоты

Интерфейс на демо-датасете (вход как администратор).

**Вход** — одна кнопка «Войти как администратор» (демо-сессия):

![Вход](docs/screenshots/login.png)

**План квартала** — диаграмма Ганта на 6 спринтов, задачи по инициативам, сводка слева:

![План квартала](docs/screenshots/plan.png)

**Роли по спринтам** — «команда × роль», часы, заём и виртуальные держатели:

![Роли по спринтам](docs/screenshots/roles.png)

**Факт спринта** — внесение результатов раз в две недели и пересчёт:

![Факт спринта](docs/screenshots/sprint.png)

**Звёздная карта** — кластеры команд, роли, грейды; единственные носители подсвечены:

![Звёздная карта](docs/screenshots/star-map.png)

**Компетенции и Bus Factor** — число носителей по областям, методика рядом:

![Компетенции и Bus Factor](docs/screenshots/bus-factor.png)

**Метрики квартала** — % по инициативам и спринтам, факт/прогноз:

![Метрики](docs/screenshots/metrics.png)