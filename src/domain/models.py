from datetime import date
from enum import Enum

from pydantic import BaseModel, Field

SPRINTS_PER_QUARTER = 6
HOURS_PER_SPRINT_FULL = 80  # полная занятость (capacity_rate 1.0)
CAPACITY_FACTOR = 0.8       # коэффициент производительности из задания


class TaskStatus(str, Enum):
    done = "Done"
    in_progress = "InProgress"
    to_do = "ToDo"


class PlanDecision(str, Enum):
    planned = "planned"
    postponed = "postponed"
    cancelled = "cancelled"
    cancel_pending = "cancelled_pending"
    done_actual = "done_actual"


class Task(BaseModel):
    task_id: str
    parent_id: str | None = None
    team_id: str
    summary: str = ""
    status: str = "ToDo"
    priority: float = 100.0  # human seed/ручной приоритет (меньше — раньше)
    estimation_sp: float = 0.0
    estimated_hh: float = 0.0
    role_hours: dict[str, float] = {}  # роль -> требуемые часы
    spent_time: float = 0.0  # фактические потраченные часы (для InProgress-остатка)
    planned_start: date | None = None
    planned_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None


class Engineer(BaseModel):
    engineer_id: str
    team_id: str
    role: str
    grade: str = ""
    skills_declared: str = ""
    capacity_rate: float = 1.0

    @property
    def hours_per_sprint(self) -> float:
        rate = self.capacity_rate
        if rate <= 0.5:
            return 40.0 * rate / 0.5
        return HOURS_PER_SPRINT_FULL * min(rate, 1.0)


class TeamHistory(BaseModel):
    team_id: str
    snapshot_date: str
    velocity_achieved: float
    planned_sp: float


class Explanation(BaseModel):
    task_id: str
    decision: PlanDecision
    sprint_no: int | None = None
    reason: str = ""


class PlanItem(Explanation):
    step_points_sp: float | None = None  # запланированные SP в спринте


class SprintPlan(BaseModel):
    sprint_no: int
    items: list[PlanItem] = []


class Plan(BaseModel):
    plan_id: str
    team_id: str | None = None
    sprints: list[SprintPlan] = []
    decisions: list[Explanation] = []


class Warning(BaseModel):
    kind: str  # deadline_overflow | dependency_shift | role_deficit | composition_change
    message: str
    task_ids: list[str] = []


class MetricsReport(BaseModel):
    quarter_completion_pct: float | None
    quarter_completion_is_forecast: bool
    sprint_completion_pct: dict[int, float | None]
    sprint_completion_is_forecast: dict[int, bool]


class BusFactorItem(BaseModel):
    scope_type: str  # company | team
    scope_id: str
    key: str  # компетенция/роль
    holders: list[str]
    factor: int  # bus factor = min число носителей, т.е. len(holders)


class BusFactorReport(BaseModel):
    items: list[BusFactorItem]
    methodology: str
