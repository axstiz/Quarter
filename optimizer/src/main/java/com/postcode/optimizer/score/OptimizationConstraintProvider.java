package com.postcode.optimizer.score;

import ai.timefold.solver.core.api.score.HardSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintCollectors;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import ai.timefold.solver.core.api.score.stream.Joiners;
import com.postcode.optimizer.domain.Engineer;
import com.postcode.optimizer.domain.ProjectTask;
import com.postcode.optimizer.domain.RoleCapacity;
import com.postcode.optimizer.domain.StaffingMove;
import com.postcode.optimizer.domain.TaskDependency;
import com.postcode.optimizer.domain.TaskPartAssignment;
import com.postcode.optimizer.domain.TeamVelocity;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Жёсткие ограничения оптимизации (change 018, spec planning): повторяют правила change 003 как hard —
 * ёмкость команды velocity × 0,8, часы ролей против лимитов (80 при полной ставке, 40 при 0,5; виртуальный
 * держатель для ролей без носителей), зависимости задач, защита единственных носителей от переноса.
 */
public class OptimizationConstraintProvider implements ConstraintProvider {

    public static final double CAPACITY_UTILIZATION = 0.8;
    /** Допуск сравнения float-сумм против бэк-валидации (runtime округление Timefold-коллекторов). */
    static final double SP_EPSILON = 1e-6;
    static final long WEIGHT_INITIATIVE = 100_000;
    static final long WEIGHT_STRATEGIC_SP = 1_000;
    static final double PI_MIN_UTILIZATION = 0.6;
    static final long WEIGHT_UTILIZATION = 50;
    static final long WEIGHT_UNCLOSED_HH = 40;
    static final long WEIGHT_MOVE = 10_000;
    static final long WEIGHT_PRIORITY = 30;

    @Override
    public Constraint[] defineConstraints(ConstraintFactory factory) {
        return new Constraint[]{
                teamSpCapacity(factory),
                roleHoursCapacity(factory),
                dependencyAfterBlocker(factory),
                soleHolderNotMoved(factory),
                initiativeCompletedReward(factory),
                strategicSpReward(factory),
                teamUtilizationPenalty(factory),
                unclosedRoleHoursPenalty(factory),
                staffingMovePenalty(factory),
                priorityOrderPenalty(factory),
        };
    }

    /** (1) Целевая функция: награда за каждую инициативу (parentId), полностью размещённую в спринтах. */
    Constraint initiativeCompletedReward(ConstraintFactory factory) {
        return factory.forEach(ProjectTask.class)
                .ifExists(TaskPartAssignment.class,
                        Joiners.equal(ProjectTask::getTaskId, TaskPartAssignment::getTaskId))
                .ifNotExists(TaskPartAssignment.class,
                        Joiners.equal(ProjectTask::getTaskId, TaskPartAssignment::getTaskId),
                        Joiners.filtering((task, part) -> part.getSprint() == null))
                .groupBy(ProjectTask::getParentId, ConstraintCollectors.countDistinct(ProjectTask::getTaskId))
                .join(factory.forEach(ProjectTask.class).groupBy(ProjectTask::getParentId, ConstraintCollectors.countDistinct(ProjectTask::getTaskId))
                                .map(ParentCount::of),
                        Joiners.equal((parentId, placed) -> parentId, ParentCount::parent))
                .filter((parentId, placed, total) -> parentId != null && placed == total.total())
                .reward(HardSoftScore.ONE_SOFT, (parentId, placed, total) -> WEIGHT_INITIATIVE)
                .asConstraint("initiativeCompletedReward");
    }

