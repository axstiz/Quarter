"""LLM-схемы (pydantic) для пайплайна normalisation. Ответ LLM всегда валидируется."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

EntityKind = Literal["task", "engineer", "team_history", "dependency", "role_requirement", "team"]


class ColumnGuess(BaseModel):
    column: str
    entity: EntityKind | None = None
    field: str | None = None
    confidence: Literal["high", "low"] = "high"


class LLMMappingAnswer(BaseModel):
    mappings: list[ColumnGuess] = []
    notes: str = ""


class Question(BaseModel):
    question: str
    options: list[str] = []
    answer: str | None = None
    context_column: str = ""
