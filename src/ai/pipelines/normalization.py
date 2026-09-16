"""Пайплайн нормализации: LangGraph-машина состояний.

    parse_file → template_map → decide → (llm_map | manual_questions) → finalize

LLM-ответы всегда валидируются pydantic-схемами; без ключа GigaChat —
деградация в шаблонный режим + ручные вопросы (см. capability onboarding).
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Literal, TypedDict

from langgraph.graph import StateGraph

from src.ai.gigachat import GigaUnavailable, get_client
from src.ai.ingest import readers
from src.ai.ingest.mapping import map_row, template_map_column
from src.ai.schemas import LLMMappingAnswer, Question

UploadStatus = Literal["uploaded", "mapping", "questions", "ready", "confirmed", "failed"]

THE_FIELD_WHITELIST = [
    "task_id", "parent_id", "summary", "team_id", "status", "estimation_sp", "estimated_hh",
    "spent_time", "planned_start", "planned_end", "actual_start", "actual_end",
    "engineer_id", "role", "grade", "skills_declared", "capacity_rate",
    "blocking_task_id", "blocked_task_id", "dependency_type",
    "snapshot_date", "velocity_achieved", "planned_sp", "hours",
]

SYSTEM_PROMPT = (
    "Ты ассистент выгрузок трекеров задач. Для каждой колонки определи entity "
    "(task|engineer|team_history|dependency|role_requirement|team) или null, и поле field среди: "
    + ", ".join(THE_FIELD_WHITELIST)
    + " или null. Верни строго JSON: "
    '{"mappings":[{"column":"...","entity":"...","field":"...","confidence":"high|low"}]}'
)


def llm_mapping(headers: list[str]) -> LLMMappingAnswer | None:
    """LLM-сопоставление колонок; None = недоступно/невалидно."""
    try:
        client = get_client()
        client_token_check = client
    except Exception:
        return None
    from src.ai.gigachat import GigaChatClient

    try:
        raw = None
        user = "Колонки:\n" + "\n".join(f"- {h}" for h in headers)
        for _ in range(2):
            try:
                raw = client.complete(SYSTEM_PROMPT, user)
            except GigaUnavailable:
                return None
            text = raw.strip()
            if text.startswith("```"):
                text = text.strip("`")
                lines = text.splitlines()
                if lines and "{" not in lines[0]:
                    text = "\n".join(lines[1:])
            try:
                data = json.loads(text)
                return LLMMappingAnswer.model_validate(data)
            except Exception:
                continue
    except Exception:
        return None
    return None


def _questions_from_unmapped(unmapped: list[str]) -> list[Question]:
    return [
        Question(
            question=f"Как сопоставить колонку '{c}'? Ответ 'entity.field' (например task.estimation_sp) или 'пропустить'",
            options=["пропустить"],
            context_column=c,
        )
        for c in unmapped
    ]


class JobState(TypedDict, total=False):
    job_id: str
    filename: str
    status: UploadStatus
    tables: list[list[dict[str, str]]]
    rows_by_entity: dict[str, list[dict]]
    unmapped: list[str]
    questions: list[Question]
    column_guesses: list[dict]
    answers: dict[str, str]


class UploadJob:
    """In-memory job. Ответы/превью хранятся вместе с job."""

    JOBS: dict[str, "UploadJob"] = {}

    def __init__(self, job_id: str, filename: str, path: Path):
        self.job_id = job_id
        self.filename = filename
        self.path = path
        self.status: UploadStatus = "uploaded"
        self.tables: list[list[dict[str, str]]] = []
        self.rows_by_entity: dict[str, list[dict]] = {}
        self.unmapped_columns: list[str] = []
        self.column_guesses: list[dict] = []
        self.questions: list[Question] = []
        self.preview: dict[str, int] = {}

    def snapshot(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "filename": self.filename,
            "status": self.status,
            "column_guesses": self.column_guesses,
            "questions": [q.model_dump() for q in self.questions],
            "unmapped": self.unmapped_columns,
            "preview_counts": {k: len(v) for k, v in self.rows_by_entity.items()},
        }


# --- LangGraph-узлы ---------------------------------------------------------

def node_parse(state: JobState) -> JobState:
    job = UploadJob.JOBS[state["job_id"]]
    state["tables"] = readers.read_any(job.path)
    state["status"] = "mapping"
    return state


def node_apply_answers(state: JobState) -> JobState:
    ans = state.get("answers") or {}
    for col, answer in ans_items(ans):
        if answer and answer.lower() != "пропустить" and "." in answer:
            entity, _, field = answer.partition(".")
            if entity and field:
                from src.ai.ingest.mapping import SYNONYMS_NORM

                SYNONYMS_NORM.setdefault(field, set()).add(col)
    state["answers"] = {}
    return state


def ans_items(d: dict[str, str]):
    return list(d.items()) if isinstance(d, dict) else []


def node_template_map(state: JobState) -> JobState:
    rows_by_entity: dict[str, list[dict]] = {}
    unmapped: set[str] = set()
    guesses: list[dict] = []
    headers: list[str] = []
    tables = state.get("tables") or []
    if tables:
        headers = list(tables[0][0])
    for table in tables:
        for row in table:
            parsed, un = map_row(row)
            for entity, fields in parsed.items():
                rows_by_entity.setdefault(entity, []).append(fields)
            unmapped.update(u for u in un if u)
    for h in headers:
        res = template_map_column(h)
        if res:
            guesses.append({"column": h, "entity": res[0], "field": res[1], "confidence": "high"})
    state["rows_by_entity"] = rows_by_entity
    state["unmapped"] = sorted(unmapped)
    state["column_guesses"] = guesses
    return state


def node_decide(state: JobState) -> JobState:
    if state.get("unmapped"):
        state["status"] = "questions"
    else:
        state["status"] = "ready"
    return state


def node_llm_map(state: JobState) -> JobState:
    headers = list((state.get("tables") or [[{}]])[0][0])
    ans = llm_mapping(headers)
    if not ans:
        return state  # деградация: вопросы останутся на человеке
    extra = []
    for g in ans.mappings:
        if g.entity is not None and g.field:
            state["column_guesses"] = state.get("column_guesses", []) + [g.model_dump()]
    return state


def node_build_questions(state: JobState) -> JobState:
    from src.ai.ingest.mapping import SYNONYMS_NORM

    mapped_via_llm = {
        g["column"] for g in state.get("column_guesses", [])
        if g.get("entity") is not None and g.get("field")
    }
    still = [c for c in state.get("unmapped", []) if c not in mapped_via_llm]
    state["questions"] = _questions_from_unmapped(still)
    state["status"] = "questions" if still else "ready"
    return state


def build_graph():
    g = StateGraph(JobState)
    g.add_node("parse", node_parse)
    g.add_node("apply_answers", node_apply_answers)
    g.add_node("template_map", node_template_map)
    g.add_node("decide", node_decide)
    g.add_node("llm_map", node_llm_map)
    g.add_node("build_questions", node_build_questions)

    g.set_entry_point("parse")
    g.add_edge("parse", "template_map")
    g.add_edge("template_map", "decide")
    g.add_conditional_edges("decide", lambda s: "llm" if s["status"] == "questions" else "done", {
        "llm": "llm_map", "done": "build_questions",
    })
    g.add_edge("llm_map", "build_questions")
    return g.compile()


GRAPH = build_graph()


def run_stage(job: UploadJob, answers: dict[str, str] | None = None) -> UploadJob:
    """Прогон пайплайна по job (parse → map → вопросы)."""
    UploadJob.JOBS[job.job_id] = job
    res = GRAPH.invoke({
        "job_id": job.job_id,
        "filename": job.filename,
        "status": job.status,
        "answers": answers or {},
    })
    job.status = res.get("status", "failed")  # type: ignore[assignment]
    job.rows_by_entity = res.get("rows_by_entity", {})
    job.unmapped_columns = res.get("unmapped", [])
    job.column_guesses = res.get("column_guesses", [])
    job.questions = res.get("questions", [])
    job.preview = {k: len(v) for k, v in job.rows_by_entity.items()}
    return job


def new_job(filename: str, path: Path, job_id: str | None = None) -> UploadJob:
    job = UploadJob(job_id or uuid.uuid4().hex, filename, path)
    job = run_stage(job)
    return job
