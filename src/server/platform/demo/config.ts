import { execFileSync } from "node:child_process";
import { readServerConfig } from "../server-config.js";
import { AppError, DomainErrorCode } from "../../../contracts/errors.js";

export type DemoPersona = "teacher" | "hari" | "rahul" | "praj" | "vamshi";

export interface DemoConfig {
  origin: string;
  supabaseUrl: string;
  dbContainer: string;
  tickRateMs: number;
  autoRespond: boolean;
}

export function isLoopbackUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function detectDbContainer(envContainer?: string): string {
  if (envContainer && envContainer.trim() !== "") {
    return envContainer.trim();
  }
  try {
    execFileSync("docker", ["inspect", "supabase_db_spark"], { stdio: "ignore" });
    return "supabase_db_spark";
  } catch {
    return "supabase_db_HackOHIO-2026";
  }
}

export function readDemoConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): DemoConfig {
  if (env.NODE_ENV === "production") {
    throw new AppError({
      code: DomainErrorCode.UNAUTHORIZED,
      statusCode: 403,
      message: "Demo features are strictly prohibited in production environment",
    });
  }

  const serverConfig = readServerConfig(env);
  if (!isLoopbackUrl(serverConfig.origin)) {
    throw new AppError({
      code: DomainErrorCode.VALIDATION_ERROR,
      statusCode: 400,
      message: `Demo mode requires loopback origin, got: ${serverConfig.origin}`,
    });
  }

  const supabaseUrl = env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  if (!isLoopbackUrl(supabaseUrl)) {
    throw new AppError({
      code: DomainErrorCode.VALIDATION_ERROR,
      statusCode: 400,
      message: `Demo mode requires loopback Supabase URL, got: ${supabaseUrl}`,
    });
  }

  let tickRateMs = 4000;
  if (env.DEMO_TICK_RATE_MS !== undefined && env.DEMO_TICK_RATE_MS.trim() !== "") {
    const parsed = Number.parseInt(env.DEMO_TICK_RATE_MS, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || !/^\d+$/.test(env.DEMO_TICK_RATE_MS.trim())) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: `DEMO_TICK_RATE_MS must be a positive finite integer, got: ${env.DEMO_TICK_RATE_MS}`,
      });
    }
    tickRateMs = parsed;
  }

  const autoRespond = env.DEMO_AUTO_RESPOND === "true";
  const dbContainer = detectDbContainer(env.SUPABASE_DB_CONTAINER);

  return {
    origin: serverConfig.origin,
    supabaseUrl,
    dbContainer,
    tickRateMs,
    autoRespond,
  };
}
