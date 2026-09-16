# AGENTS.md — инструкции для AI-агентов (OpenCode и др.)

Проект: PostCode Challenge — сервис квартального планирования команд и звёздная карта.
Спеки процесса: `openspec/` (см. `openspec/specs/*/spec.md`), детали данных и согласований — `README.md`.

## Commits

Формат строго Conventional Commits: `тип(scope): описание` — по-русски, строчными.

- Типы: `feat fix docs refactor test chore ci build perf spec data revert`
- scope (необязательный) — имя capability (`planning`, `replanning`, `star-map`, `bus-factor`, `metrics`, `data`) или модуль (`dataset`, `ui`)
- Примеры: `feat(planning): распределение задач по спринтам`, `data: нормализация дат в ISO`

## Запрещено

- `git commit --no-verify` — хук `.githooks/` не обходить
- `git push --force`, пуш в `main` (ветка защищена), правки истории без явного разрешения лидом
- Ручное редактирование `dataset/*.csv` — они генерируются `uv run scripts/split_dataset.py` из xlsx (спека `data`). Нужны новые данные → правь xlsx/скрипт и перегенерируйте
- Править `openspec/specs/` напрямую — только через change proposal (`/opsx-propose`) и `archive`

## Workflow

- Любая фича/изменение поведения: сначала change (`/opsx-propose`), ревью лидом, потом `/opsx-apply` — код в рамках tasks.md этого change.
- Перед MR: `openspec validate --all`, для данных — перегенерация dataset без diff'а.
- Стек: Python 3.13 + uv (`uv sync`, `uv run ...`); Node 22 только для openspec CLI.

## Проверки

- `openspec validate --all` — все спеки валидны
- `uv run scripts/split_dataset.py` — dataset воспроизводится byte-идентично
- Хуки работают: `git config core.hooksPath .githooks` — сообщи разработчику один раз после клона
