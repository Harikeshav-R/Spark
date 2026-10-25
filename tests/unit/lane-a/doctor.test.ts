import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../../../scripts/doctor.js";

const VALID_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("scripts/doctor", () => {
  it("passes when all services and configurations are valid", async () => {
    const { promise: serverReady, resolve: resolveReady } = Promise.withResolvers<void>();
    const stubServer = http.createServer((req, res) => {
      if (req.url === "/auth/v1/health" || req.url === "/rest/v1/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    stubServer.listen(0, "127.0.0.1", () => resolveReady());
    await serverReady;

    const stubPort = (stubServer.address() as AddressInfo).port;
    const testPort = stubPort + 10;

    try {
      await expect(
        runDoctor({
          NODE_ENV: "test",
          PORT: String(testPort),
          APP_ORIGIN: `http://localhost:${testPort}`,
          SUPABASE_URL: `http://127.0.0.1:${stubPort}`,
          SUPABASE_ANON_KEY: "anon-key-123",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key-456",
          CREDENTIAL_ENCRYPTION_KEY: VALID_KEY,
          INTEGRATION_MODE: "fixture",
          LECTURE_SOURCE: "simulator",
        })
      ).resolves.toBeUndefined();
    } finally {
      const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
      stubServer.close(() => resolveClose());
      await closePromise;
    }
  });

  it("fails when configured PORT is already occupied", async () => {
    const occupiedServer = net.createServer();
    const { promise: readyPromise, resolve: resolveReady } = Promise.withResolvers<void>();
    occupiedServer.listen(0, "0.0.0.0", () => resolveReady());
    await readyPromise;

    const occupiedPort = (occupiedServer.address() as AddressInfo).port;

    try {
      await expect(
        runDoctor({
          NODE_ENV: "test",
          PORT: String(occupiedPort),
          APP_ORIGIN: `http://localhost:${occupiedPort}`,
          SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_ANON_KEY: "anon-key-123",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key-456",
          CREDENTIAL_ENCRYPTION_KEY: VALID_KEY,
          INTEGRATION_MODE: "fixture",
          LECTURE_SOURCE: "simulator",
        })
      ).rejects.toThrow(/PORT is unavailable/);
    } finally {
      const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
      occupiedServer.close(() => resolveClose());
      await closePromise;
    }
  });

  it("fails when Supabase auth health returns non-2xx status", async () => {
    const { promise: serverReady, resolve: resolveReady } = Promise.withResolvers<void>();
    const stubServer = http.createServer((req, res) => {
      if (req.url === "/auth/v1/health") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unavailable" }));
      } else {
        res.writeHead(200);
        res.end();
      }
    });

    stubServer.listen(0, "127.0.0.1", () => resolveReady());
    await serverReady;

    const stubPort = (stubServer.address() as AddressInfo).port;
    const testPort = stubPort + 20;

    try {
      await expect(
        runDoctor({
          NODE_ENV: "test",
          PORT: String(testPort),
          APP_ORIGIN: `http://localhost:${testPort}`,
          SUPABASE_URL: `http://127.0.0.1:${stubPort}`,
          SUPABASE_ANON_KEY: "anon-key-123",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key-456",
          CREDENTIAL_ENCRYPTION_KEY: VALID_KEY,
          INTEGRATION_MODE: "fixture",
          LECTURE_SOURCE: "simulator",
        })
      ).rejects.toThrow(/auth\/v1\/health/);
    } finally {
      const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
      stubServer.close(() => resolveClose());
      await closePromise;
    }
  });

  it("fails when live integration mode is missing live credentials without leaking secret values", async () => {
    const SENTINEL_SECRET = "super_secret_token_never_log_this";
    const unusedPort = 49150;

    await expect(
      runDoctor({
        NODE_ENV: "test",
        PORT: String(unusedPort),
        APP_ORIGIN: `http://localhost:${unusedPort}`,
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_ANON_KEY: "anon-key-123",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key-456",
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY,
        INTEGRATION_MODE: "live",
        LECTURE_SOURCE: "zoom",
        OPENROUTER_API_KEY: SENTINEL_SECRET,
        // Missing ZOOM_SECRET_TOKEN and ZOOM_REDIRECT_URI
      })
    ).rejects.toSatisfy((err: Error) => {
      expect(err.message).not.toContain(SENTINEL_SECRET);
      expect(err.message).toMatch(/ZOOM/);
      return true;
    });
  });

  it("fails when CREDENTIAL_ENCRYPTION_KEY is not 64 hex characters", async () => {
    const unusedPort = 49151;

    await expect(
      runDoctor({
        NODE_ENV: "test",
        PORT: String(unusedPort),
        APP_ORIGIN: `http://localhost:${unusedPort}`,
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_ANON_KEY: "anon-key-123",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key-456",
        CREDENTIAL_ENCRYPTION_KEY: "not-64-hex",
        INTEGRATION_MODE: "fixture",
        LECTURE_SOURCE: "simulator",
      })
    ).rejects.toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
  });
});
