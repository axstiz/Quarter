package com.postcode.optimizer.domain;

/** Инженер (факт): роль, ставка, команда, единственный носитель компетенции в своей команде. */
public class Engineer {

    private String engineerId;
    private String teamId;
    private String role;
    private double capacityRate;
    private boolean soleHolderInTeam;

    public Engineer() {
    }

    public Engineer(String engineerId, String teamId, String role, double capacityRate, boolean soleHolderInTeam) {
        this.engineerId = engineerId;
        this.teamId = teamId;
        this.role = role;
        this.capacityRate = capacityRate;
        this.soleHolderInTeam = soleHolderInTeam;
    }

    public String getEngineerId() {
        return engineerId;
    }

    public String getTeamId() {
        return teamId;
    }

    public String getRole() {
        return role;
    }

    public double getCapacityRate() {
        return capacityRate;
    }

    public boolean isSoleHolderInTeam() {
        return soleHolderInTeam;
    }
}