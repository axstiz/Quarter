package com.postcode.optimizer.domain;

import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.score.HardSoftScore;

import java.util.List;

/** Черновик расстановки: части задач по спринтам/командам + staffing-перемещения, score Hard/Soft. */
@PlanningSolution
public class OptimizationDraft {

    @ValueRangeProvider(id = "sprintRange")
    @ProblemFactCollectionProperty
    private List<Integer> sprints;

    @ValueRangeProvider(id = "teamRange")
    @ProblemFactCollectionProperty
    private List<String> teamIds;

    @PlanningEntityCollectionProperty
    private List<TaskPartAssignment> assignments;

    @PlanningEntityCollectionProperty
    private List<StaffingMove> staffingMoves;

    @PlanningScore
    private HardSoftScore score;

    public OptimizationDraft() {
    }

    public OptimizationDraft(List<Integer> sprints, List<String> teamIds,
                             List<TaskPartAssignment> assignments, List<StaffingMove> staffingMoves) {
        this.sprints = sprints;
        this.teamIds = teamIds;
        this.assignments = assignments;
        this.staffingMoves = staffingMoves;
    }

    public List<Integer> getSprints() {
        return sprints;
    }

    public List<String> getTeamIds() {
        return teamIds;
    }

    public List<TaskPartAssignment> getAssignments() {
        return assignments;
    }

    public List<StaffingMove> getStaffingMoves() {
        return staffingMoves;
    }

    public HardSoftScore getScore() {
        return score;
    }

    public void setScore(HardSoftScore score) {
        this.score = score;
    }
}
