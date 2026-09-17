import pytest
from httpx import ASGITransport, AsyncClient

from src.ai.pipelines.normalization import UploadJob
from src.main import app


@pytest.mark.asyncio
async def test_job_db_persistence():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
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
