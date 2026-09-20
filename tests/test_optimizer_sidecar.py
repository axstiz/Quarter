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


def compose(*args, check=True):
    return subprocess.run(
        [*COMPOSE, *args], capture_output=True, text=True, check=check, timeout=600
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
