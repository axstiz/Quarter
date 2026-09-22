# Tasks: 055-advisor-live-hiring
- [x] 1.1 role_deficit_by_sprint (6 спринтов, hires=⌈дефицит/80⌉) + проброс в facts_json и fallback. Проверка: unit-тесты
- [x] 1.2 AdviceItem kind += hiring, affected_roles; промпт «первый совет отвечает на вопрос; найм — из дефицитов». Проверка: pydantic-тест
- [x] 1.3 Fallback hiring-совет (первым при вопросе; честное «не требуется»; дефицит спринта 1 без вопроса). Проверка: unit-тесты
- [x] 1.4 GigaChat: 3 попытки с backoff. Проверка: код-ревью + live
- [x] 1.5 Фронт: лейбл «Найм», affected_roles. Проверка: build + lint
- [x] 1.6 QA live: «кого нанять до 1 спринта» → mode=llm, kind=hiring первым, реальные роли. Проверка: live GigaChat
- [x] 1.7 openspec validate + коммит + архивация + push
