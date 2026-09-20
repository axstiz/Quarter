package com.postcode.optimizer;

import com.postcode.optimizer.config.OptimizerConfig;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/**
 * Сайдкар-сервис оптимизации (change 018): HTTP-гейт к Timefold Solver.
 * Скелет (задача 1.1): health-эндпоинт; solve-контракт — задача 1.4.
 */
public final class OptimizerApplication {

    public static void main(String[] args) throws IOException {
        OptimizerConfig config = OptimizerConfig.fromEnv();
        HttpServer server = HttpServer.create(new InetSocketAddress(config.port()), 0);
        server.createContext("/health", exchange -> {
            byte[] body = "{\"status\":\"ok\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.createContext("/solve", exchange -> {
            byte[] body = "{\"error\":\"solve-контракт реализуется в задаче 1.4\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(501, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
    }
}
