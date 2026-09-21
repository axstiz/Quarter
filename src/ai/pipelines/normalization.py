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

from src.ai.llm import LLMUnavailable, complete_async, get_client
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
    """LLM-сопоставление колонок; None = недоступно/невалидно. Sync-путь (change 007)."""
    ans = _mapping_attempt(_llm_mapping_call, headers)
    return ans


async def llm_mapping_async(headers: list[str]) -> LLMMappingAnswer | None:
    """То же с лимитом конкурентности и вне event loop (change 028)."""
    ans = await _mapping_attempt(_llm_mapping_call_async, headers)
    return ans


def _mapping_attempt(call, headers):
    """Retry 2: вызов провайдера (sync или async) → parse; повтор при невалидном JSON."""
    for _ in range(2):
        raw = call(headers)
        if raw is None:
            return None
        ans = _parse_mapping(raw)
        if ans is not None:
            return ans
    return None


def _llm_mapping_call(headers: list[str]) -> str | None:
    """Прогон LLM; None = недоступно."""
    try:
        client = get_client()
    except Exception:
        return None

    try:
        user = "Колонки:\n" + "\n".join(f"- {h}" for h in headers)
        try:
            return client.complete(SYSTEM_PROMPT, user)
        except LLMUnavailable:
            return None
    except Exception:
        return None


async def _llm_mapping_call_async(headers: list[str]) -> str | None:
    try:
        client = get_client()
    except Exception:
        return None

    try:
        user = "Колонки:\n" + "\n".join(f"- {h}" for h in headers)
        try:
            return await complete_async(client, SYSTEM_PROMPT, user)
        except LLMUnavailable:
            return None
    except Exception:
        return None


def _parse_mapping(raw: str) -> LLMMappingAnswer | None:
    try:
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
            return None
    except Exception:
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
    """Persistent job with in-memory caching. Ответы/превью хранятся в БД и памяти."""

    JOBS: dict[str, "UploadJob"] = {}

    def __init__(self, job_id: str, filename: str, path: Path):
        self.job_id = job_id
        self.filename = filename
        self.workspace_id = "default"
        self.path = path
        self.status: UploadStatus = "uploaded"
        self.tables: list[list[dict[str, str]]] = []
        self.rows_by_entity: dict[str, list[dict]] = {}
        self.unmapped_columns: list[str] = []
        self.column_guesses: list[dict] = []
        self.questions: list[Question] = []
        self.preview: dict[str, int] = {}
        self.answers: dict[str, str] = {}

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

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "filename": self.filename,
            "file_path": str(self.path),
            "status": self.status,
            "tables": self.tables,
            "rows_by_entity": self.rows_by_entity,
            "unmapped_columns": self.unmapped_columns,
            "column_guesses": self.column_guesses,
            "questions": [q.model_dump() for q in self.questions],
            "answers": self.answers,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "UploadJob":
        job = cls(data["job_id"], data["filename"], Path(data.get("file_path", "")))
        job.status = data.get("status", "uploaded")
        job.tables = data.get("tables") or []
        job.rows_by_entity = data.get("rows_by_entity") or {}
        job.unmapped_columns = data.get("unmapped_columns") or []
        job.column_guesses = data.get("column_guesses") or []
        q_raw = data.get("questions") or []
        job.questions = [Question.model_validate(q) if isinstance(q, dict) else q for q in q_raw]
        job.answers = data.get("answers") or {}
        job.preview = {k: len(v) for k, v in job.rows_by_entity.items()}
        return job


async def save_job_db(session, job: UploadJob) -> None:
    from src.db.models import UploadJobORM

    UploadJob.JOBS[job.job_id] = job
    d = job.to_dict()
    orm = await session.get(UploadJobORM, job.job_id)
    if not orm:
        orm = UploadJobORM(job_id=job.job_id)
        session.add(orm)
    orm.filename = d["filename"]
    orm.file_path = d["file_path"]
    orm.status = d["status"]
    orm.tables = d["tables"]
    orm.rows_by_entity = d["rows_by_entity"]
    orm.unmapped_columns = d["unmapped_columns"]
    orm.column_guesses = d["column_guesses"]
    orm.questions = d["questions"]
    orm.answers = d["answers"]
    orm.workspace_id = getattr(job, "workspace_id", "default")
    await session.commit()


async def get_job_db(session, job_id: str) -> UploadJob | None:
    if job_id in UploadJob.JOBS:
        return UploadJob.JOBS[job_id]

    from src.db.models import UploadJobORM
    orm = await session.get(UploadJobORM, job_id)
    if not orm:
        return None

    data = {
        "job_id": orm.job_id,
        "filename": orm.filename,
        "file_path": orm.file_path,
        "status": orm.status,
        "tables": orm.tables,
        "rows_by_entity": orm.rows_by_entity,
        "unmapped_columns": orm.unmapped_columns,
        "column_guesses": orm.column_guesses,
        "questions": orm.questions,
        "answers": orm.answers,
    }
    job = UploadJob.from_dict(data)
    job.workspace_id = orm.workspace_id or "default"
    UploadJob.JOBS[job.job_id] = job
    return job



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


async def node_llm_map(state: JobState) -> JobState:
    headers = list((state.get("tables") or [[{}]])[0][0])
    ans = await llm_mapping_async(headers)
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


async def run_stage_async(job: UploadJob, answers: dict[str, str] | None = None) -> UploadJob:
    """Тот же пайплайн через ainvoke (change 028): LLM-узел с лимитом
    конкурентности выполняется в воркере-треде, event loop не блокируется."""
    UploadJob.JOBS[job.job_id] = job
    res = await GRAPH.ainvoke({
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
