import { describe, expect, it } from "vitest";
import { AppError } from "../../../src/contracts/errors.js";
import { readServerConfig } from "../../../src/server/platform/server-config.js";

describe("readServerConfig", () => {
  it("uses safe defaults when environment variables are omitted", () => {
    const config = readServerConfig({});
    expect(config).toEqual({
      nodeEnv: "development",
      port: 3000,
      origin: "http://localhost:3000",
    });
  });

  it("parses valid custom environment configuration", () => {
    const config = readServerConfig({
      NODE_ENV: "production",
      PORT: "8080",
      APP_ORIGIN: "https://spark.example.com",
    });
    expect(config).toEqual({
      nodeEnv: "production",
      port: 8080,
      origin: "https://spark.example.com",
    });
  });

  it("normalizes origin trailing slash to URL origin", () => {
    const config = readServerConfig({
      APP_ORIGIN: "https://spark.example.com/",
    });
    expect(config.origin).toBe("https://spark.example.com");
  });

  it("defaults origin to configured custom port", () => {
    const config = readServerConfig({
      PORT: "4000",
    });
    expect(config.origin).toBe("http://localhost:4000");
  });

  it("accepts boundary ports 1 and 65535", () => {
    expect(readServerConfig({ PORT: "1" }).port).toBe(1);
    expect(readServerConfig({ PORT: "65535" }).port).toBe(65535);
  });

  it.each([
    ["blank", "  "],
    ["letters", "abc"],
    ["hexadecimal", "0x1f"],
    ["fractional", "3000.5"],
    ["zero", "0"],
    ["negative", "-1"],
    ["too large", "65536"],
  ])("rejects invalid port (%s) with 503 and safe message", (_, invalidPort) => {
    expect(() => readServerConfig({ PORT: invalidPort })).toThrow(AppError);
    try {
      readServerConfig({ PORT: invalidPort });
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(503);
      expect(appErr.code).toBe("SERVICE_UNAVAILABLE");
      expect(appErr.message).toContain("PORT");
      if (invalidPort.trim().length > 0) {
        expect(appErr.message).not.toContain(invalidPort.trim());
      }
    }
  });

  it.each([
    ["pathname", "https://spark.example.com/api"],
    ["credentials", "https://user:pass@spark.example.com"],
    ["query", "https://spark.example.com?token=secret123"],
    ["hash", "https://spark.example.com#section"],
    ["websocket", "ws://spark.example.com"],
    ["ftp", "ftp://spark.example.com"],
  ])("rejects invalid origin (%s) with 503 and safe message", (_, invalidOrigin) => {
    expect(() => readServerConfig({ APP_ORIGIN: invalidOrigin })).toThrow(AppError);
    try {
      readServerConfig({ APP_ORIGIN: invalidOrigin });
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(503);
      expect(appErr.code).toBe("SERVICE_UNAVAILABLE");
      expect(appErr.message).toContain("APP_ORIGIN");
      expect(appErr.message).not.toContain("secret123");
    }
  });

  it("rejects invalid NODE_ENV with 503 and safe message", () => {
    const invalidEnv = "staging_sensitive_word";
    expect(() => readServerConfig({ NODE_ENV: invalidEnv })).toThrow(AppError);
    try {
      readServerConfig({ NODE_ENV: invalidEnv });
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(503);
      expect(appErr.code).toBe("SERVICE_UNAVAILABLE");
      expect(appErr.message).toContain("NODE_ENV");
      expect(appErr.message).not.toContain(invalidEnv);
    }
  });
});
