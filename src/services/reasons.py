from __future__ import annotations

"""Сопоставление типов предупреждений с причинами расхождения планов
из справочника reference_values (категория deviation_reason, change 011).
"""

KIND_TO_REASON: dict[str, str] = {
    "deadline_overflow": "Превышение плана",
    "dependency_shift": "Отсутствует готовность смежных команд",
    "role_deficit": "Отсутствие ресурсов",
    "grade_deficit": "Отсутствие ресурсов",
    "composition_change": "Изменились требования",
}


def deviation_reason_for(kind: str, categories: list[str]) -> str | None:
    """Категория из справочника для вида предупреждения; None — если нет."""
    reason = KIND_TO_REASON.get(kind)
    if reason and reason in categories:
        return reason
    return None


def attach_reason_categories(warnings: list[dict], categories: list[str]) -> list[dict]:
    """Дописывает к warning понятную формулировку причины из справочника (011 3.2)."""
    for w in warnings:
        reason = deviation_reason_for(w.get("kind", ""), categories)
        if reason:
            w["reference_category"] = reason
            w["message"] = f"{w.get('message', '')} · причина по справочнику: {reason}"
    return warnings
