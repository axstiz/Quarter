import pytest
from httpx import ASGITransport, AsyncClient

from src.api.permissions import check_permission
from src.main import app


@pytest.mark.asyncio
async def test_permission_matrix_and_overrides():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Get matrix
        resp = await client.get("/permissions/matrix")
        assert resp.status_code == 200
        matrix = resp.json()["matrix"]
        assert matrix["plans_generate"]["editor"] is True
        assert matrix["confirm_cancel"]["editor"] is False
        assert matrix["confirm_cancel"]["admin"] is True

        # 2. Grant confirm_cancel to editor
        patch_resp = await client.patch(
            "/permissions/roles/editor",
            json={"permission": "confirm_cancel", "enabled": True},
            headers={"X-User-Id": "admin_1"},
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["enabled"] is True

        # 3. Verify updated matrix
        m_updated = (await client.get("/permissions/matrix")).json()["matrix"]
        assert m_updated["confirm_cancel"]["editor"] is True

        # 4. Check audit logs
        audit_resp = await client.get("/permissions/audit")
        assert audit_resp.status_code == 200
        logs = audit_resp.json()
        assert len(logs) >= 1
        assert logs[0]["action"] == "update_permission"
        assert logs[0]["actor_id"] == "admin_1"


@pytest.mark.asyncio
async def test_admin_cannot_be_disabled():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.patch(
            "/permissions/roles/admin",
            json={"permission": "import_data", "enabled": False},
        )
        assert resp.status_code == 400
