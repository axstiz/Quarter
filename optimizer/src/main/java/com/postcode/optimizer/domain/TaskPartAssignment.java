package com.postcode.optimizer.domain;

import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.common.PlanningId;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;

import java.util.Map;

/** Назначение части задачи: спринт и команда — планning-переменные (домен assignment из design 018). */
@PlanningEntity
public class TaskPartAssignment {

    @PlanningId
    private String id;
    private String taskId;
    private int part;
    private double storyPoints;
    private Map<String, Double> roleHours;

    @PlanningVariable(valueRangeProviderRefs = "sprintRange")
    private Integer sprint;

    @PlanningVariable(valueRangeProviderRefs = "teamRange")
    private String teamId;

    public TaskPartAssignment() {
    }

    public TaskPartAssignment(String id, String taskId, int part, double storyPoints, Map<String, Double> roleHours) {
        this.id = id;
        this.taskId = taskId;
        this.part = part;
        this.storyPoints = storyPoints;
        this.roleHours = roleHours;
    }

    public String getId() {
        return id;
    }

    public String getTaskId() {
        return taskId;
    }

    public int getPart() {
        return part;
    }

    public double getStoryPoints() {
        return storyPoints;
    }

    public Map<String, Double> getRoleHours() {
        return roleHours;
    }

    public Integer getSprint() {
        return sprint;
    }

    public void setSprint(Integer sprint) {
        this.sprint = sprint;
    }

    public String getTeamId() {
        return teamId;
    }

    public void setTeamId(String teamId) {
        this.teamId = teamId;
    }
}
