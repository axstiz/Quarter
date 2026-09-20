package com.postcode.optimizer.domain;

/** Зависимость задач (факт): blockedTaskId стартует после завершения blockingTaskId. */
public class TaskDependency {

    private String blockingTaskId;
    private String blockedTaskId;

    public TaskDependency() {
    }

    public TaskDependency(String blockingTaskId, String blockedTaskId) {
        this.blockingTaskId = blockingTaskId;
        this.blockedTaskId = blockedTaskId;
    }

    public String getBlockingTaskId() {
        return blockingTaskId;
    }

    public String getBlockedTaskId() {
        return blockedTaskId;
    }
}