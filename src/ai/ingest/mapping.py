"""Шаблонные (детерминированные) маппинги колонок на сущности сервиса.

Формат организаторов и типовой Jira-экспорт покрываются синонимами (lowercase).
Поле field — целевая колонка domain-моделей.
"""
from __future__ import annotations

import re
from collections import OrderedDict

TASK_STATUS = {"todo", "inprogress", "done"}

SYNONYMS: dict[str, list[str]] = {
    # task
    "task_id": ["task_id", "key", "issue key", "issue", "задача", "ключ", "номер задачи", "task"],
    "parent_id": ["parent_id", "parent", "epic", "эпик", "инициатива", "номер инициативы", "parent link"],
    "summary": ["summary", "title", "subject", "название", "наименование", "описание задачи"],
    "team_id": ["team_id", "team", "команда", "team name"],
    "status": ["status", "статус", "состояние"],
    "estimation_sp": ["estimation_sp", "story points", "story point", "sp", "сп", "оценка sp", "points"],
    "estimated_hh": ["estimated_hh", "estimated hh", "estimate hours", "трудозатраты", "оценка часов", "часы"],
    "spent_time": ["spent_time", "spent", "затрачено", "затраченное время"],
    "rank": ["rung", "rank", "ранг", "приоритет"],
    "planned_in_sprint": ["planned_in_sprint", "будет включено в спринт", "в спринт"],
    "created_at": ["created_at", "created", "создан"],
    "planned_start": ["planned_start", "план старт", "планируемое начало"],
    "planned_end": ["planned_end", "план финиш", "планируемое окончание"],
    "actual_start": ["actual_start", "факт старт"],
    "actual_end": ["actual_end", "факт финиш"],
    # engineer
    "engineer_id": ["engineer_id", "engineer", "инженер", "id инженера", "сотрудник"],
    "grade": ["grade", "грейд", "уровень"],
    "skills_declared": ["skills_declared", "skills", "навыки", "компетенции"],
    "capacity_rate": ["capacity_rate", "ставка", "занятость"],
    "role": ["role", "роль"],
    # dependency
    # task result fields (organizer extras)
    "planned_result": ["planned_result", "плановый результат"],
    "customer_result": ["customer_result", "заказчик"],
    "performer_result": ["performer_result", "исполнитель"],
    "final_result": ["final_result", "итоговый результат"],
    "results_note": ["results_note", "результаты работ при закрытии задачи"],
    # dependency
    "blocking_task_id": ["blocking_task_id", "blocking", "blocker", "блокирует"],
    "blocked_task_id": ["blocked_task_id", "blocked", "зависит от"],
    "dependency_type": ["dependency_type", "тип зависимости"],
    # team history
    "snapshot_date": ["snapshot_date", "дата", "date"],
    "velocity_achieved": ["velocity_achieved", "velocity", "фактическая скорость", "выполнено sp"],
    "planned_sp": ["planned_sp", "планируемый sp", "запланировано sp"],
    "hours": ["hours", "часы"],
}

def _norm(s: str) -> str:
    return re.sub(r"[\s._@/()]+", " ", str(s).strip().lower()).strip()


SYNONYMS_NORM = {k: {_norm(s) for s in syns} for k, syns in SYNONYMS.items()}


TASK_ID_RE = re.compile(r"^[A-Z]{2,6}[-_ ]?[0-9]{2,5}$")


def template_map_column(header: str) -> tuple[str, str] | None:
    """Вернёт (entity, field) по синонимам или None."""
    h = _norm(header)
    if not h:
        return None
    if TASK_ID_RE.match(header.strip()):
        return "role_requirement", header
    for field, variants in SYNONYMS_NORM.items():
        if h in variants:
            return detect(field), field
    # частичные совпадения
    for field, variants in SYNONYMS_NORM.items():
        for v in variants:
            if v and v in h:
                return detect(field), field
    return None


def detect(field: str) -> str:
    prefix = {
        "engineer_id": "engineer", "grade": "engineer", "skills_declared": "engineer",
        "capacity_rate": "engineer", "role": "engineer",
        "blocking_task_id": "dependency", "blocked_task_id": "dependency", "dependency_type": "dependency",
        "snapshot_date": "team_history", "velocity_achieved": "team_history", "planned_sp": "team_history",
        "hours": "role_requirement",
    }
    return prefix.get(field, "task")


def map_row(row: dict[str, str]) -> tuple[dict[str, dict[str, str]], list[str]]:
    """Разобрать строку: {entity: {field: value}}; вернёт также нераспознанные колонки."""
    mapped: dict[str, dict[str, str]] = {}
    unmapped: list[str] = []
    role_name = ""
    # матрица «роль × задача»?: есть колонка 'Роль' и task-id колонки
    role_header = next((h for h in row if _norm(h) in ("роль", "role")), None)
    role_name = row.get(role_header, "") if role_header else ""

    for header, value in row.items():
        res = template_map_column(header)
        if not res:
            unmapped.append(header)
            continue
        entity, field = res
        if entity == "role_requirement" and role_name:
            # транспонированная матрица: имя колонки — task_id, значение — часы
            mapped.setdefault("role_requirement", {}).setdefault("rows", {})
            mapped["role_requirement"].setdefault("rows", {})[field] = value
            continue
        mapped.setdefault(entity, {})[field] = value
    if role_name and "role_requirement" in mapped and isinstance(mapped["role_requirement"].get("rows"), dict):
        mapped["role_requirement"]["role"] = role_name
    # team_id: если в строке есть team_history/dependency поля — тузов не туда, не task
    if "team_history" in mapped and "team_id" in mapped.get("task", {}):
        mapped["team_history"]["team_id"] = mapped["task"].pop("team_id")
    # engineer-линии: team_id принадлежит инженеру
    if "engineer" in mapped and "team_id" in mapped.get("task", {}):
        mapped["engineer"]["team_id"] = mapped["task"].pop("team_id")
    if "dependency" in mapped and "team_id" in mapped.get("task", {}):
        mapped["task"]["team_id"]
        mapped["task"].pop("team_id", None)
    # роли-часы: колонки вида 'разработчик java' в тайм-таблице
    for header, value in row.items():
        h = _norm(header)
        known = any(h in variants for variants in SYNONYMS_NORM.values())
        if known or not h:
            continue
        if role_header is None and (
            h.startswith("аналитик") or h.startswith("разработчик") or h.startswith("тестировщик")
            or h.startswith("архитектор") or h.startswith("девопс") or h.startswith("дизайнер")
            or h.startswith("руководитель") or h.startswith("специалист")
        ):
            if value not in ("", "0"):
                mapped.setdefault("role_requirement", {}).setdefault("role_hours", {})[header] = value
    return mapped, unmapped
