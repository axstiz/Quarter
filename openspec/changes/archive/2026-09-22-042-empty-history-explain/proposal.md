# Proposal: 042-empty-history-explain

## Why

QA-находка: workspace с задачами без team_history даёт полностью пустой план молча — юзер не понимает почему (потому capacity=0).

## What Changes

- generate/plan объясняет причины: для задач команд без velocity-истории в explanations «истории скорости нет — capacity=0 …» (вместо молчаливого минимума)
- Warnings при generate расширяются: тип composition_change для команд без истории
- README: раздел limit «план пуст при отсутствии team_history»

## Capabilities

### Modified Capabilities

- `planning` — Reason plan demand объяснение «истории нет — capacity=0» явно, не молчанием

## Impact
`src/services/planner.py`, `src/api/routes.py`, README.
