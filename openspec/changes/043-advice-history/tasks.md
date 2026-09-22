# Tasks: 043-advice-history
- [ ] 1.1 AdviceReportORM + миграция (create_all) + POST /advice записывает прогон. Проверка: unit — после прогона в БД запись с comment
- [ ] 1.2 GET /advice/history per-plan_id с version_label. Проверка: unit — история по версии
- [ ] 1.3 Фронт: react-query useAdvice (state per planId) — не слетает при переключении. Проверка: build
- [ ] 1.4 История в панели: версия, время, режим, comment; раскрытие items. Проверка: build/live
- [ ] 1.5 pytest/build/lint/validate + архивация
