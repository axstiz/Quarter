package com.postcode.optimizer.score;

import ai.timefold.solver.core.api.score.HardSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import com.postcode.optimizer.domain.TaskPartAssignment;

/** ЗАГЛУШКА (RED): ограничения ещё не реализованы, определяется только контур задач 1.2. */
public class OptimizationConstraintProvider implements ConstraintProvider {

    public static final double CAPACITY_UTILIZATION = 0.8;

    @Override
    public Constraint[] defineConstraints(ConstraintFactory factory) {
        return new Constraint[]{
                teamSpCapacity(factory),
                roleHoursCapacity(factory),
                dependencyAfterBlocker(factory),
                soleHolderNotMoved(factory),
        };
    }

    Constraint teamSpCapacity(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> false)
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("teamSpCapacity");
    }

    Constraint roleHoursCapacity(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> false)
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("roleHoursCapacity");
    }

    Constraint dependencyAfterBlocker(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> false)
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("dependencyAfterBlocker");
    }

    Constraint soleHolderNotMoved(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> false)
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("soleHolderNotMoved");
    }
}