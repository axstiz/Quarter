package com.postcode.optimizer.config;

/** Конфигурация optimizer (spec architecture «Конфигурация оптимизатора»): seed, лимиты, порог — из env. */
public record OptimizerConfig(int port, long seed, int timeLimitSeconds,
                              int unimprovedLimitSeconds, double staffingGainThreshold) {

    public static OptimizerConfig fromEnv() {
        int timeLimit = Integer.parseInt(env("OPTIMIZER_TIME_LIMIT_SECONDS", "30"));
        return new OptimizerConfig(
                Integer.parseInt(env("OPTIMIZER_PORT", "8080")),
                Long.parseLong(env("OPTIMIZER_SEED", "42")),
                timeLimit,
                Integer.parseInt(env("OPTIMIZER_UNIMPROVED_LIMIT_SECONDS",
                        String.valueOf(Math.min(timeLimit, 30)))),
                Double.parseDouble(env("OPTIMIZER_STAFFING_GAIN_THRESHOLD", "0.05")));
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
