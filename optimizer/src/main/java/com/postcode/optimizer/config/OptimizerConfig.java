package com.postcode.optimizer.config;

/** Конфигурация optimizer (spec architecture «Конфигурация оптимизатора»): seed, лимиты, порог — из env. */
public record OptimizerConfig(int port, long seed, int timeLimitSeconds, double staffingGainThreshold) {

    public static OptimizerConfig fromEnv() {
        return new OptimizerConfig(
                Integer.parseInt(env("OPTIMIZER_PORT", "8080")),
                Long.parseLong(env("OPTIMIZER_SEED", "42")),
                Integer.parseInt(env("OPTIMIZER_TIME_LIMIT_SECONDS", "30")),
                Double.parseDouble(env("OPTIMIZER_STAFFING_GAIN_THRESHOLD", "0.05")));
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
