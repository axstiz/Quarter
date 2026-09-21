"""AI-советник пересчёта (change 015): human-in-loop советы поверх готовых отчётов ядра.

Принципы спеки: агент не считает числа — только интерпретирует и ранжирует опции,
посчитанные ядром (planner, metrics, optimization-report, staffing-suggestions);
совет одноразовый (весь контекст прогона — один комментарий), никогда не сохраняется;
без ключа GigaChat — fallback на детерминированные подсказки из тех же отчётов.
"""
from __future__ import annotations

import json

from pydantic import BaseModel, Field

from src.ai.gigachat import GigaUnavailable, get_client
from src.domain.models import SPRINTS_PER_QUARTER

MAX_COMMENT = 500
_FACTS_CAP = 12_000


class AdviceItem(BaseModel):
    kind: str = Field(pattern="^(task_move|staffing_shift|initiative_rescue|sprint_priority)$")
    affected_task_ids: list[str] = []
    affected_engineers: list[str] = []
    message: str
    numeric_basis: str
    expected_effect: str


class AdviceReport(BaseModel):
    mode: str = "fallback"  # "llm" | "fallback"
    comment_considered: bool = False
    advice: list[AdviceItem] = []


# --- facts-JSON: компактная сводка состояния плана -------------------------

def facts_json(warnings: list[dict], metrics: dict, optimization_report: dict,
               staffing: list[dict], comment: str | None) -> dict:
    facts = {
        "sprints_total": SPRINTS_PER_QUARTER,
        "quarter": {
            "pct": metrics.get("quarter_completion_pct"),
            "is_forecast": metrics.get("quarter_completion_is_forecast"),
            "within_norm": metrics.get("quarter_within_norm"),
            "target_band": metrics.get("quarter_target_band"),
        },
        "sprint_pct": metrics.get("sprint_completion_pct"),
        "sprint_within_norm": metrics.get("sprint_within_norm"),
        "warnings": [
            {"kind": w.get("kind"), "message": (w.get("message") or "")[:200],
             "reference_category": w.get("reference_category"),
             "task_ids": (w.get("task_ids") or [])[:8]}
            for w in warnings[:12]
        ],
        "optimization": {
            "strategy_used": optimization_report.get("strategy_used"),
            "composition_diff": optimization_report.get("composition_diff"),
            "kpi": json.loads(json.dumps(
                optimization_report.get("kpi_summary") or {}, ensure_ascii=False))
            if isinstance(optimization_report.get("kpi_summary"), dict) else {},
        },
        "staffing_suggestions": (staffing or [])[:4],
    }
    if comment:
        facts["user_comment"] = comment.strip()[:MAX_COMMENT]
    return _drop_none(facts)


def _drop_none(obj):
    if isinstance(obj, dict):
        return {k: _drop_none(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_drop_none(v) for v in obj]
    return obj


# --- LLM-прогон -------------------------------------------------------------

_SYSTEM = (
    "Ты — советник руководителя по квартальному планированию команд разработки. "
    "Тебе дают компактную сводку состояния плана (факты спринтов, риски, KPI с нормами, "
    "оптимизационный отчёт и кадровые предложения). Числа и ограничения уже посчитаны ядром "
    "сервиса — НИКАКИХ новых вычислений не выполняй. Верни ТОЛЬКО JSON-массив советов, "
    "каждый совет: "
    '{"kind": "task_move|staffing_shift|initiative_rescue|sprint_priority", '
    '"affected_task_ids": [..], "affected_engineers": [..], '
    '"message": "что сделать по-человечески", '
    '"numeric_basis": "на каких числах основан", '
    '"expected_effect": "какой эффект на метрики"}. '
    "Не предлагай действия для закреплённых задач (они не входят в сводку переносов). "
    "Совет одноразовый: весь контекст — в указанном комментарии."
)

_USER_PREFIX = "Сводка состояния плана (JSON):\n"


def llm_advice(facts: dict, client) -> list[AdviceItem]:
    """Ответ LLM → pydantic-валидация; невалид → GigaUnavailable-путь (retry на стороне ручки)."""
    text = client.complete(
        _SYSTEM,
        _USER_PREFIX + json.dumps(facts, ensure_ascii=False),
        temperature=0.0,
    )
    data = _extract_json(text)
    items = [AdviceItem(**item) for item in data]
    return items


def _extract_json(text: str) -> list[dict]:
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end <= start:
        raise ValueError("в ответе LLM нет JSON-массива")
    return json.loads(text[start:end + 1])


# --- fallback: детерминированные советы из отчётов --------------------------

def fallback_advice(warnings: list[dict], optimization_report: dict,
                    staffing_suggestions: list[dict], metrics: dict,
                    comment: str | None) -> list[AdviceItem]:
    out: list[AdviceItem] = []

    for w in warnings:
        if w.get("kind") in ("deadline_overflow", "dependency_shift") and (w.get("task_ids") or []):
            out.append(AdviceItem(
                kind="task_move",
                affected_task_ids=(w.get("task_ids") or [])[:4],
                message=f"Риск [{w.get('kind')}]: {w.get('message', '')}",
                numeric_basis=f"затронуто задач: {len(w.get('task_ids') or [])}",
                expected_effect="уменьшение риска сдвига цепочки зависимостей",
            ))
            if len(out) >= 3:
                break

    comp = (optimization_report or {}).get("composition_diff") or {}
    added = (comp.get("added_tasks") or [])[:4]
    if added:
        out.append(AdviceItem(
            kind="initiative_rescue",
            affected_task_ids=added[:3],
            message="Кандидаты на спасение инициативы (добавлены метрической стратегией против priority-эталона)",
            numeric_basis=f"стратегия {optimization_report.get('strategy_used')}",
            expected_effect="закрытие инициативы в пределах квартала",
        ))

    kpi = (optimization_report or {}).get("kpi_summary") or {}
    if kpi:
        out.append(AdviceItem(
            kind="sprint_priority",
            affected_task_ids=[],
            message="Следующий спринт: приоритет — задачи заказчика и замыкание инициатив",
            numeric_basis=f"PI target {kpi.get('quarter_target_band')}, факт {kpi.get('quarter_completion_pct')}",
            expected_effect="удержание нормы PI 80–100 %",
        ))

    for s in (staffing_suggestions or [])[:2]:
        out.append(AdviceItem(
            kind="staffing_shift",
            affected_task_ids=[],
            affected_engineers=[s.get("engineer_id", "")],
            message=s.get("expected_impact", "перегруппировка носителя роли между командами"),
            numeric_basis=f"сдвиг {s.get('capacity_shift')} ставки; bus_factor_safe={s.get('bus_factor_safe')}",
            expected_effect="балансировка роли между командами",
        ))

    if comment:
        out.append(AdviceItem(
            kind="sprint_priority",
            affected_task_ids=[],
            message=f"Контекст пользователя учтён одним комментарием: «{comment.strip()[:200]}».",
            numeric_basis="одноразовый контекст, не сохраняется",
            expected_effect="обстоятельства отнесены к решениям человека",
        ))
    for a in out:
        a.affected_engineers = a.affected_engineers[:3]
    return out
