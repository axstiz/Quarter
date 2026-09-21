package com.postcode.optimizer.api;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/** Черновик расстановки + score (ответ POST /solve, контракт spec architecture 018). */
public record SolveResponse(
        @JsonProperty("assignments") List<AssignmentOutput> assignments,
        @JsonProperty("staffing_moves") List<StaffingMoveOutput> staffingMoves,
        @JsonProperty("score") ScoreOutput score,
        @JsonProperty("score_breakdown") List<ConstraintScoreOutput> scoreBreakdown,
        @JsonProperty("solve_time_ms") long solveTimeMillis,
        @JsonProperty("seed") long seed) {

    public record AssignmentOutput(
            @JsonProperty("part_id") String partId,
            @JsonProperty("task_id") String taskId,
            @JsonProperty("part") int part,
            @JsonProperty("sprint") int sprint,
            @JsonProperty("team_id") String teamId) {
    }

    public record StaffingMoveOutput(
            @JsonProperty("engineer_id") String engineerId,
            @JsonProperty("from_team_id") String fromTeamId,
            @JsonProperty("to_team_id") String toTeamId) {
    }

    public record ScoreOutput(
            @JsonProperty("hard") long hard,
            @JsonProperty("soft") long soft) {
    }

    public record ConstraintScoreOutput(
            @JsonProperty("constraint") String constraint,
            @JsonProperty("weight") long weight) {
    }
}