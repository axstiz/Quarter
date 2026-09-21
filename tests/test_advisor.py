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
