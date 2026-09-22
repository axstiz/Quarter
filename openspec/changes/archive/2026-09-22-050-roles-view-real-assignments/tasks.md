# Tasks: 050-roles-view-real-assignments
- [x] 1.1 PlanAssignment + PlanTask.assignments в types.ts. Проверка: build
- [x] 1.2 buildRoleModel: спрос из row.assignments (дорожка команды инженера, loan ≠ владелец, VIRTUAL → дефицит); fallback для строк без назначений. Проверка: build + lint
- [x] 1.3 Агрегация чипов (дорожка×задача×роль×заём), число инженеров, part/parts по разным спринтам. Проверка: build
- [x] 1.4 QA live: чипов 626→425, часы по спринтам совпадают ±1%, осколки <1ч устранены; новый бандл отдаётся. Проверка: live
- [x] 1.5 openspec validate + коммит + архивация + push
