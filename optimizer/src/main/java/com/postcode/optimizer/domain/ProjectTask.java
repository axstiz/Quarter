package com.postcode.optimizer.domain;

/** Проектная задача (факт для ограничений): идентичность, SP, объём по статусу. */
public class ProjectTask {

    private String taskId;
    private String parentId;
    private String status;
    private String teamId;
    private double storyPoints;
    private double estimatedHh;
    private double spentTime;
    private int priority;
    private boolean plannedInSprint;

    public ProjectTask() {
    }

    public ProjectTask(String taskId, String parentId, String status, String teamId, double storyPoints,
                       double estimatedHh, double spentTime, int priority, boolean plannedInSprint) {
        this.taskId = taskId;
        this.parentId = parentId;
        this.status = status;
        this.teamId = teamId;
        this.storyPoints = storyPoints;
        this.estimatedHh = estimatedHh;
        this.spentTime = spentTime;
        this.priority = priority;
        this.plannedInSprint = plannedInSprint;
    }

    public String getTaskId() {
        return taskId;
    }

    public String getParentId() {
        return parentId;
    }

    public String getStatus() {
        return status;
    }

    public String getTeamId() {
        return teamId;
    }

    public double getStoryPoints() {
        return storyPoints;
    }

    public double getEstimatedHh() {
        return estimatedHh;
    }

    public double getSpentTime() {
        return spentTime;
    }

    public int getPriority() {
        return priority;
    }

    public boolean isPlannedInSprint() {
        return plannedInSprint;
    }
}