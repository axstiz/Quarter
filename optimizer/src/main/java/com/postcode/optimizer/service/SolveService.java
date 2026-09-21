package com.postcode.optimizer.service;

import ai.timefold.solver.core.api.score.HardSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.solver.Solver;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier;
import ai.timefold.solver.core.config.solver.SolverConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.postcode.optimizer.api.SolveRequest;
import com.postcode.optimizer.api.SolveResponse;
import com.postcode.optimizer.config.OptimizerConfig;
import com.postcode.optimizer.domain.Engineer;
import com.postcode.optimizer.domain.ProjectTask;
import com.postcode.optimizer.domain.OptimizationDraft;
import com.postcode.optimizer.domain.RoleCapacity;
import com.postcode.optimizer.domain.StaffingMove;
import com.postcode.optimizer.domain.TaskDependency;
import com.postcode.optimizer.domain.TaskPartAssignment;
import com.postcode.optimizer.domain.TeamVelocity;
import com.postcode.optimizer.score.OptimizationConstraintProvider;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/** POST /solve: снапшот → OptimizationDraft → Timefold Solver → черновик + score (+ разбивка по ограничениям). */
public class SolveService {

    private static final double FULL_TIME_HOURS = 80;

    private final OptimizerConfig config;
    private final ObjectMapper mapper;
    private final SolverFactory<OptimizationDraft> solverFactory;
    private final SolutionManager<OptimizationDraft, HardSoftScore> solutionManager;
    private final ConstraintVerifier<ConstraintBreakdownProvider, OptimizationDraft> verifier;

    public SolveService(OptimizerConfig config, ObjectMapper mapper) {
        this.config = config;
        this.mapper = mapper;
        SolverConfig solverConfig = new SolverConfig()
                .withSolutionClass(OptimizationDraft.class)
                .withEntityClasses(TaskPartAssignment.class, StaffingMove.class)
                .withConstraintProviderClass(OptimizationConstraintProvider.class)
                .withRandomSeed(config.seed())
                .withTerminationSpentLimit(Duration.ofSeconds(config.timeLimitSeconds()))
                .withTerminationUnimprovedSpentLimit(
                        Duration.ofSeconds(Math.min(config.timeLimitSeconds(), 5)));
        this.solverFactory = SolverFactory.create(solverConfig);
        this.solutionManager = SolutionManager.create(solverFactory);
        this.verifier = ConstraintVerifier.build(
                new ConstraintBreakdownProvider(), OptimizationDraft.class,
                TaskPartAssignment.class, StaffingMove.class);
    }

    public SolveResponse solve(String body) {
        try {
            SolveRequest request = mapper.readValue(body, SolveRequest.class);
            return solve(request);
        } catch (Exception e) {
            throw new IllegalArgumentException("невалидный снапшот: " + e.getMessage(), e);
        }
    }

    public SolveResponse solve(SolveRequest request) {
        OptimizationDraft draft = toDraft(request);
        long started = System.nanoTime();
        Solver<OptimizationDraft> solver = solverFactory.buildSolver();
        OptimizationDraft best = solver.solve(draft);
        long solveTimeMillis = (System.nanoTime() - started) / 1_000_000;

        List<StaffingMove> keptMoves = applyStaffingGainThreshold(best);
        OptimizationDraft finalDraft = withMoves(best, keptMoves);

        HardSoftScore score = solutionManager.update(finalDraft);
        return toResponse(finalDraft, score, constraintBreakdown(finalDraft), solveTimeMillis);
    }

