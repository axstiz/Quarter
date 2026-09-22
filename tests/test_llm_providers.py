"""Change 027: выбор LLM-провайдера через настройки (gigachat|ollama|none)."""
import httpx
import pytest

import src.ai.llm as llm_mod
from src.ai.llm import LLMUnavailable, OllamaClient, get_client


@pytest.fixture(autouse=True)
def _reset_llm_singleton(monkeypatch):
    monkeypatch.setattr(llm_mod, "_CLIENT", None)
    yield


def test_factory_default_is_gigachat():
    from src.ai.gigachat import GigaChatClient

    assert isinstance(get_client(), GigaChatClient)


def test_factory_ollama(monkeypatch):
    monkeypatch.setattr("src.core.config.settings.llm_provider", "ollama")
    client = get_client()
    assert isinstance(client, OllamaClient)
    assert client.enabled


def test_factory_none_disabled(monkeypatch):
    monkeypatch.setattr("src.core.config.settings.llm_provider", "none")
    client = get_client()
    assert not client.enabled
    with pytest.raises(LLMUnavailable):
        client.complete("s", "u")


def test_ollama_complete_ok(monkeypatch):
    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "ответ"}}]}

    monkeypatch.setattr(httpx.Client, "post", lambda *a, **kw: FakeResp())
    client = OllamaClient(base_url="http://ollama:11434", model="test-model")
    assert client.complete("sys", "user") == "ответ"


def test_ollama_unavailable_on_network_error(monkeypatch):
    def boom(*a, **kw):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx.Client, "post", boom)
    client = OllamaClient(base_url="http://ollama:11434", model="test-model")
    with pytest.raises(LLMUnavailable):
        client.complete("sys", "user")


def test_ollama_unavailable_on_http_500(monkeypatch):
    class FakeResp:
        def raise_for_status(self):
            raise httpx.HTTPStatusError("500", request=None, response=None)

    monkeypatch.setattr(httpx.Client, "post", lambda *a, **kw: FakeResp())
    client = OllamaClient(base_url="http://ollama:11434", model="test-model")
    with pytest.raises(LLMUnavailable):
        client.complete("sys", "user")


@pytest.mark.asyncio
async def test_advisor_fallback_when_ollama_down(auth, monkeypatch):
    """1.3: provider=ollama, сервер недоступен → mode=fallback, 200."""
    from httpx import ASGITransport, AsyncClient

    from src.main import app

    monkeypatch.setattr("src.core.config.settings.llm_provider", "ollama")
    monkeypatch.setattr("src.core.config.settings.ollama_base_url", "http://127.0.0.1:9")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=auth) as ac:
        r = await ac.post("/api/v1/data/import")
        assert r.status_code == 200
        r = await ac.post("/api/v1/plans/generate")
        plan_id = r.json()["plan_id"]
        r = await ac.get(f"/api/v1/plans/{plan_id}/advice")
        assert r.status_code == 200
        assert r.json()["mode"] == "fallback"
        assert r.json()["advice"]


# --- change 028: общий лимит конкурентности LLM-вызовов ---------------------

@pytest.mark.asyncio
async def test_complete_async_limits_concurrency(monkeypatch):
    """5 параллельных complete_async при лимите 2 — не более 2 одновременных."""
    import asyncio
    from src.ai import llm as llm_mod

    monkeypatch.setattr(llm_mod.settings, "llm_max_concurrency", 2)
    monkeypatch.setattr(llm_mod, "_LLM_SEMAPHORE", None)  # ленивый семофор заново

    active = 0
    max_active = 0

    class Slow:
        enabled = True

        def complete(self, system, user, temperature=0.0):
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            try:
                import time
                time.sleep(0.02)
            finally:
                active -= 1
            return "ok"

    results = await asyncio.gather(*[
        llm_mod.complete_async(Slow(), "s", f"u{i}") for i in range(5)])
    assert results == ["ok"] * 5
    assert max_active <= 2, f"лимит нарушен: {max_active} одновременных вызовов"


@pytest.mark.asyncio
async def test_complete_async_propagates_unavailable():
    """Недоступный провайдер — LLMUnavailable наверх (деградация потребителя)."""
    import asyncio
    import pytest as _pytest

    from src.ai import llm as llm_mod

    class Dead:
        enabled = True

        def complete(self, system, user, temperature=0.0):
            raise llm_mod.LLMUnavailable("нет провайдера")

    with _pytest.raises(llm_mod.LLMUnavailable):
        await llm_mod.complete_async(Dead(), "s", "u")
