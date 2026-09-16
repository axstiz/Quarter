# Frontend — квартальный план и звёздная карта

React 19 + TypeScript + Vite, Tailwind v4, TanStack Query, React Router.

```bash
npm install
npm run dev        # http://localhost:5173 (моки включены в .env.development)
npm run build      # прод-сборка; моки в бандл не попадают
```

## Реальный бэкенд

1. Поднять бэк (см. корневой README): `docker compose up -d && uv run uvicorn src.main:app --reload`.
2. В `.env.development` поставить `VITE_API_MOCKS=false` (или `.env.development.local`).
3. Vite проксирует `/api` → `http://localhost:8000`.

## Структура

```
src/
  api/          client.ts (fetch + флаг моков) · endpoints.ts (все ручки) · queries.ts (хуки) · types.ts
  app/          layout с сайдбаром, роутер, тема, модалка импорта
  components/   ui-кит (Button, Badge, Drawer/Dialog, Toast, States…) и PageHeader
  features/
    plan/         стр. 1 — доска 6 спринтов, причины решений, приоритеты, отмена, виджет Bus-риска
    sprint/       стр. 2 — факт спринта, пересчёт, 4 вида рисков, diff
    star-map/     стр. 3 — созвездие команд, фильтры, профиль инженера, Bus Factor + методика
    metrics/      стр. 4 — % квартала/спринтов, факт vs прогноз, история версий
    onboarding/   стр. 0.1 — загрузка файла → AI-сопоставление → подтверждение
    auth/         стр. 0 — заглушка входа (auth — change 005)
  mocks/        мок-бэкенд в памяти (только для VITE_API_MOCKS=true)
```

Текущая версия плана — последняя из `GET /plans`; `?plan=<id>` в URL фиксирует конкретную версию.

## Как убрать моки

1. `rm -rf src/mocks`
2. В `src/api/client.ts` удалить `USE_MOCKS` и блок `if (USE_MOCKS) { … }`.
3. В `src/app/AppLayout.tsx` удалить бейдж `MOCK API` (импорт `USE_MOCKS`).
4. Удалить `VITE_API_MOCKS` из `.env.development` и `src/vite-env.d.ts`.

Моки подключаются динамическим импортом из одного места, остальной код о них не знает.

## Что считается на фронте (нет ручки в API)

- **Задачи под угрозой Bus Factor** (`features/plan/busRisk.ts`): роли из `role_hours` задачи сопоставляются с ролями `scope=company, factor ≤ 1` из `/bus-factor`.
- **Порядок приоритетов**: `PUT /tasks/{id}/priority` шлётся по одной задаче последовательно, затем `POST /plans/{id}/recompute`.
- **warnings/diff** запрашиваются у версии, в которую загружен факт, — это `parent_plan_id` текущего плана.
