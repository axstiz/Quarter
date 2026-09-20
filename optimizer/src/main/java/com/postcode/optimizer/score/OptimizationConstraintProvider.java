package com.postcode.optimizer.score;

import ai.timefold.solver.core.api.score.HardSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintCollectors;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import ai.timefold.solver.core.api.score.stream.Joiners;
import com.postcode.optimizer.domain.Engineer;
import com.postcode.optimizer.domain.RoleCapacity;
import com.postcode.optimizer.domain.StaffingMove;
import com.postcode.optimizer.domain.TaskDependency;
import com.postcode.optimizer.domain.TaskPartAssignment;
import com.postcode.optimizer.domain.TeamVelocity;

import java.util.List;

/**
 * Жёсткие ограничения оптимизации (change 018, spec planning): повторяют правила change 003 как hard —
 * ёмкость команды velocity × 0,8, часы ролей против лимитов (80 при полной ставке, 40 при 0,5; виртуальный
 * держатель для ролей без носителей), зависимости задач, защита единственных носителей от переноса.
 */
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

    /** Ёмкость команды по SP: сумма планируемых SP в спринте не превышает velocity × 0,8. */
    Constraint teamSpCapacity(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> a.getSprint() != null)
                .groupBy(
                        TaskPartAssignment::getTeamId,
                        TaskPartAssignment::getSprint,
                        ConstraintCollectors.sum(a -> Math.round(a.getStoryPoints())))
                .join(TeamVelocity.class,
                        Joiners.equal((teamId, sprintId, sp) -> teamId, TeamVelocity::getTeamId))
                .filter((teamId, sprintId, sp, velocity) -> sp > Math.round(velocity.getPlannedSp() * CAPACITY_UTILIZATION))
                .penalize(HardSoftScore.ONE_HARD,
                        (teamId, sprintId, sp, velocity) -> sp - Math.round(velocity.getPlannedSp() * CAPACITY_UTILIZATION))
                .asConstraint("teamSpCapacity");
    }

    /** Часы ролей в спринте не превышают суммарный лимит носителей роли (80×ставка; нет носителей — виртуальный держатель 80 ч). */
    Constraint roleHoursCapacity(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> a.getSprint() != null)
                .map(a -> new RoleLoads(a.getSprint(), a.getRoleHours().entrySet().stream()
                        .map(e -> new RoleLoad(a.getSprint(), e.getKey(), e.getValue()))
                        .toList()))
                .flattenLast(RoleLoads::loads)
                .groupBy(
                        RoleLoad::sprint,
                        RoleLoad::role,
                        ConstraintCollectors.sum(load -> Math.round(load.hours())))
                .join(RoleCapacity.class,
                        Joiners.equal((sprintId, role, hours) -> role, RoleCapacity::getRole))
                .filter((sprintId, role, hours, capacity) -> hours > Math.round(capacity.getHours()))
                .penalize(HardSoftScore.ONE_HARD,
                        (sprintId, role, hours, capacity) -> hours - Math.round(capacity.getHours()))
                .asConstraint("roleHoursCapacity");
    }

    /** Зависимая часть задачи стартует строго после последнего спринта частей блокирующей задачи. */
    Constraint dependencyAfterBlocker(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .join(TaskDependency.class,
                        Joiners.equal(TaskPartAssignment::getTaskId, TaskDependency::getBlockedTaskId))
                .join(TaskPartAssignment.class,
                        Joiners.equal((blocked, dep) -> dep.getBlockingTaskId(), TaskPartAssignment::getTaskId))
                .filter((blocked, dep, blocker) -> blocked.getSprint() != null && blocker.getSprint() != null
                        && blocked.getSprint() <= blocker.getSprint())
                .penalize(HardSoftScore.ONE_HARD,
                        (blocked, dep, blocker) -> blocker.getSprint() - blocked.getSprint() + 1L)
                .asConstraint("dependencyAfterBlocker");
    }

    /** Перенос единственного носителя компетенции (Bus Factor = 1 в команде) запрещён. */
    Constraint soleHolderNotMoved(ConstraintFactory factory) {
        return factory.forEach(StaffingMove.class)
                .filter(move -> move.getToTeamId() != null && !move.getToTeamId().equals(move.getFromTeamId()))
                .join(Engineer.class,
                        Joiners.equal(StaffingMove::getEngineerId, Engineer::getEngineerId))
                .filter((move, engineer) -> engineer.isSoleHolderInTeam())
                .penalize(HardSoftScore.ONE_HARD)
                .asConstraint("soleHolderNotMoved");
    }

    private record RoleLoad(Integer sprint, String role, Double hours) {
    }

    private record RoleLoads(Integer sprint, List<RoleLoad> loads) {
    }
}