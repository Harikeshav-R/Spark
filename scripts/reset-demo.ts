import "dotenv/config";
import { z } from "zod";
import { readDemoConfig } from "../src/server/platform/demo/config.js";
import { DEMO_PASSWORD } from "../src/server/platform/demo/dataset.js";
import { resetDemoDatabase, type DemoSeedResult } from "../src/server/platform/demo/seed-store.js";

const loginResponseSchema = z.object({
  session: z.object({
    access_token: z.string().min(1),
  }),
});

const demoSeedResultSchema = z.object({
  courseId: z.string().uuid(),
  conceptCount: z.number().int(),
  edgeCount: z.number().int(),
  studentCount: z.number().int(),
  masteryCount: z.number().int(),
  elapsedMs: z.number().int(),
});
async function main(): Promise<void> {
  const cliStartTime = performance.now();
  let result: DemoSeedResult;

  try {
    const config = readDemoConfig(process.env);
    let isServerRunning = false;

    try {
      const healthRes = await fetch(`${config.origin}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (healthRes.ok) {
        isServerRunning = true;
      } else {
        throw new Error(`Health check returned unexpected status ${healthRes.status}`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isConnRefused =
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("fetch failed") ||
        (err as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED";

      if (isConnRefused) {
        isServerRunning = false;
      } else {
        throw new Error(`Failed to check server health: ${errorMsg}`, { cause: err });
      }
    }

    if (isServerRunning) {
      // 1. Authenticate as Prof. Sarah Chen
      const loginRes = await fetch(`${config.origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "sarah.chen@example.test",
          password: DEMO_PASSWORD,
        }),
      });

      const rawLoginData: unknown = await loginRes.json();
      const parsedLogin = loginResponseSchema.safeParse(rawLoginData);
      if (!parsedLogin.success) {
        throw new Error("Login response did not contain valid access token");
      }
      const token = parsedLogin.data.session.access_token;

      // 2. Call authenticated /api/demo/reset
      const resetRes = await fetch(`${config.origin}/api/demo/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (!resetRes.ok) {
        const body = await resetRes.text();
        throw new Error(`Server demo reset failed (${resetRes.status}): ${body}`);
      }

      const rawResetData: unknown = await resetRes.json();
      const parsedResult = demoSeedResultSchema.safeParse(rawResetData);
      if (!parsedResult.success) {
        throw new Error("Server demo reset returned invalid result shape");
      }
      result = parsedResult.data;
    } else {
      // Offline fallback when server refused connection
      result = await resetDemoDatabase(process.env);
    }

    const totalElapsedMs = Math.round(performance.now() - cliStartTime);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          courseId: result.courseId,
          conceptCount: result.conceptCount,
          edgeCount: result.edgeCount,
          studentCount: result.studentCount,
          masteryCount: result.masteryCount,
          elapsedMs: totalElapsedMs,
        },
        null,
        2,
      ),
    );

    if (totalElapsedMs >= 2000) {
      console.error(`Timing assertion failed: total reset time ${totalElapsedMs}ms >= 2000ms limit`);
      process.exit(1);
    }

    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify(
        {
          status: "error",
          message,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

void main();
