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

/** Score-тесты hard-ограничений (change 018, задача 1.2): ёмкость, роли, зависимости, единственный носитель. */
class OptimizationConstraintProviderTest {

    private final ConstraintVerifier<OptimizationConstraintProvider, OptimizationDraft> verifier =
            build(new OptimizationConstraintProvider(), OptimizationDraft.class,
                    TaskPartAssignment.class, StaffingMove.class);

    private static OptimizationDraft draft(List<Integer> sprints, List<String> teamIds,
                                           List<ProjectTask> tasks, List<TaskDependency> dependencies,
                                           List<Engineer> engineers, List<RoleCapacity> roleCapacities,
                                           List<TeamVelocity> velocities,
                                           List<TaskPartAssignment> assignments, List<StaffingMove> moves) {
        return new OptimizationDraft(sprints, teamIds, tasks, dependencies, engineers, roleCapacities, velocities,
                assignments, moves);
    }

    private static TaskPartAssignment part(String taskId, int part, double sp, String teamId, int sprint,
                                           Map<String, Double> roleHours) {
        TaskPartAssignment a = new TaskPartAssignment(taskId + "#" + part, taskId, part, sp, roleHours);
        a.setTeamId(teamId);
        a.setSprint(sprint);
        return a;
    }

    @Test
    void team_sp_в_пределах_velocity_не_штрафуется() {
        OptimizationDraft d = draft(List.of(1, 2, 3, 4, 5, 6), List.of("Team-A"),
                List.of(), List.of(), List.of(), List.of(), List.of(new TeamVelocity("Team-A", 100)),
                List.of(part("T-1", 1, 30, "Team-A", 1, Map.of())), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::teamSpCapacity)
                .givenSolution(d).hasNoImpact();
    }

    @Test
    void team_sp_превышает_velocity_на_10_штраф_10() {
        OptimizationDraft d = draft(List.of(1, 2, 3, 4, 5, 6), List.of("Team-A"),
                List.of(), List.of(), List.of(), List.of(), List.of(new TeamVelocity("Team-A", 100)),
                List.of(part("T-1", 1, 90, "Team-A", 1, Map.of())), List.of());
        verifier.verifyThat(OptimizationConstraintProvider::teamSpCapacity)
                .givenSolution(d).penalizes(10);
    }

    @Test
    void role_hours_в_пределах_лимита_не_штрафуются() {
        OptimizationDraft d = draft(List.of(1, 2), List.of("Team-A"),
                List.of(), List.of(), List.of(new Engineer("ENG-1", "Team-A", "Dev", 1.0, false)),
                List.of(new RoleCapacity("Dev", 80)),
                List.of(),
                List.of(part("T-1", 1, 10, "Team-A", 1, Map.of("Dev", 50.0)),
                        part("T-2", 1, 10, "Team-A", 1, Map.of("Dev", 30.0))),
                List.of());
        verifier.verifyThat(OptimizationConstraintProvider::roleHoursCapacity)
                .givenSolution(d).hasNoImpact();
    }

    @Test
    void role_hours_перегруз_на_10_штраф_10() {
        OptimizationDraft d = draft(List.of(1, 2), List.of("Team-A"),
                List.of(), List.of(), List.of(new Engineer("ENG-1", "Team-A", "Dev", 1.0, false)),
                List.of(new RoleCapacity("Dev", 80)),
                List.of(),
                List.of(part("T-1", 1, 10, "Team-A", 1, Map.of("Dev", 50.0)),
                        part("T-2", 1, 10, "Team-A", 1, Map.of("Dev", 40.0))),
                List.of());
        verifier.verifyThat(OptimizationConstraintProvider::roleHoursCapacity)
                .givenSolution(d).penalizes(10);
    }

    @Test
    void роль_без_носителей_лимит_80_часов_виртуального_держателя() {
        OptimizationDraft d = draft(List.of(1), List.of("Team-A"),
                List.of(), List.of(), List.of(),
                List.of(new RoleCapacity("Аналитик", 80)),
                List.of(),
                List.of(part("T-1", 1, 10, "Team-A", 1, Map.of("Аналитик", 100.0))),
                List.of());
        verifier.verifyThat(OptimizationConstraintProvider::roleHoursCapacity)
                .givenSolution(d).penalizes(20);
    }

    @Test
    void зависимость_соблюдена_не_штрафуется() {
        OptimizationDraft d = draft(List.of(1, 2, 3, 4), List.of("Team-A"),
                List.of(), List.of(new TaskDependency("T-A", "T-B")), List.of(), List.of(), List.of(),
                List.of(part("T-A", 1, 10, "Team-A", 2, Map.of()),
                        part("T-B", 1, 10, "Team-A", 3, Map.of())),
                List.of());
        verifier.verifyThat(OptimizationConstraintProvider::dependencyAfterBlocker)
                .givenSolution(d).hasNoImpact();
    }

    @Test
    void блокирующая_часть_позже_зависимой_штраф() {
        OptimizationDraft d = draft(List.of(1, 2, 3, 4), List.of("Team-A"),
                List.of(), List.of(new TaskDependency("T-A", "T-B")), List.of(), List.of(), List.of(),
                List.of(part("T-A", 1, 10, "Team-A", 3, Map.of()),
                        part("T-B", 1, 10, "Team-A", 1, Map.of())),
                List.of());
        verifier.verifyThat(OptimizationConstraintProvider::dependencyAfterBlocker)
                .givenSolution(d).penalizes(3);
    }

    @Test
    void перенос_единственного_носителя_штраф() {
        Engineer sole = new Engineer("ENG-1", "Team-A", "Dev", 1.0, true);
        StaffingMove move = new StaffingMove("ENG-1", "Team-A");
        move.setToTeamId("Team-B");
        OptimizationDraft d = draft(List.of(1), List.of("Team-A", "Team-B"),
                List.of(), List.of(), List.of(sole), List.of(), List.of(),
                List.of(), List.of(move));
        verifier.verifyThat(OptimizationConstraintProvider::soleHolderNotMoved)
                .givenSolution(d).penalizes(1);
    }

    @Test
    void перенос_без_смены_команды_не_штраф() {
        Engineer eng = new Engineer("ENG-1", "Team-A", "Dev", 1.0, false);
        StaffingMove move = new StaffingMove("ENG-1", "Team-A");
        move.setToTeamId("Team-A");
        OptimizationDraft d = draft(List.of(1), List.of("Team-A"),
                List.of(), List.of(), List.of(eng), List.of(), List.of(),
                List.of(), List.of(move));
        verifier.verifyThat(OptimizationConstraintProvider::soleHolderNotMoved)
                .givenSolution(d).hasNoImpact();
    }

    @Test
    void перенос_обычного_инженера_не_штраф() {
        Engineer eng = new Engineer("ENG-1", "Team-A", "Dev", 1.0, false);
        StaffingMove move = new StaffingMove("ENG-1", "Team-A");
        move.setToTeamId("Team-B");
        OptimizationDraft d = draft(List.of(1), List.of("Team-A", "Team-B"),
                List.of(), List.of(), List.of(eng), List.of(), List.of(),
                List.of(), List.of(move));
        verifier.verifyThat(OptimizationConstraintProvider::soleHolderNotMoved)
                .givenSolution(d).hasNoImpact();
    }
}