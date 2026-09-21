package com.postcode.optimizer.score;

import ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier;
import com.postcode.optimizer.domain.Engineer;
import com.postcode.optimizer.domain.OptimizationDraft;
import com.postcode.optimizer.domain.ProjectTask;
import com.postcode.optimizer.domain.RoleCapacity;
import com.postcode.optimizer.domain.StaffingMove;
import com.postcode.optimizer.domain.TaskDependency;
import com.postcode.optimizer.domain.TaskPartAssignment;
import com.postcode.optimizer.domain.TeamVelocity;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier.build;

/** Score-тесты целевой функции (change 018, задача 1.3): инициативы, SP заказчика, PI-норма, штрафы. */
class OptimizationObjectiveTest {

    private final ConstraintVerifier<OptimizationConstraintProvider, OptimizationDraft> verifier =
            build(new OptimizationConstraintProvider(), OptimizationDraft.class,
                    TaskPartAssignment.class, StaffingMove.class);

    private static OptimizationDraft draft(List<Integer> sprints, List<String> teamIds,
                                           List<ProjectTask> tasks, List<Engineer> engineers,
                                           List<TeamVelocity> velocities, List<TaskPartAssignment> assignments,
                                           List<StaffingMove> moves) {
        return new OptimizationDraft(sprints, teamIds, tasks, List.of(), engineers, List.of(), velocities,
                assignments, moves);
    }

    private static ProjectTask task(String taskId, String parentId, boolean strategic, double sp, double hh,
                                    int priority) {
        return new ProjectTask(taskId, parentId, "InProgress", "Team-A", sp, hh, 0, priority, strategic);
    }

    private static TaskPartAssignment part(String taskId, int part, double sp, int sprint) {
        TaskPartAssignment a = new TaskPartAssignment(taskId + "#" + part, taskId, part, sp, Map.of());
        a.setTeamId("Team-A");
        a.setSprint(sprint);
        return a;
    }

    @Test
    void размещение_стратегической_задачи_дает_награду_SP() {
        OptimizationDraft d = draft(List.of(1, 2), List.of("Team-A"),
                List.of(task("T-A", "INI-1", true, 13, 50, 1)), List.of(),
                List.of(), List.of(part("T-A", 1, 13, 1)), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::strategicSpReward)
                .givenSolution(d).rewardsWith(13 * OptimizationConstraintProvider.WEIGHT_STRATEGIC_SP);
    }

    @Test
    void обычная_задача_не_дает_награды() {
        OptimizationDraft d = draft(List.of(1, 2), List.of("Team-A"),
                List.of(task("T-A", "INI-1", false, 13, 50, 1)), List.of(),
                List.of(), List.of(part("T-A", 1, 13, 1)), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::strategicSpReward)
                .givenSolution(d).hasNoImpact();
    }

    @Test
    void полностью_размещенная_инициатива_награждается() {
        OptimizationDraft d = draft(List.of(1, 2, 3), List.of("Team-A"),
                List.of(task("T-A", "INI-1", false, 8, 30, 1),
                        task("T-B", "INI-1", false, 5, 20, 2)), List.of(),
                List.of(), List.of(part("T-A", 1, 8, 1), part("T-B", 1, 5, 2)), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::initiativeCompletedReward)
                .givenSolution(d).rewardsWith(OptimizationConstraintProvider.WEIGHT_INITIATIVE);
    }

    @Test
    void частично_размещенная_инициатива_без_награды() {
        OptimizationDraft d = draft(List.of(1, 2), List.of("Team-A"),
                List.of(task("T-A", "INI-1", false, 8, 30, 1),
                        task("T-B", "INI-1", false, 5, 20, 2)), List.of(),
                List.of(), List.of(part("T-A", 1, 8, 1)), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::initiativeCompletedReward)
                .givenSolution(d).hasNoImpact();
    }

