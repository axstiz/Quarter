import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.mark.asyncio
async def test_workspace_crud_and_isolation():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Get workspaces list
        ws_resp = await client.get("/workspaces")
        assert ws_resp.status_code == 200
        assert len(ws_resp.json()) >= 1

        # 2. Create new workspace B
        create_resp = await client.post("/workspaces", json={"name": "Workspace B"})
        assert create_resp.status_code == 201
        ws_b_id = create_resp.json()["id"]

        # 3. Import dataset into default workspace
        import_default = await client.post("/api/v1/data/import", headers={"X-Workspace-Id": "default"})
        assert import_default.status_code == 200
        default_count = import_default.json()["counts"]["tasks"]
        assert default_count > 0

        # 4. Workspace B initially has 0 tasks
        ws_b_tasks = await client.get("/api/v1/tasks", headers={"X-Workspace-Id": ws_b_id})
        assert ws_b_tasks.status_code == 200
        assert len(ws_b_tasks.json()) == 0

        # 5. Members management
        add_mem = await client.post(f"/workspaces/{ws_b_id}/members", json={"user_id": "user_123", "role": "editor"})
        assert add_mem.status_code == 201
        assert add_mem.json()["user_id"] == "user_123"

        members = await client.get(f"/workspaces/{ws_b_id}/members")
        assert members.status_code == 200
        assert any(m["user_id"] == "user_123" for m in members.json())
