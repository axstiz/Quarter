import pytest
from httpx import ASGITransport, AsyncClient

import random

from src.main import app


@pytest.mark.asyncio
async def test_auth_flow():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Register new user
        reg_resp = await client.post(
            "/auth/register",
            json={"email": f"lead{random.randint(1, 10**9)}@example.com", "password": "secure_password", "role": "editor"},
        )
        assert reg_resp.status_code == 201
        data = reg_resp.json()
        assert "access_token" in data
        assert data["user"]["email"].endswith("@example.com")
        token = data["access_token"]

        reg_email = data["user"]["email"]
        # 2. Get /auth/me with Bearer token
        me_resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me_resp.status_code == 200
        me_data = me_resp.json()
        assert me_data["email"] == reg_email
        assert me_data["role"] == "editor"

        # 3. Login
        login_resp = await client.post(
            "/auth/login",
            json={"email": reg_email, "password": "secure_password"},
        )
        assert login_resp.status_code == 200
        assert "access_token" in login_resp.json()

        # 4. Demo Login
        demo_resp = await client.post("/auth/demo-login", json={"role": "admin"})
        assert demo_resp.status_code == 200
        assert demo_resp.json()["user"]["role"] == "admin"


@pytest.mark.asyncio
async def test_auth_unauthorized():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/auth/me")
        assert resp.status_code == 401