    /** OSS-разбивка: вес каждого ограничения на финальном решении через одиночный провайдер. */
    private List<SolveResponse.ConstraintScoreOutput> constraintBreakdown(OptimizationDraft draft) {
        List<SolveResponse.ConstraintScoreOutput> breakdown = new ArrayList<>();
        for (Map.Entry<String, Function<ConstraintFactory, Constraint>> entry
                : OptimizationConstraintProvider.CONSTRAINT_FUNCTIONS.entrySet()) {
            ConstraintBreakdownProvider.CURRENT.set(entry.getValue());
            try {
                HardSoftScore impact = (HardSoftScore) verifier.verifyThat().givenSolution(draft).getScore();
                long value = impact.hardScore() != 0 ? impact.hardScore() : impact.softScore();
                breakdown.add(new SolveResponse.ConstraintScoreOutput(entry.getKey(), value));
            } finally {
                ConstraintBreakdownProvider.CURRENT.remove();
            }
        }
        return breakdown;
    }

    private OptimizationDraft toDraft(SolveRequest request) {
        Set<String> teamIds = new LinkedHashSet<>();
        if (request.teamVelocities() != null) {
            request.teamVelocities().forEach(t -> teamIds.add(t.teamId()));
        }
        if (request.engineers() != null) {
            request.engineers().forEach(e -> teamIds.add(e.teamId()));
        }
        if (request.tasks() != null) {
            request.tasks().forEach(t -> teamIds.add(t.teamId()));
        }

        List<TeamVelocity> velocities = new ArrayList<>();
        if (request.teamVelocities() != null) {
            request.teamVelocities().forEach(t -> velocities.add(new TeamVelocity(t.teamId(), t.velocity())));
        }

        List<ProjectTask> tasks = new ArrayList<>();
        List<TaskPartAssignment> assignments = new ArrayList<>();
        if (request.tasks() != null) {
            for (SolveRequest.TaskInput t : request.tasks()) {
                tasks.add(new ProjectTask(t.taskId(), t.parentId(), t.status(), t.teamId(), t.storyPoints(),
                        t.estimatedHh(), t.spentTime(), t.priority(), t.plannedInSprint()));
                if (t.parts() != null) {
                    for (SolveRequest.PartInput p : t.parts()) {
                        String partId = t.taskId() + "#" + p.part();
                        Map<String, Double> roleHours = p.roleHours() == null ? Map.of() : p.roleHours();
                        TaskPartAssignment a = new TaskPartAssignment(partId, t.taskId(), p.part(), p.storyPoints(),
                                roleHours);
                        a.setTeamId(t.teamId());
                        assignments.add(a);
                    }
                }
            }
        }

        List<TaskDependency> dependencies = new ArrayList<>();
        if (request.dependencies() != null) {
            request.dependencies()
                    .forEach(d -> dependencies.add(new TaskDependency(d.blockingTaskId(), d.blockedTaskId())));
        }

        List<Engineer> engineers = new ArrayList<>();
        List<StaffingMove> staffingMoves = new ArrayList<>();
        Set<String> staffingKeys = new HashSet<>();
        if (request.engineers() != null) {
            for (SolveRequest.EngineerInput e : request.engineers()) {
                engineers.add(new Engineer(e.engineerId(), e.teamId(), e.role(), e.capacityRate(),
                        e.soleHolderInTeam()));
                // @PlanningId должен быть уникален: инженер-совместитель (две записи по 0.5)
                // получает ОДИН StaffingMove (первая команда); дубль ключа валит инициализацию solver'а
                if (staffingKeys.add(e.engineerId())) {
                    staffingMoves.add(new StaffingMove(e.engineerId(), e.teamId()));
                }
            }
        }


        List<RoleCapacity> roleCapacities = roleCapacities(assignments, engineers);

        return new OptimizationDraft(
                request.sprints() == null ? List.of() : new ArrayList<>(request.sprints()),
                new ArrayList<>(teamIds),
                tasks, dependencies, engineers, roleCapacities, velocities,
                assignments, staffingMoves);
    }