    @Test
    void неразмещенная_часть_штрафует_незакрытые_часы() {
        TaskPartAssignment unplaced = part("T-A", 1, 8, 1);
        unplaced.setSprint(null);
        OptimizationDraft d = draft(List.of(1, 2), List.of("Team-A"),
                List.of(task("T-A", "INI-1", false, 8, 8, 1)), List.of(),
                List.of(), List.of(unplaced), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::unclosedRoleHoursPenalty)
                .givenSolution(d).penalizesBy((long) Math.round(8 * OptimizationConstraintProvider.WEIGHT_UNCLOSED_HH));
    }

    @Test
    void порядок_priority_соблюден_не_штрафуется() {
        OptimizationDraft d = draft(List.of(1, 2, 3), List.of("Team-A"),
                List.of(task("T-A", "INI-1", false, 5, 20, 1),
                        task("T-B", "INI-2", false, 5, 20, 3)), List.of(),
                List.of(), List.of(part("T-A", 1, 5, 1), part("T-B", 1, 5, 2)), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::priorityOrderPenalty)
                .givenSolution(d).hasNoImpact();
    }

    @Test
    void менее_приоритетная_задача_раньше_штрафуется() {
        OptimizationDraft d = draft(List.of(1, 2, 3), List.of("Team-A"),
                List.of(task("T-A", "INI-1", false, 5, 20, 3),
                        task("T-B", "INI-2", false, 5, 20, 1)), List.of(),
                List.of(), List.of(part("T-A", 1, 5, 1), part("T-B", 1, 5, 2)), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::priorityOrderPenalty)
                .givenSolution(d).penalizesBy((3 - 1) * OptimizationConstraintProvider.WEIGHT_PRIORITY);
    }

    @Test
    void перенос_инженера_штрафуется_тяжело() {
        Engineer eng = new Engineer("ENG-1", "Team-A", "Dev", 1.0, false);
        StaffingMove move = new StaffingMove("ENG-1", "Team-A");
        move.setToTeamId("Team-B");
        OptimizationDraft d = draft(List.of(1), List.of("Team-A", "Team-B"),
                List.of(), List.of(eng), List.of(), List.of(), List.of(move));
        verifier.verifyThat(OptimizationConstraintProvider::staffingMovePenalty)
                .givenSolution(d).penalizesBy(OptimizationConstraintProvider.WEIGHT_MOVE);
    }

    @Test
    void перенос_в_свою_команду_не_штрафуется() {
        Engineer eng = new Engineer("ENG-1", "Team-A", "Dev", 1.0, false);
        StaffingMove move = new StaffingMove("ENG-1", "Team-A");
        move.setToTeamId("Team-A");
        OptimizationDraft d = draft(List.of(1), List.of("Team-A"),
                List.of(), List.of(eng), List.of(), List.of(), List.of(move));
        verifier.verifyThat(OptimizationConstraintProvider::staffingMovePenalty)
                .givenSolution(d).hasNoImpact();
    }

    @Test
    void недогруженная_команда_штрафуется() {
        OptimizationDraft d = draft(List.of(1, 2), List.of("Team-A"),
                List.of(task("T-A", "INI-1", false, 40, 100, 1)), List.of(),
                List.of(new TeamVelocity("Team-A", 100)), List.of(part("T-A", 1, 40, 1)), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::teamUtilizationPenalty)
                .givenSolution(d).penalizesBy(
                        (long) (Math.round(OptimizationConstraintProvider.PI_MIN_UTILIZATION * 100) - 40)
                                * OptimizationConstraintProvider.WEIGHT_UTILIZATION);
    }

    @Test
    void загруженная_по_PI_норме_команда_не_штрафуется() {
        OptimizationDraft d = draft(List.of(1, 2), List.of("Team-A"),
                List.of(task("T-A", "INI-1", false, 60, 100, 1)), List.of(),
                List.of(new TeamVelocity("Team-A", 100)), List.of(part("T-A", 1, 60, 1)), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::teamUtilizationPenalty)
                .givenSolution(d).hasNoImpact();
    }
}