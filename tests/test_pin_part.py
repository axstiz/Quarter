"""change 047: part-level pin — перенос одной части задачи и слияние строк в целевом спринте."""
from collections import defaultdict

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


async def _plan(client, auth):
    await client.post("/api/v1/data/import", headers=auth)
    plan_res = await client.post("/api/v1/plans/generate", json={"strategy": "priority"}, headers=auth)
    return plan_res.json()["plan_id"]


def _rows(plan, task_id):
    return [(s["sprint_no"], t) for s in plan["sprints"] for t in s["tasks"] if t["task_id"] == task_id]


def _split_task(plan):
    """Задача, разрезанная на несколько спринтов (все части — planned)."""
    by_task = defaultdict(set)
    for s in plan["sprints"]:
        for t in s["tasks"]:
            if t["decision"] == "planned":
                by_task[t["task_id"]].add(s["sprint_no"])
    return next(((tid, sorted(ss)) for tid, ss in by_task.items() if len(ss) >= 2), (None, None))


@pytest.mark.asyncio
async def test_pin_part_moves_only_that_part_and_merges(auth):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        plan_id = await _plan(client, auth)
        plan = (await client.get(f"/api/v1/plans/{plan_id}", headers=auth)).json()
        tid, sprints = _split_task(plan)
        if tid is None:
            pytest.skip("в демо-плане нет разрезанных задач")
        src, target = sprints[-1], sprints[0]
        before = _rows(plan, tid)
        sp_total = sum(t.get("step_points_sp") or 0 for _, t in before)

        res = await client.post(f"/api/v1/plans/{plan_id}/tasks/{tid}/pin",
                                json={"sprint_no": target, "from_sprint_no": src}, headers=auth)
        assert res.status_code == 200, res.text

        after = _rows((await client.get(f"/api/v1/plans/{plan_id}", headers=auth)).json(), tid)
        after_sprints = [s for s, _ in after]
        # в исходном спринте части больше нет, прочие части на местах
        assert src not in after_sprints
        assert set(after_sprints) == set(sprints) - {src}
        # одна строка на (задача × спринт)
        assert len(after_sprints) == len(set(after_sprints))
        # SP не потерялись при слиянии
        assert abs(sum(t.get("step_points_sp") or 0 for _, t in after) - sp_total) < 1e-6
        # назначения слитой строки переписаны на целевой спринт
        merged = next(t for s, t in after if s == target)
        assert all(a["sprint_no"] == target for a in merged.get("assignments") or [])


@pytest.mark.asyncio
async def test_pin_part_unknown_source_sprint_404(auth):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        plan_id = await _plan(client, auth)
        plan = (await client.get(f"/api/v1/plans/{plan_id}", headers=auth)).json()
        tid, sprint = next(((t["task_id"], s["sprint_no"]) for s in plan["sprints"] for t in s["tasks"]
                            if t["decision"] == "planned"), (None, None))
        assert tid, "пустой план"
        occupied = {s for s, _ in _rows(plan, tid)}
        free = next((n for n in range(1, 7) if n not in occupied), None)
        if free is None:
            pytest.skip("задача занимает все спринты")
        res = await client.post(f"/api/v1/plans/{plan_id}/tasks/{tid}/pin",
                                json={"sprint_no": sprint, "from_sprint_no": free}, headers=auth)
        assert res.status_code == 404, res.text


@pytest.mark.asyncio
async def test_pin_whole_task_still_collapses_to_one_row(auth):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        plan_id = await _plan(client, auth)
        plan = (await client.get(f"/api/v1/plans/{plan_id}", headers=auth)).json()
        tid, sprints = _split_task(plan)
        if tid is None:
            pytest.skip("в демо-плане нет разрезанных задач")
        res = await client.post(f"/api/v1/plans/{plan_id}/tasks/{tid}/pin",
                                json={"sprint_no": sprints[0]}, headers=auth)
        assert res.status_code == 200, res.text
        after = _rows((await client.get(f"/api/v1/plans/{plan_id}", headers=auth)).json(), tid)
        assert [s for s, _ in after] == [sprints[0]]
        assert after[0][1].get("pinned_sprint") in (None, sprints[0])

        unpin = await client.delete(f"/api/v1/plans/{plan_id}/tasks/{tid}/pin", headers=auth)
        assert unpin.status_code == 200, unpin.text
