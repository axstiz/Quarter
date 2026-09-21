# Tasks: 029-solver-feasible-budget

## 1. Java: unimproved-конфиг

- [x] 1.1 `OptimizerConfig`: поле `unimprovedLimitSeconds` (env `OPTIMIZER_UNIMPROVED_LIMIT_SECONDS`, default = min(timeLimit, 30)). Проверка: `mvn test` зелёный
- [x] 1.2 `SolveService`: `withTerminationUnimprovedSpentLimit(unimprovedLimit)` (больше 5 с зашито не будет). Проверка: unit — unimproved из env подхватывается

## 2. Бюджеты (Python + compose)

- [x] 2.1 `config.py`: `optimizer_solve_timeout_sec` 60 → 200; `jobs_timeout_sec` 120 → 300. Проверка: тесты настроек
- [x] 2.2 `docker-compose.yml`: `OPTIMIZER_TIME_LIMIT_SECONDS: 30 → 180` (optimizer + возможно example.env дока). Проверка: `docker compose config`

## 3. Честная деградация (Python)

- [x] 3.1 `optimize_plan.py`: после solve — `score.hard != 0` → `SolverUnavailable("solver не достиг выполнимости за бюджет (X с)")` → эвристика (не 422); repair остаётся только для hard==0-гэпа. Проверка: unit — infeasible ответ → heuristic draft
- [x] 3.2 Отчёт: `degradation_reason` в job-отчёте при деградации (недоступен / не успел). Проверка: unit — причина в отчёте

## 4. UI-сообщения

- [x] 4.1 `PlanPage.tsx`/`types.ts`: toast показывает solve-time и degradation_reason (текст: «solver не уложился в бюджет — план построен эвристикой; можно перезапустить»). Проверка: `npm run build`

## 5. Тесты и проверки

- [x] 5.1 Java mvn test зелёный (score/feasible-поля присутствуют в ответе)
- [x] 5.2 Полный pytest зелёный (existing + новые: infeasible → эвристика, таймаут → эвристика, repair-гэп → 422)
- [x] 5.3 Живой E2E: 180-с лимит, очередь, mode solver; сценарий «solver недоступен» (BASE_URL мусор) → mode heuristic + degradation_reason
- [x] 5.4 README: раздел «ограничения реализации» — приближённый solver, честный fallback, repair как страховка; todo обновлён
