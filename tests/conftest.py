"""Тестовые фикстуры: JWT-сессии трёх ролей (change 005).

Каждая фикстура ставит глобальный engine/SessionLocal под loop своего теста
(asyncpg не переживает смену event loop) и восстанавливает состояние после.
"""
from __future__ import annotations

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _app():
    from src.main import app
    return app


def _headers(resp_json: dict) -> dict:
    return {"Authorization": f"Bearer {resp_json['access_token']}"}


async def _login_all() -> dict[str, dict]:
    """Демо-вход admin/editor/reader; глобальный engine уже стоит.nettt"""
    out = {}
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as ac:
        for role in ("admin", "editor", "reader"):
            r = await ac.post("/auth/demo-login", json={"role": role})
            r.raise_for_status()
            out[role] = _headers(r.json())
    return out


def _make_role_fixture(role: str):
    @pytest_asyncio.fixture()
    async def fixture():
        import src.db.session as session_mod
        from src.db.session import init_db
        from src.core.config import settings

        engine = create_async_engine(settings.database_url, echo=False)
        old = (session_mod.engine, session_mod.SessionLocal)
        session_mod.engine = engine
        session_mod.SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
        try:
            await init_db()
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as ac:
                r = await ac.post("/auth/demo-login", json={"role": role})
                r.raise_for_status()
                headers = _headers(r.json())
            yield headers
        finally:
            await engine.dispose()
            session_mod.engine, session_mod.SessionLocal = old

    fixture.__name__ = f"auth_{role}"
    return fixture


auth = _make_role_fixture("editor")
auth_admin = _make_role_fixture("admin")
auth_reader = _make_role_fixture("reader")


@pytest_asyncio.fixture()
async def auths() -> dict[str, dict]:
    """Все три роли сразу: {'admin': ..., 'editor': ..., 'reader': ...}."""
    import src.db.session as session_mod
    from src.db.session import init_db
    from src.core.config import settings

    engine = create_async_engine(settings.database_url, echo=False)
    old = (session_mod.engine, session_mod.SessionLocal)
    session_mod.engine = engine
    session_mod.SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    try:
        await init_db()
        yield await _login_all()
    finally:
        await engine.dispose()
        session_mod.engine, session_mod.SessionLocal = old