    /** (2) Целевая функция: награда за запланированные SP стратегических задач заказчика (planned_in_sprint = Да). */
    Constraint strategicSpReward(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> a.getSprint() != null)
                .join(ProjectTask.class,
                        Joiners.equal(TaskPartAssignment::getTaskId, ProjectTask::getTaskId))
                .filter((a, task) -> task.isPlannedInSprint())
                .reward(HardSoftScore.ONE_SOFT,
                        (a, task) -> Math.round(a.getStoryPoints() * WEIGHT_STRATEGIC_SP))
                .asConstraint("strategicSpReward");
    }

    /** (3) Целевая функция (PI-норма): недогруженная ниже PI_MIN_UTILIZATION команда-спринт штрафуется. */
    Constraint teamUtilizationPenalty(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> a.getSprint() != null)
                .groupBy(
                        TaskPartAssignment::getTeamId,
                        TaskPartAssignment::getSprint,
                        ConstraintCollectors.sum(a -> Math.round(a.getStoryPoints())))
                .join(TeamVelocity.class,
                        Joiners.equal((teamId, sprintId, sp) -> teamId, TeamVelocity::getTeamId))
                .filter((teamId, sprintId, sp, velocity) -> sp < Math.round(PI_MIN_UTILIZATION * velocity.getPlannedSp()))
                .penalize(HardSoftScore.ONE_SOFT,
                        (teamId, sprintId, sp, velocity) -> (Math.round(PI_MIN_UTILIZATION * velocity.getPlannedSp()) - sp)
                                * WEIGHT_UTILIZATION)
                .asConstraint("teamUtilizationPenalty");
    }

    /** Tie-break: штраф за незакрытые человеко-часы частей, не размещённых в спринтах. */
    Constraint unclosedRoleHoursPenalty(ConstraintFactory factory) {
        return factory.forEachIncludingUnassigned(TaskPartAssignment.class)
                .filter(a -> a.getSprint() == null)
                .join(ProjectTask.class,
                        Joiners.equal(TaskPartAssignment::getTaskId, ProjectTask::getTaskId))
                .penalize(HardSoftScore.ONE_SOFT,
                        (a, task) -> Math.round(task.getEstimatedHh() * WEIGHT_UNCLOSED_HH))
                .asConstraint("unclosedRoleHoursPenalty");
    }

    /** Tie-break (тяжёлый штраф): любой реальный перенос инженера между командами. */
    Constraint staffingMovePenalty(ConstraintFactory factory) {
        return factory.forEach(StaffingMove.class)
                .filter(move -> move.getToTeamId() != null && !move.getToTeamId().equals(move.getFromTeamId()))
                .penalize(HardSoftScore.ONE_SOFT, move -> WEIGHT_MOVE)
                .asConstraint("staffingMovePenalty");
    }

    /** Tie-break: нарушение порядка human priority — задача с меньшим priority должна стартовать раньше. */
    Constraint priorityOrderPenalty(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> a.getSprint() != null)
                .join(ProjectTask.class,
                        Joiners.equal(TaskPartAssignment::getTaskId, ProjectTask::getTaskId))
                .join(TaskPartAssignment.class,
                        Joiners.equal((a, taskA) -> a.getTeamId(), TaskPartAssignment::getTeamId),
                        Joiners.filtering((a, taskA, b) -> b.getSprint() != null && a.getSprint() < b.getSprint()))
                .join(ProjectTask.class,
                        Joiners.equal((a, taskA, b) -> b.getTaskId(), ProjectTask::getTaskId))
                .filter((a, taskA, b, taskB) -> taskA.getPriority() > taskB.getPriority())
                .penalize(HardSoftScore.ONE_SOFT,
                        (a, taskA, b, taskB) -> (taskA.getPriority() - taskB.getPriority()) * WEIGHT_PRIORITY)
                .asConstraint("priorityOrderPenalty");
    }

    /** Ёмкость команды по SP: сумма планируемых SP в спринте не превышает velocity × 0,8.
     *  Важно: без Math.round — бэковская валидация (capacity = velocity×0,8, е.g. 12.8) отвергает
     *  раскладку, где сумма 13.0 > 12.8, а округление Java-порога до 13 её «прощало». */
    Constraint teamSpCapacity(ConstraintFactory factory) {
        return factory.forEach(TaskPartAssignment.class)
                .filter(a -> a.getSprint() != null)
                .groupBy(
                        TaskPartAssignment::getTeamId,
                        TaskPartAssignment::getSprint,
                        ConstraintCollectors.sum((TaskPartAssignment a) -> Math.round(a.getStoryPoints() * 10L)))
                .join(TeamVelocity.class,
                        Joiners.equal((teamId, sprintIdTenths, spTenths) -> teamId, TeamVelocity::getTeamId))
                .filter((teamId, sprintIdTenths, spTenths, velocity) ->
                        spTenths > Math.round(velocity.getPlannedSp() * CAPACITY_UTILIZATION * 10L))
                .penalize(HardSoftScore.ONE_HARD,
                        (teamId, sprintIdTenths, spTenths, velocity) ->
                                spTenths - Math.round(velocity.getPlannedSp() * CAPACITY_UTILIZATION * 10L))
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
                        ConstraintCollectors.sum((RoleLoad load) -> Math.round(load.hours() * 10L)))
                .join(RoleCapacity.class,
                        Joiners.equal((sprintIdTenths, role, hoursTenths) -> role, RoleCapacity::getRole))
                .filter((sprintIdTenths, role, hoursTenths, capacity) ->
                        hoursTenths > Math.round(capacity.getHours() * 10L))
                .penalize(HardSoftScore.ONE_HARD,
                        (sprintIdTenths, role, hoursTenths, capacity) ->
                                hoursTenths - Math.round(capacity.getHours() * 10L))
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

    private record ParentCount(String parent, long total) {

        static ParentCount of(String parent, Long total) {
            return new ParentCount(parent, total);
        }
    }

    /** Имя ограничения → построитель одиночного ограничения (для OSS-разбивки score в solve-контракте). */
    public static final Map<String, Function<ConstraintFactory, Constraint>> CONSTRAINT_FUNCTIONS = Map.of(
            "teamSpCapacity", f -> new OptimizationConstraintProvider().teamSpCapacity(f),
            "roleHoursCapacity", f -> new OptimizationConstraintProvider().roleHoursCapacity(f),
            "dependencyAfterBlocker", f -> new OptimizationConstraintProvider().dependencyAfterBlocker(f),
            "soleHolderNotMoved", f -> new OptimizationConstraintProvider().soleHolderNotMoved(f),
            "initiativeCompletedReward", f -> new OptimizationConstraintProvider().initiativeCompletedReward(f),
            "strategicSpReward", f -> new OptimizationConstraintProvider().strategicSpReward(f),
            "teamUtilizationPenalty", f -> new OptimizationConstraintProvider().teamUtilizationPenalty(f),
            "unclosedRoleHoursPenalty", f -> new OptimizationConstraintProvider().unclosedRoleHoursPenalty(f),
            "staffingMovePenalty", f -> new OptimizationConstraintProvider().staffingMovePenalty(f),
            "priorityOrderPenalty", f -> new OptimizationConstraintProvider().priorityOrderPenalty(f));
}