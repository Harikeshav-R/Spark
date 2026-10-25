import { z } from "zod";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";

export interface ServerConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  origin: string;
}

const nodeEnvSchema = z.enum(["development", "test", "production"]);

const portStringSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^\d+$/)
  .transform((val) => Number.parseInt(val, 10))
  .pipe(z.number().int().min(1).max(65535));

function validateOrigin(originStr: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(originStr);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Protocol must be http or https");
  }

  if (parsedUrl.username !== "" || parsedUrl.password !== "") {
    throw new Error("Origin must not contain credentials");
  }

  if (parsedUrl.pathname !== "" && parsedUrl.pathname !== "/") {
    throw new Error("Origin must not contain pathname");
  }

  if (parsedUrl.search !== "") {
    throw new Error("Origin must not contain query");
  }

  if (parsedUrl.hash !== "") {
    throw new Error("Origin must not contain hash");
  }

  return parsedUrl.origin;
}

export function readServerConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ServerConfig {
  const invalidVars: string[] = [];

  const rawNodeEnv = env.NODE_ENV ?? "development";
  const parsedNodeEnv = nodeEnvSchema.safeParse(rawNodeEnv);
  if (!parsedNodeEnv.success) {
    invalidVars.push("NODE_ENV");
  }

  let resolvedPort = 3000;
  if (env.PORT !== undefined) {
    const parsedPort = portStringSchema.safeParse(env.PORT);
    if (!parsedPort.success) {
      invalidVars.push("PORT");
    } else {
      resolvedPort = parsedPort.data;
    }
  }

  let resolvedOrigin = `http://localhost:${resolvedPort}`;
  if (env.APP_ORIGIN !== undefined) {
    try {
      resolvedOrigin = validateOrigin(env.APP_ORIGIN);
    } catch {
      invalidVars.push("APP_ORIGIN");
    }
  }

  if (invalidVars.length > 0) {
    throw new AppError({
      code: DomainErrorCode.SERVICE_UNAVAILABLE,
      statusCode: 503,
      message: `Invalid server configuration: ${invalidVars.join(", ")}`,
    });
  }

  return {
    nodeEnv: parsedNodeEnv.data as "development" | "test" | "production",
    port: resolvedPort,
    origin: resolvedOrigin,
  };
}
