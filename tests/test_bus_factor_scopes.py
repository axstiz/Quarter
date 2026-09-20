import pytest
from httpx import ASGITransport, AsyncClient

from src.domain.models import Engineer
from src.main import app
from src.services.bus_factor import compute_bus_factor


def test_compute_bus_factor_scopes():
    engineers = [
        Engineer(engineer_id="E1", team_id="Team-L", role="Разработчик Java", skills_declared="Java, Spring"),
        Engineer(engineer_id="E2", team_id="Team-L", role="Тестировщик", skills_declared="Pytest"),
        Engineer(engineer_id="E3", team_id="Team-K", role="Разработчик Java", skills_declared="Java"),
    ]

    # Full report
    full = compute_bus_factor(engineers)
    assert any(i.scope_type == "company" for i in full.items)
    assert any(i.scope_type == "team" for i in full.items)

    # Filter scope_type=team, scope_id=Team-L
    team_l = compute_bus_factor(engineers, scope_type="team", scope_id="Team-L")
    assert all(i.scope_type == "team" and i.scope_id == "Team-L" for i in team_l.items)
    assert len(team_l.items) > 0

    # Engineer E3 (Team-K) must not be in Team-L holders
    for item in team_l.items:
        assert "E3" not in item.holders


@pytest.mark.asyncio
async def test_api_bus_factor_scopes(auths):
    h = auths["editor"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/v1/data/import", headers=h)

        # 1) GET /bus-factor?scope_type=team&scope_id=Team-L
        r_filter = await client.get("/api/v1/bus-factor?scope_type=team&scope_id=Team-L", headers=h)
        assert r_filter.status_code == 200
        filter_data = r_filter.json()

        # 2) GET /teams/Team-L/bus-factor
        r_team = await client.get("/api/v1/teams/Team-L/bus-factor", headers=h)
        assert r_team.status_code == 200
        team_data = r_team.json()

        # Equality test (task 1.3)
        assert filter_data == team_data

        # 3) 404 for unknown scope_type
        r_bad_scope = await client.get("/api/v1/bus-factor?scope_type=invalid", headers=h)
        assert r_bad_scope.status_code == 404

        # 4) 404 for nonexistent team
        r_bad_team = await client.get("/api/v1/teams/NonexistentTeam/bus-factor", headers=h)
        assert r_bad_team.status_code == 404
