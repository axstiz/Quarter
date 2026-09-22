"""Тесты советника (change 015): советы по сводке, fallback, pin-фильтр, comment pass-through."""
import json

import pytest
from httpx import ASGITransport, AsyncClient

from src.ai.pipelines.advisor import fallback_advice
from src.main import app


@pytest.mark.asyncio
async def test_advice_endpoint_not_empty(auth):
    h = auth
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        await ac.post("/api/v1/data/import", headers=h)
        gen = await ac.post("/api/v1/plans/generate", headers=h)
        plan_id = gen.json()["plan_id"]
        r = await ac.get(f"/api/v1/plans/{plan_id}/advice", headers=h)
        assert r.status_code == 200
        body = r.json()
        assert body["mode"] in ("fallback", "llm")
        assert body["advice"], "советы не пустые"
        kinds = {a["kind"] for a in body["advice"]}
        assert kinds <= {"task_move", "staffing_shift", "initiative_rescue", "sprint_priority"}
        for a in body["advice"]:
            assert a["numeric_basis"]
            assert a["expected_effect"]


@pytest.mark.asyncio
async def test_advice_comment_not_persisted(auth):
    """comment учитывается при формировании (pass-through) и никогда не сохраняется."""
    h = auth
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        await ac.post("/api/v1/data/import", headers=h)
        gen = await ac.post("/api/v1/plans/generate", headers=h)
        plan_id = gen.json()["plan_id"]

        r1 = await ac.get(f"/api/v1/plans/{plan_id}/advice", headers=h,
                          params={"comment": "ENG-405 заболел до конца спринта"})
        assert r1.status_code == 200
        b1 = r1.json()
        assert b1["comment_considered"] is True
        # pass-through: fallback советы содержат упоминание контекста пользователя
        messages = json.dumps(b1, ensure_ascii=False)
        assert "ENG-405" in messages

        # не сохраняется: повторный вызов без comment — без признака
        r2 = await ac.get(f"/api/v1/plans/{plan_id}/advice", headers=h)
        b2 = r2.json()
        assert b2["comment_considered"] is False
        assert "ENG-405 заболел" not in json.dumps(b2, ensure_ascii=False)


@pytest.mark.asyncio
async def test_advice_excludes_pinned_tasks(auth):
    """pinned-задачи не фигурируют в советах на перенос (015 §2.3): pin → советы без них."""
    h = auth
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        await ac.post("/api/v1/data/import", headers=h)
        gen = await ac.post("/api/v1/plans/generate", headers=h)
        plan_id = gen.json()["plan_id"]

        r1 = await ac.get(f"/api/v1/plans/{plan_id}/advice", headers=h)
        assert r1.status_code == 200
        advice1 = r1.json()["advice"]
        mentioned = {t for a in advice1 for t in a["affected_task_ids"]}
        assert mentioned, "в демо-советах есть задачи"

        # закрепляем упомянутые задачи в их текущих спринтах плана
        plan = (await ac.get(f"/api/v1/plans/{plan_id}", headers=h)).json()
        sprint_of = {t["task_id"]: s["sprint_no"] for s in plan["sprints"] for t in s["tasks"]}
        for tid in sorted(mentioned):
            if tid not in sprint_of:
                continue  # вне плана — pin не применим к текущей раскладке
            pr = await ac.post(f"/api/v1/plans/{plan_id}/tasks/{tid}/pin",
                               headers=h, json={"sprint_no": sprint_of[tid]})
            assert pr.status_code == 200, pr.text

        r2 = await ac.get(f"/api/v1/plans/{plan_id}/advice", headers=h)
        assert r2.status_code == 200
        for a in r2.json()["advice"]:
            assert not (set(a["affected_task_ids"]) & mentioned), f"pinned-задача в совете: {a}"


@pytest.mark.asyncio
async def test_fallback_advice_builder():
    warnings = [{"kind": "deadline_overflow", "message": "выход за квартал",
                 "task_ids": ["MP-101", "MP-102"]}]
    opt_report = {"strategy_used": "metrics",
                  "composition_diff": {"added_tasks": ["AI-302"], "removed_tasks": []},
                  "kpi_summary": {"quarter_target_band": [80.0, 100.0], "quarter_completion_pct": 65.0}}
    out = fallback_advice(warnings, opt_report, [], {}, comment=None)
    kinds = [a.kind for a in out]
    assert "task_move" in kinds
    assert "initiative_rescue" in kinds
    assert "sprint_priority" in kinds
    for a in out:
        assert a.numeric_basis and a.expected_effect


@pytest.mark.asyncio
async def test_bad_ca_bundle_degrades_not_500(monkeypatch):
    """change 030: кривой GIGACHAT_CA_BUNDLE → GigaUnavailable (fallback, не 500)."""
    from src.ai.gigachat import GigaChatClient

    monkeypatch.setenv("GIGACHAT_CLIENT_SECRET", "Base64:FAKE")
    monkeypatch.setenv("GIGACHAT_CA_BUNDLE", "/nonexistent/ca.pem")
    c = GigaChatClient(client_id=None, base_url=None)
    import pytest
    from src.ai.llm import LLMUnavailable

    with pytest.raises(LLMUnavailable, match="LLM недоступен"):
        c.complete("s", "u")


@pytest.mark.asyncio
async def test_advice_saved_to_history_with_comment(auth):
    """change 043: прогон записывается в историю с комментарием и version_label."""
    from httpx import ASGITransport, AsyncClient
    from src.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/v1/data/import", headers=auth)
        plan = (await client.post("/api/v1/plans/generate", json={"strategy": "priority"}, headers=auth)).json()["plan_id"]
        r = await client.get(f"/api/v1/plans/{plan}/advice?comment=ENG-405 заболел", headers=auth)
        assert r.status_code == 200, r.text

        h = await client.get(f"/api/v1/plans/{plan}/advice/history", headers=auth)
        assert h.status_code == 200, h.text
        rows = h.json()
        assert rows, "история пуста — прогон не записан"
        top = rows[0]
        assert top["comment"] == "ENG-405 заболел"
        assert top["comment_considered"] is True
        assert "версия" in top["version_label"]
        assert top["mode"] in ("llm", "fallback")
        assert isinstance(top["advice"], list)
