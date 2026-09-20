package com.postcode.optimizer.service;

import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;

import java.util.function.Function;

/** Провайдер ровно одного ограничения: текущее выбирается из {@link #CURRENT}, задаётся перед подсчётом. */
public final class ConstraintBreakdownProvider implements ConstraintProvider {

    public static final ThreadLocal<Function<ConstraintFactory, Constraint>> CURRENT = new ThreadLocal<>();

    @Override
    public Constraint[] defineConstraints(ConstraintFactory factory) {
        return new Constraint[]{CURRENT.get().apply(factory)};
    }
}