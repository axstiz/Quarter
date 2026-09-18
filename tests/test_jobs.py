import pytest
from httpx import ASGITransport, AsyncClient

from src.ai.pipelines.normalization import UploadJob
from src.main import app


@pytest.mark.asyncio
async def test_job_db_persistence(auth):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=auth) as client:
        # Upload file
        resp = await client.post(
            "/api/v1/data/upload",
            files={"file": ("test.csv", b"task_id,summary\nT-1,Test Task\n", "text/csv")},
        )
        assert resp.status_code == 201
        data = resp.json()
        job_id = data["job_id"]

        # Clear in-memory cache to simulate server restart or worker process boundary
        UploadJob.JOBS.clear()

        # Query job status from DB
        status_resp = await client.get(f"/api/v1/data/jobs/{job_id}")
        assert status_resp.status_code == 200
        assert status_resp.json()["job_id"] == job_id


@pytest.mark.asyncio
async def test_job_degradation_without_redis(auth, monkeypatch):
    """Деградация change 007/3.1: нет Redis — upload обрабатывается в процессе API."""
    from src.core.config import settings
    monkeypatch.setattr(settings, "jobs_mode", "sync")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=auth) as client:
        resp = await client.post(
            "/api/v1/data/upload",
            files={"file": ("t.csv", b"task_id,summary\nT-9,Another\n", "text/csv")},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] in ("ready", "questions")  # пайплайн в процессе, не hangs в uploaded


@pytest.mark.asyncio
async def test_job_persistence_after_simulation(auth):
    """Персистентность: рестарт (очистка памяти) → состояние из БД; воркерат видят."""
    from src.ai.pipelines.normalization import get_job_db
    import src.db.session as session_mod

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=auth) as client:
        resp = await client.post(
            "/api/v1/data/upload",
            files={"file": ("p.csv", b"task_id,summary\nT-10,Third\n", "text/csv")},
        )
        job_id = resp.json()["job_id"]

        # второй "воркер": чистая сессия, без памяти процесса
        session_mod.SessionLocal.kw = {}
        async with session_mod.SessionLocal() as s:
            job = await get_job_db(s, job_id)
            assert job is not None
            assert job.status in ("uploaded", "mapping", "questions", "ready")
