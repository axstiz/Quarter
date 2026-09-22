package com.postcode.optimizer.domain;

/** Средняя фактическая производительность команды (факт); доступно velocity × 0,8 SP за спринт. */
public class TeamVelocity {

    private String teamId;
    private double plannedSp;

    public TeamVelocity() {
    }

    public TeamVelocity(String teamId, double plannedSp) {
        this.teamId = teamId;
        this.plannedSp = plannedSp;
    }

    public String getTeamId() {
        return teamId;
    }

    public double getPlannedSp() {
        return plannedSp;
    }
}