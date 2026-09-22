# Tasks: 031-optimize-progress

- [x] 1.1 `useOptimizePlan`: polling цикл до terminal (2 c), таймаут ~3.2 мин → идея fail? (errorToast). Проверка: build + mocked-job тест фр (если есть)
- [x] 1.2 Toast после терминала: верный modeLabel (null queued больше не отображается как «эвристика»), degradation_reason добавлен. Проверка: npm run build/lint
- [x] 1.3 Живой прогон: кнопка в busy всю очередь solver'а, после — версия переключилась, тост по режиму
