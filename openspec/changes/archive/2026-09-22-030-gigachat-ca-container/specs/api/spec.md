# Update capability: api

## MODIFIED Requirements

### Requirement: AI-слой

AI-пайплайны SHALL жить в src/ai (LangGraph-графы, клиент провайдера, JSON-схемы); вызовы LLM всегда через pydantic-валидацию; клиент GigaChat конфигурируется env-ом, отсутствие ключа ≤ слой деградации (шаблонные маппинги). Ошибка инициализации SDK (недоступный/неверный CA-бандл и т.п.) SHALL превращаться в деградацию fallback (advice 200, mode=fallback), а не 500.

#### Scenario: Новая AI-фича

- **WHEN** добавляется AI-советник (change 003+)
- **THEN** он реализуется новым графом в src/ai/pipelines с общей обёрткой провайдера

#### Scenario: CA-бандл недоступен

- **GIVEN** GIGACHAT_CA_BUNDLE указывает на файл, которого нет в контейнере
- **WHEN** GET /plans/{id}/advice
- **THEN** 200, mode=fallback (советы детерминированные), не 500

#### Scenario: LLM-режим при валидном бандле

- **GIVEN** CA-бандл смонтирован и валиден
- **WHEN** GET /plans/{id}/advice
- **THEN** mode=llm при живом ключе GigaChat
