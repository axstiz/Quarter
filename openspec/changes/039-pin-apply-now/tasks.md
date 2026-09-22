# Tasks: 039-pin-apply-now
- [ ] 1.1 POST pin немедленно: UPDATE строк задачи (sprint_no=цель) + assignments sprint_no=цель + pinned_sprint; 409 на ёмкость инженера. Проверка: unit — pin применяется в БД, GET возвращает в целевом спринте
- [ ] 1.2 Тест: 409 на перегрузку инженера при пине; dependency 409 сохранён. Проверка: pytest
- [ ] 1.3 Live E2E: drag → GET plan показывает в новой колонке (совпадение optimistic). Проверка: curl
- [ ] 1.4 Спек validate + коммит + merge + push
