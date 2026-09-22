import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


def _app():
    from src.main import app
    return app


async def test_permission_matrix_and_overrides(auths):
    admin, editor = auths["admin"], auths["editor"]

    # — создаём свежий workspace с демо-участниками трёх ролей
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test", headers=admin) as ac:
        r = await ac.post("/workspaces", json={"name": "perms-matrix"})
        ws = r.json()["id"]
        for role in ("editor", "reader"):
            demo = await ac.post("/auth/demo-login", json={"role": role})
            uid = demo.json()["user"]["id"]
            m = await ac.post(f"/workspaces/{ws}/members", json={"user_id": uid, "role": role})
            assert m.status_code == 201, m.text

    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test",
                           headers={**admin, "X-Workspace-Id": ws}) as client:
        # 1. Матрица по умолчанию
        resp = await client.get("/permissions/matrix")
        assert resp.status_code == 200
        matrix = resp.json()["matrix"]
        assert matrix["plans_generate"]["editor"] is True
        assert matrix["confirm_cancel"]["editor"] is False
        assert matrix["confirm_cancel"]["admin"] is True

        # 2. Даём editor право confirm_cancel (admin-only действие)
        patch_resp = await client.patch(
            "/permissions/roles/editor",
            json={"permission": "confirm_cancel", "enabled": True},
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["enabled"] is True

        # 3. Матрица обновлена
        m_updated = (await client.get("/permissions/matrix")).json()["matrix"]
        assert m_updated["confirm_cancel"]["editor"] is True

        # 4. Журнал виден админу
        audit_resp = await client.get("/permissions/audit")
        assert audit_resp.status_code == 200
        logs = audit_resp.json()
        assert len(logs) >= 1
        assert logs[0]["action"] == "update_permission"
        assert logs[0]["actor_id"]

    # 5. Роль из membership, а не из заголовка: editor не участник другого workspace → 403
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test", headers=admin) as ac2:
        r2 = await ac2.post("/workspaces", json={"name": "perms-other"})
        other_ws = r2.json()["id"]
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as ec:
        r = await ec.get("/permissions/matrix", headers={**editor, "X-Workspace-Id": other_ws})
    assert r.status_code == 403


async def test_admin_cannot_be_disabled(auths):
    admin = auths["admin"]
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test", headers=admin) as ac:
        r = await ac.post("/workspaces", json={"name": "perms-admin"})
        ws = r.json()["id"]
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test",
                           headers={**admin, "X-Workspace-Id": ws}) as client:
        resp = await client.patch(
            "/permissions/roles/admin",
            json={"permission": "import_data", "enabled": False},
        )
        assert resp.status_code == 400
