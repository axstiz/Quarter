package com.postcode.optimizer.api;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/** Снапшот задачи оптимизации (контракт solve, spec architecture 018): задачи с частями, зависимости, инженеры. */
public record SolveRequest(
        @JsonProperty("sprints") List<Integer> sprints,
        @JsonProperty("team_velocities") List<TeamVelocityInput> teamVelocities,
        @JsonProperty("tasks") List<TaskInput> tasks,
        @JsonProperty("dependencies") List<DependencyInput> dependencies,
        @JsonProperty("engineers") List<EngineerInput> engineers) {

    public record TeamVelocityInput(
            @JsonProperty("team_id") String teamId,
            @JsonProperty("velocity") double velocity) {
    }

    public record TaskInput(
            @JsonProperty("task_id") String taskId,
            @JsonProperty("parent_id") String parentId,
            @JsonProperty("status") String status,
            @JsonProperty("team_id") String teamId,
            @JsonProperty("story_points") double storyPoints,
            @JsonProperty("estimated_hh") double estimatedHh,
            @JsonProperty("spent_time") double spentTime,
            @JsonProperty("priority") int priority,
            @JsonProperty("planned_in_sprint") boolean plannedInSprint,
            @JsonProperty("parts") List<PartInput> parts) {
    }

    public record PartInput(
            @JsonProperty("part") int part,
            @JsonProperty("story_points") double storyPoints,
            @JsonProperty("role_hours") Map<String, Double> roleHours) {
    }

    public record DependencyInput(
            @JsonProperty("blocking_task_id") String blockingTaskId,
            @JsonProperty("blocked_task_id") String blockedTaskId) {
    }

    public record EngineerInput(
            @JsonProperty("engineer_id") String engineerId,
            @JsonProperty("team_id") String teamId,
            @JsonProperty("role") String role,
            @JsonProperty("capacity_rate") double capacityRate,
            @JsonProperty("sole_holder_in_team") boolean soleHolderInTeam) {
    }
}