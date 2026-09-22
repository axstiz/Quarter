package com.postcode.optimizer.domain;

/** Доступный объём роли за спринт (факт): сумма 80 ч × capacity_rate носителей роли; нет носителей — виртуальный держатель 80 ч. */
public class RoleCapacity {

    private String role;
    private double hours;

    public RoleCapacity() {
    }

    public RoleCapacity(String role, double hours) {
        this.role = role;
        this.hours = hours;
    }

    public String getRole() {
        return role;
    }

    public double getHours() {
        return hours;
    }
}