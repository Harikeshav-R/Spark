import "dotenv/config";
import { z } from "zod";
import { readDemoConfig } from "../src/server/platform/demo/config.js";
import {
  DEMO_PASSWORD,
  DEFAULT_DEMO_NAMESPACE,
} from "../src/server/platform/demo/dataset.js";
import { seedDemoDatabase } from "../src/server/platform/demo/seed-store.js";
import { startServer, type ServerInstance } from "../server/index.js";
import { FIXTURE_COURSE_ID } from "../src/server/ai/index.js";
import { courseGraphResponseSchema } from "../src/contracts/course.js";

interface CliOptions {
  mode: "fixture" | "live";
  seed: 42;
  serve: boolean;
}

function parseCliArgs(args: string[]): CliOptions {
  let mode: "fixture" | "live" = "fixture";
  let seed = 42 as const;
  let serve = false;

  for (const arg of args) {
    if (arg === "--serve") {
      serve = true;
    } else if (arg.startsWith("--mode=")) {
      const val = arg.slice("--mode=".length);
      if (val !== "fixture" && val !== "live") {
        throw new Error(`Invalid --mode value '${val}'. Expected 'fixture' or 'live'.`);
      }
      mode = val;
    } else if (arg.startsWith("--seed=")) {
      const val = Number.parseInt(arg.slice("--seed=".length), 10);
      if (val !== 42) {
        throw new Error(`Invalid --seed value '${val}'. Only canonical seed 42 is supported.`);
      }
      seed = 42;
    } else {
      throw new Error(`Unknown CLI argument '${arg}'. Supported: --mode=fixture|live, --seed=42, --serve.`);
    }
  }

  return { mode, seed, serve };
}

const loginResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: z.enum(["teacher", "student"]),
  }),
  session: z.object({
    accessToken: z.string(),
  }),
});

const meResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["teacher", "student"]),
  enrollments: z
    .array(
      z.object({
        courseId: z.string(),
        studentId: z.string(),
      }),
    )
    .optional(),
});

const gameSummarySchema = z.object({
  studentId: z.string().uuid(),
  courseId: z.string().uuid(),
  xp: z.number().int(),
  streakDays: z.number().int(),
  skyBrightness: z.number(),
  form: z.enum(["ember", "spark", "glow", "nova"]),
  formProgress: z.number(),
});


const lectureCreatedSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string(),
  status: z.literal("live"),
});

const speechResponseSchema = z.object({
  lectureId: z.string(),
  playing: z.boolean(),
  speed: z.number(),
  nextIndex: z.number(),
  total: z.number(),
});

const pollResponseCountSchema = z.object({
  submitted: z.array(z.string()),
});

const instantMatchSchema = z.object({
  matchId: z.string().uuid(),
});

