package com.postcode.optimizer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.postcode.optimizer.api.SolveResponse;
import com.postcode.optimizer.config.OptimizerConfig;
import com.postcode.optimizer.service.SolveService;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/**
 * Сайдкар-сервис оптимизации (change 018): HTTP-гейт к Timefold Solver.
 * Health (1.1); solve-контракт (1.4): POST /solve — снапшот → черновик + score.
 */
public final class OptimizerApplication {

    private static final byte[] OK_STATUS = "{\"status\":\"ok\"}".getBytes(StandardCharsets.UTF_8);

    public static void main(String[] args) throws IOException {
        OptimizerConfig config = OptimizerConfig.fromEnv();
        ObjectMapper mapper = new ObjectMapper()
                .enable(SerializationFeature.INDENT_OUTPUT)
                .findAndRegisterModules();
        SolveService solveService = new SolveService(config, mapper);

        HttpServer server = HttpServer.create(new InetSocketAddress(config.port()), 0);
        server.createContext("/health", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, OK_STATUS.length);
            exchange.getResponseBody().write(OK_STATUS);
            exchange.close();
        });
        server.createContext("/solve", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            try {
                SolveResponse response = solveService.solve(body);
                byte[] out = mapper.writeValueAsBytes(response);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, out.length);
                exchange.getResponseBody().write(out);
            } catch (IllegalArgumentException e) {
                byte[] out = "{\"error\":\"invalid snapshot\"}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(400, out.length);
                exchange.getResponseBody().write(out);
            } catch (Exception e) {
                byte[] out = "{\"error\":\"internal\"}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(500, out.length);
                exchange.getResponseBody().write(out);
            } finally {
                exchange.close();
            }
        });
        server.start();
    }
}