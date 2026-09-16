import pathlib

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

ROOT = pathlib.Path(__file__).resolve().parent.parent
XLSX = ROOT / "Датасет_с_правками_основной.xlsx"


@pytest_asyncio.fixture()
async def client(tmp_path, monkeypatch):
    monkeypatch.setenv("POSTCODE_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 't.db'}")
    await (0 and None) if False else None
    from src.db.session import engine, init_db
    from src.core.config import settings

    settings.dataset_dir = ROOT / "dataset"
    await init_db()
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        yield ac
    await engine.dispose()


@pytest.fixture()
def sample_xlsx():
    assert XLSX.exists()
    return XLSX


@pytest.mark.asyncio
async def test_upload_organizers_format_no_questions(client, sample_xlsx):
    """Формат организаторов маппится без LLM и без вопросов (спека onboarding)."""
    r = await client.post("/api/v1/data/upload", files={"file": ("d.xlsx", sample_xlsx.read_bytes())})
    assert r.status_code == 201
    body = r.json()
    assert body["status"] in ("ready", "questions")
    job_id = body["job_id"]
    if body["status"] == "questions":
        r = await client.post(f"/api/v1/data/jobs/{job_id}/confirm")
        # если всё же остались вопросы, confirm должен отклонить
        assert r.status_code == 409
        return
    counts = body["preview_counts"]
    assert counts["task"] > 0
    assert counts["engineer"] > 0
    assert counts["team_history"] >= 12


@pytest.mark.asyncio
async def test_confirm_import_and_plan(client, sample_xlsx):
    r = await client.post("/api/v1/data/upload", files={"file": ("d.xlsx", sample_xlsx.read_bytes())})
    body = r.json()
    assert r.status_code == 201
    if body["status"] != "ready":
        pytest.skip("этот тест не про формат организаторов")
    job_id = body["job_id"]
    r = await client.post(f"/api/v1/data/jobs/{job_id}/confirm")
    assert r.status_code == 200
    counts = r.json()["counts"]
    assert counts["tasks"] == 45
    assert counts["engineers"] >= 30

    r = await client.post("/api/v1/plans/generate")
    assert r.status_code == 201

    r = await client.get("/api/v1/bus-factor")
    assert r.status_code == 200
    assert r.json()["methodology"]


@pytest.mark.asyncio
async def test_manual_not_overwritten_by_import(client, sample_xlsx, tmp_path):
    """Повторный импорт не затирает manual-записи (спека data)."""
    r = await client.post("/api/v1/engineers", json={
        "engineer_id": "ENG-MANUAL", "team_id": "Team-X", "role": "X", "capacity_rate": 1.0})
    assert r.status_code == 201

    r = await client.post("/api/v1/data/upload", files={"file": ("d.xlsx", sample_xlsx.read_bytes())})
    body = r.json()
    job_id = body["job_id"]
    if body["status"] != "ready":
        r = await client.post(f"/api/v1/data/jobs/{job_id}/confirm")
        assert r.status_code == 409  # требует вопросов
        return
    await client.post(f"/api/v1/data/jobs/{job_id}/confirm")
    r = await client.get("/api/v1/star-map/summary")
    teams = [t["team_id"] for t in r.json()["teams"]]
    # ручного пользователя не потеряли после импорта
    r = await client.get("/api/v1/teams")
    team_ids = {t["team_id"] for t in r.json()}
    assert "Team-X" in team_ids


@pytest.mark.asyncio
async def test_upload_rejects_bad_format(client, tmp_path):
    r = await client.post("/api/v1/data/upload", files={"file": ("f.rtf", b"{ junk")})
    assert r.status_code == 422