const demoResetSchema = z.object({
  courseId: z.string(),
  conceptCount: z.number(),
  edgeCount: z.number(),
  studentCount: z.number(),
  masteryCount: z.number(),
  elapsedMs: z.number(),
});

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  let ownedServer: ServerInstance | null = null;

  try {
    process.env.DEMO_MODE = "true";
    process.env.LECTURE_SOURCE = "simulator";
    process.env.INTEGRATION_MODE = options.mode;

    const config = readDemoConfig(process.env);

    // 1. Seed database
    const seedResult = await seedDemoDatabase(process.env, new Date(), DEFAULT_DEMO_NAMESPACE);

    // 2. Check if server already running
    let isServerRunning = false;
    try {
      const healthRes = await fetch(`${config.origin}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (healthRes.ok) {
        isServerRunning = true;
      }
    } catch {
      isServerRunning = false;
    }

    if (!isServerRunning) {
      ownedServer = await startServer();
    }

    if (options.serve) {
      console.log(`Spark interactive demo stack running at ${config.origin}`);
      console.log("Demo Accounts (password: DemoPass123!):");
      console.log("  - Prof. Sarah Chen: sarah.chen@example.test");
      console.log("  - Hari: hari@example.test");
      console.log("  - Rahul: rahul@example.test");
      console.log("  - Praj: praj@example.test");
      console.log("  - Vamshi: vamshi@example.test");
      console.log("Press Ctrl+C to terminate.");

      const { promise: shutdownPromise, resolve: shutdownResolve } = Promise.withResolvers<void>();
      process.on("SIGINT", () => shutdownResolve());
      process.on("SIGTERM", () => shutdownResolve());
      await shutdownPromise;
      return;
    }

    // Finite smoke mode: exercise complete demo lifecycle
    const personas = [
      { key: "teacher", email: "sarah.chen@example.test" },
      { key: "hari", email: "hari@example.test" },
      { key: "rahul", email: "rahul@example.test" },
      { key: "praj", email: "praj@example.test" },
      { key: "vamshi", email: "vamshi@example.test" },
    ];

    const tokens: Record<string, string> = {};
    const studentIds: Record<string, string> = {};

    for (const p of personas) {
      const loginRes = await fetch(`${config.origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: p.email, password: DEMO_PASSWORD }),
      });
      if (!loginRes.ok) {
        throw new Error(`Login failed for ${p.email}: ${await loginRes.text()}`);
      }
      const loginData = loginResponseSchema.parse(await loginRes.json());
      tokens[p.key] = loginData.session.accessToken;

      const meRes = await fetch(`${config.origin}/api/auth/me`, {
        headers: { Authorization: `Bearer ${loginData.session.accessToken}` },
      });
      if (!meRes.ok) {
        throw new Error(`Failed to fetch /api/auth/me for ${p.email}`);
      }
      const meData = meResponseSchema.parse(await meRes.json());
      if (meData.role === "student") {
        const enrollment = meData.enrollments?.find((e) => e.courseId === FIXTURE_COURSE_ID);
        studentIds[p.key] = enrollment?.studentId ?? meData.id;
      }
    }

    // 3. Verify game baselines
    const expectedBaselines: Record<
      string,
      { form: string; mean: number; streak: number; xp: number }
    > = {
      hari: { form: "nova", mean: 0.82, streak: 4, xp: 620 },
      rahul: { form: "spark", mean: 0.38, streak: 3, xp: 508 },
      praj: { form: "glow", mean: 0.65, streak: 2, xp: 320 },
      vamshi: { form: "ember", mean: 0.0, streak: 0, xp: 0 },
    };

    for (const [stKey, exp] of Object.entries(expectedBaselines)) {
      const sId = studentIds[stKey]!;
      const gameRes = await fetch(
        `${config.origin}/api/students/${sId}/game-summary`,
        {
          headers: { Authorization: `Bearer ${tokens[stKey]}` },
        },
      );
      if (!gameRes.ok) {
        throw new Error(`Failed to fetch game summary for ${stKey}: ${await gameRes.text()}`);
      }
      const game = gameSummarySchema.parse(await gameRes.json());
      if (
        game.form !== exp.form ||
        Math.abs(game.skyBrightness - exp.mean) > 0.01 ||
        game.streakDays !== exp.streak ||
        game.xp !== exp.xp
      ) {
        throw new Error(
          `Baseline mismatch for ${stKey}: expected form=${exp.form}, mean=${exp.mean}, streak=${exp.streak}, xp=${exp.xp}. Got: form=${game.form}, mean=${game.skyBrightness}, streak=${game.streakDays}, xp=${game.xp}`,
        );
      }
    }

    // 4. Verify course graph
    const graphRes = await fetch(`${config.origin}/api/courses/${FIXTURE_COURSE_ID}/graph`, {
      headers: { Authorization: `Bearer ${tokens.teacher}` },
    });
    if (!graphRes.ok) {
      throw new Error(`Failed to fetch graph: ${await graphRes.text()}`);
    }
    const graphData = courseGraphResponseSchema.parse(await graphRes.json());
    if (graphData.nodes.length !== 33 || graphData.edges.length !== 34) {
      throw new Error(
        `Graph count mismatch: expected 33 nodes, 34 edges. Got ${graphData.nodes.length}, ${graphData.edges.length}`,
      );
    }

    // 5. Create live lecture
    const lectureRes = await fetch(`${config.origin}/api/courses/${FIXTURE_COURSE_ID}/lectures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.teacher}`,
      },
      body: JSON.stringify({ title: "CS229 Live Lecture: Optimization" }),
    });
    if (!lectureRes.ok) {
      throw new Error(`Failed to create lecture: ${await lectureRes.text()}`);
    }
    const lectureData = lectureCreatedSchema.parse(await lectureRes.json());

    // 6. Step simulated speech
    const speechRes = await fetch(`${config.origin}/api/demo/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.teacher}`,
      },
      body: JSON.stringify({
        lectureId: lectureData.id,
        action: "step",
      }),
    });
    if (!speechRes.ok) {
      throw new Error(`Failed to step speech: ${await speechRes.text()}`);
    }
    const speechData = speechResponseSchema.parse(await speechRes.json());
    if (speechData.nextIndex !== 1) {
      throw new Error(`Expected speech nextIndex=1, got ${speechData.nextIndex}`);
    }

    // 7. Generate and activate poll
    const pollGenRes = await fetch(
      `${config.origin}/api/lectures/${lectureData.id}/poll/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.teacher}`,
        },
        body: JSON.stringify({}),
      },
    );
    if (!pollGenRes.ok) {
      throw new Error(`Failed to generate poll: ${await pollGenRes.text()}`);
    }
    const rawDraft: unknown = await pollGenRes.json();
    const pollDraft = z.object({ id: z.string().uuid() }).parse(rawDraft);
    const pollId = pollDraft.id;

    const pollActRes = await fetch(`${config.origin}/api/polls/${pollId}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.teacher}` },
    });
    if (!pollActRes.ok) {
      throw new Error(`Failed to activate poll: ${await pollActRes.text()}`);
    }

    // 8. Submit simulated responses via demo helper
    const pollRespRes = await fetch(`${config.origin}/api/demo/poll-responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.teacher}`,
      },
      body: JSON.stringify({ pollId }),
    });
    if (!pollRespRes.ok) {
      throw new Error(`Failed to submit demo poll responses: ${await pollRespRes.text()}`);
    }
    const pollRespData = pollResponseCountSchema.parse(await pollRespRes.json());
    if (
      !pollRespData.submitted.includes("hari") ||
      !pollRespData.submitted.includes("rahul")
    ) {
      throw new Error(`Poll responses did not include both students: ${JSON.stringify(pollRespData)}`);
    }

    // Idempotency: call again
    const repeatPollRespRes = await fetch(`${config.origin}/api/demo/poll-responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.teacher}`,
      },
      body: JSON.stringify({ pollId }),
    });
    if (!repeatPollRespRes.ok) {
      throw new Error(`Idempotent poll response call failed: ${await repeatPollRespRes.text()}`);
    }

    // 9. Instant Match
    const matchRes = await fetch(`${config.origin}/api/demo/instant-match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.teacher}`,
      },
      body: JSON.stringify({}),
    });
    if (!matchRes.ok) {
      throw new Error(`Instant match failed: ${await matchRes.text()}`);
    }
    const matchData = instantMatchSchema.parse(await matchRes.json());

    // 10. Coordinated reset
    const resetRes = await fetch(`${config.origin}/api/demo/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.teacher}`,
      },
      body: JSON.stringify({}),
    });
    if (!resetRes.ok) {
      throw new Error(`Reset failed: ${await resetRes.text()}`);
    }
    const resetData = demoResetSchema.parse(await resetRes.json());

    // Print evidence
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: options.mode,
          seed: options.seed,
          assertions: {
            personasVerified: 5,
            concepts: seedResult.conceptCount,
            edges: seedResult.edgeCount,
            students: seedResult.studentCount,
            masteryRows: seedResult.masteryCount,
            gameBaselines: true,
            speechStep: true,
            pollResponses: pollRespData.submitted,
            instantMatchId: matchData.matchId,
            resetDurationMs: resetData.elapsedMs,
          },
        },
        null,
        2,
      ),
    );

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
  } finally {
    if (ownedServer) {
      await ownedServer.dispose();
    }
  }
}

void main();