    /** Лимит роли за спринт: сумма 80 ч × ставка носителей роли; нет носителей — виртуальный держатель 80 ч. */
    private List<RoleCapacity> roleCapacities(List<TaskPartAssignment> assignments, List<Engineer> engineers) {
        Set<String> roles = new LinkedHashSet<>();
        assignments.forEach(a -> roles.addAll(a.getRoleHours().keySet()));
        List<RoleCapacity> result = new ArrayList<>();
        for (String role : roles) {
            double capacity = 0;
            for (Engineer e : engineers) {
                if (role.equals(e.getRole())) {
                    capacity += FULL_TIME_HOURS * e.getCapacityRate();
                }
            }
            result.add(new RoleCapacity(role, capacity > 0 ? capacity : FULL_TIME_HOURS));
        }
        return result;
    }

    /** Порог прироста для переноса: перенос включается, только если улучшает soft-score больше порога. */
    private List<StaffingMove> applyStaffingGainThreshold(OptimizationDraft best) {
        HardSoftScore scoreWithMoves = solutionManager.update(best);
        List<StaffingMove> moves = best.getStaffingMoves();
        List<StaffingMove> kept = new ArrayList<>(moves.size());
        for (int i = 0; i < moves.size(); i++) {
            StaffingMove move = moves.get(i);
            if (move.getToTeamId() == null || move.getToTeamId().equals(move.getFromTeamId())) {
                kept.add(move);
                continue;
            }
            HardSoftScore scoreWithout = solutionManager.update(withMoves(best, i));
            long improvement = scoreWithMoves.softScore() - scoreWithout.softScore();
            if (improvement > config.staffingGainThreshold() * (1 + Math.abs(scoreWithMoves.softScore()))) {
                kept.add(move);
            } else {
                StaffingMove cleared = new StaffingMove(move.getEngineerId(), move.getFromTeamId());
                kept.add(cleared);
            }
        }
        return kept;
    }

    private SolveResponse toResponse(OptimizationDraft draft, HardSoftScore score,
                                     List<SolveResponse.ConstraintScoreOutput> breakdown, long solveTimeMillis) {
        List<SolveResponse.AssignmentOutput> assignments = new ArrayList<>();
        for (TaskPartAssignment a : draft.getAssignments()) {
            assignments.add(new SolveResponse.AssignmentOutput(a.getId(), a.getTaskId(), a.getPart(),
                    a.getSprint() == null ? 0 : a.getSprint(), a.getTeamId()));
        }
        List<SolveResponse.StaffingMoveOutput> moves = new ArrayList<>();
        for (StaffingMove m : draft.getStaffingMoves()) {
            moves.add(new SolveResponse.StaffingMoveOutput(m.getEngineerId(), m.getFromTeamId(), m.getToTeamId()));
        }
        return new SolveResponse(
                assignments, moves,
                new SolveResponse.ScoreOutput(score.hardScore(), score.softScore()),
                breakdown, solveTimeMillis, config.seed());
    }

    private OptimizationDraft withMoves(OptimizationDraft draft, List<StaffingMove> moveOverrides) {
        List<StaffingMove> moves = new ArrayList<>(moveOverrides.size());
        for (int i = 0; i < draft.getStaffingMoves().size(); i++) {
            moves.add(i < moveOverrides.size() ? moveOverrides.get(i) : draft.getStaffingMoves().get(i));
        }
        return withMoves(draft, moves, -1);
    }

    private OptimizationDraft withMoves(OptimizationDraft draft, int clearedIndex) {
        List<StaffingMove> moves = new ArrayList<>(draft.getStaffingMoves().size());
        for (int i = 0; i < draft.getStaffingMoves().size(); i++) {
            StaffingMove m = draft.getStaffingMoves().get(i);
            if (i == clearedIndex) {
                moves.add(new StaffingMove(m.getEngineerId(), m.getFromTeamId()));
            } else {
                moves.add(m);
            }
        }
        return withMoves(draft, moves, -1);
    }

    private OptimizationDraft withMoves(OptimizationDraft draft, List<StaffingMove> moves, int ignored) {
        return new OptimizationDraft(
                draft.getSprints(), draft.getTeamIds(), draft.getTasks(), draft.getDependencies(),
                draft.getEngineers(), draft.getRoleCapacities(), draft.getTeamVelocities(),
                draft.getAssignments(), moves);
    }
}