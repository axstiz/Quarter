package com.postcode.optimizer.domain;

import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.common.PlanningId;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;

/** Перенос инженера между командами («накрайняк»); null — без переноса. */
@PlanningEntity
public class StaffingMove {

    @PlanningId
    private String engineerId;
    private String fromTeamId;

    @PlanningVariable(valueRangeProviderRefs = "teamRange", allowsUnassigned = true)
    private String toTeamId;

    public StaffingMove() {
    }

    public StaffingMove(String engineerId, String fromTeamId) {
        this.engineerId = engineerId;
        this.fromTeamId = fromTeamId;
    }

    public String getEngineerId() {
        return engineerId;
    }

    public String getFromTeamId() {
        return fromTeamId;
    }

    public String getToTeamId() {
        return toTeamId;
    }

    public void setToTeamId(String toTeamId) {
        this.toTeamId = toTeamId;
    }
}
