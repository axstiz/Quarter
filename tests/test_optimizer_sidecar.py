"""change 018, задача 1.1: сайдкар-сервис optimizer (Java + Timefold) в docker-compose профиле optimizer.

Проверки по spec architecture «Сайдкар-сервис optimizer»: сервис в профиле optimizer,
HTTP на внутреннем порту (без публикации на хост), health-эндпоинт отвечает после up.
"""

import json
import shutil
import subprocess
import time

import pytest

COMPOSE = ["docker", "compose", "--profile", "optimizer"]


def compose(*args, check=True, input=None):
    return subprocess.run(
        [*COMPOSE, *args], capture_output=True, text=True, check=check, timeout=600,
        input=input,
    )


def docker_available():
    if not shutil.which("docker"):
        return False
    return subprocess.run(["docker", "info"], capture_output=True, timeout=30).returncode == 0


def test_optimizer_service_in_profile():
    """Сервис optimizer объявлен в профиле optimizer, порт только внутренний."""
    cfg = compose("config", "--format", "json")
    services = json.loads(cfg.stdout)["services"]
    assert "optimizer" in services, "нет сервиса optimizer в профиле optimizer"
    svc = services["optimizer"]
    assert "optimizer" in svc.get("profiles", [])
    assert not svc.get("ports"), "порт solver не публикуется на хост (внутренний порт)"
    assert svc.get("build"), "сервис собирается из Dockerfile (optimizer/)"


@pytest.mark.solver
@pytest.mark.skipif(not docker_available(), reason="docker daemon недоступен")
def test_optimizer_health_after_up():
    """docker compose --profile optimizer up поднимает сервис, /health отвечает 200."""
    try:
        compose("up", "-d", "--build", "--wait", "optimizer")
        out = compose(
            "exec", "-T", "optimizer",
            "curl", "-sf", "-o", "/dev/null", "-w", "%{http_code}",
            "http://localhost:8080/health",
        )
        assert out.stdout.strip() == "200"
    finally:
        compose("stop", "optimizer", check=False)
        compose("rm", "-f", "optimizer", check=False)


OPTIMIZER_SNAPSHOT = {
    "sprints": [1, 2, 3, 4, 5, 6],
    "team_velocities": [{"team_id": "Team-A", "velocity": 100}],
    "tasks": [
        {
            "task_id": "T-1", "parent_id": "INI-1", "status": "InProgress", "team_id": "Team-A",
            "story_points": 13, "estimated_hh": 50, "spent_time": 0, "priority": 1, "planned_in_sprint": True,
            "parts": [{"part": 1, "story_points": 13, "role_hours": {"Dev": 50.0}}],
        },
        {
            "task_id": "T-2", "parent_id": "INI-1", "status": "InProgress", "team_id": "Team-A",
            "story_points": 5, "estimated_hh": 20, "spent_time": 0, "priority": 1, "planned_in_sprint": False,
            "parts": [{"part": 1, "story_points": 5, "role_hours": {"Dev": 20.0}}],
        },
    ],
    "dependencies": [{"blocking_task_id": "T-1", "blocked_task_id": "T-2"}],
    "engineers": [
        {"engineer_id": "ENG-1", "team_id": "Team-A", "role": "Dev", "capacity_rate": 1.0,
         "sole_holder_in_team": False},
    ],
}


def _solver_post(body: str, capture_code: bool = False):
    args = ["exec", "-T", "optimizer", "curl", "-s", "-X", "POST",
            "-H", "Content-Type: application/json", "--data-binary", "@-",
            "http://localhost:8080/solve"]
    if capture_code:
        args[5:5] = ["-o", "/dev/null", "-w", "%{http_code}"]
    return compose(*args, input=body)


@pytest.mark.solver
@pytest.mark.skipif(not docker_available(), reason="docker daemon недоступен")
def test_solve_two_runs_same_seed_identical_draft():
    """change 018, задача 1.4: два запуска POST /solve с одним seed дают идентичный черновик."""
    try:
        compose("up", "-d", "--build", "--wait", "optimizer")
        body = json.dumps(OPTIMIZER_SNAPSHOT)
        first = json.loads(_solver_post(body).stdout)
        second = json.loads(_solver_post(body).stdout)
        assert "assignments" in first and "score" in first
        assert "score_breakdown" in first, "нет разбивки score по ограничениям"
        for key in ("assignments", "staffing_moves", "score", "score_breakdown"):
            assert first[key] == second[key], f"черновик не детерминирован: различается {key}"
    finally:
        compose("stop", "optimizer", check=False)
        compose("rm", "-f", "optimizer", check=False)


@pytest.mark.solver
@pytest.mark.skipif(not docker_available(), reason="docker daemon недоступен")
def test_solve_rejects_malformed_snapshot_with_400():
    """change 018, задача 1.4: невалидный снапшот отклоняется с 400."""
    try:
        compose("up", "-d", "--build", "--wait", "optimizer")
        out = _solver_post("not a json", capture_code=True)
        assert out.stdout.strip() == "400"
    finally:
        compose("stop", "optimizer", check=False)
        compose("rm", "-f", "optimizer", check=False)
