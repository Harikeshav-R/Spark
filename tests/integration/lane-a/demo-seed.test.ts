import { execFileSync } from "node:child_process";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  seedDemoDatabase,
  resetDemoDatabase,
} from "../../../src/server/platform/demo/seed-store.js";
import { detectDbContainer } from "../../../src/server/platform/demo/config.js";
import {
  buildDemoDataset,
  demoId,
} from "../../../src/server/platform/demo/dataset.js";
import { runPsql } from "./postgres-test-helpers.js";
import {
  getLocalSupabaseUrl,
  getLocalServiceRoleKey,
  getLocalAnonKey,
} from "./supabase-harness.js";
import { AppError } from "../../../src/contracts/errors.js";

const TEST_NAMESPACE = "spark-test-seed:integ-p7-a-02";
const FROZEN_DATE = new Date("2026-10-24T12:00:00.000Z");
function isLocalSupabaseReachable(): boolean {
  try {
    const container = detectDbContainer(process.env.SUPABASE_DB_CONTAINER);
    const status = execFileSync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", container],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (status !== "true") return false;

    execFileSync("curl", ["-s", "-m", "1", "http://127.0.0.1:54321/auth/v1/health"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const shouldSkip = !isLocalSupabaseReachable();

describe.skipIf(shouldSkip)("Demo Database Seed and Reset (Integration)", () => {
  let adminClient: SupabaseClient;
  const dataset = buildDemoDataset(FROZEN_DATE, TEST_NAMESPACE);
  const testEnv = {
    ...process.env,
    SUPABASE_URL: getLocalSupabaseUrl(),
    SUPABASE_SERVICE_ROLE_KEY: getLocalServiceRoleKey(),
    SUPABASE_ANON_KEY: getLocalAnonKey(),
    CREDENTIAL_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };

  beforeAll(() => {
    adminClient = createClient(testEnv.SUPABASE_URL, testEnv.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });
  afterAll(async () => {
    // 1. Clean up test course and cascade-deleted data
    try {
      runPsql(`DELETE FROM public.courses WHERE id = '${dataset.course.id}';`);
      runPsql(`DELETE FROM public.teachers WHERE id = '${dataset.teacher.id}';`);
    } catch {
      // Ignore cleanup error if already removed
    }

    // 2. Clean up provisioned test auth users
    for (const u of dataset.authUsers) {
      try {
        await adminClient.auth.admin.deleteUser(u.id);
      } catch {
        // Ignore
      }
    }
  });

  it("seeds deterministic dataset into local database with verified counts", async () => {
    const result = await seedDemoDatabase(testEnv, FROZEN_DATE, TEST_NAMESPACE);

    expect(result.courseId).toBe(dataset.course.id);
    expect(result.conceptCount).toBe(33);
    expect(result.edgeCount).toBe(34);
    expect(result.studentCount).toBe(4);
    expect(result.masteryCount).toBe(132);

    // Verify database counts directly via psql
    const conceptCount = Number.parseInt(
      runPsql(`SELECT COUNT(*) FROM public.concept_nodes WHERE course_id = '${dataset.course.id}';`),
      10,
    );
    expect(conceptCount).toBe(33);

    const edgeCount = Number.parseInt(
      runPsql(`SELECT COUNT(*) FROM public.concept_edges WHERE course_id = '${dataset.course.id}';`),
      10,
    );
    expect(edgeCount).toBe(34);

    const studentCount = Number.parseInt(
      runPsql(`SELECT COUNT(*) FROM public.students WHERE course_id = '${dataset.course.id}';`),
      10,
    );
    expect(studentCount).toBe(4);

    const masteryCount = Number.parseInt(
      runPsql(
        `SELECT COUNT(*) FROM public.student_mastery sm JOIN public.students s ON s.id = sm.student_id WHERE s.course_id = '${dataset.course.id}';`,
      ),
      10,
    );
    expect(masteryCount).toBe(132);

    // Verify Hari total XP = 620
    const hari = dataset.students.find((s) => s.persona === "hari")!;
    const hariXp = Number.parseInt(
      runPsql(`SELECT COALESCE(SUM(amount), 0) FROM public.xp_events WHERE student_id = '${hari.id}';`),
      10,
    );
    expect(hariXp).toBe(620);

    // Verify Rahul total XP = 508
    const rahul = dataset.students.find((s) => s.persona === "rahul")!;
    const rahulXp = Number.parseInt(
      runPsql(`SELECT COALESCE(SUM(amount), 0) FROM public.xp_events WHERE student_id = '${rahul.id}';`),
      10,
    );
    expect(rahulXp).toBe(508);
  });

  it("is idempotent: repeated seed yields identical dataset", async () => {
    const secondResult = await seedDemoDatabase(testEnv, FROZEN_DATE, TEST_NAMESPACE);
    expect(secondResult.conceptCount).toBe(33);
    expect(secondResult.edgeCount).toBe(34);
    expect(secondResult.studentCount).toBe(4);
    expect(secondResult.masteryCount).toBe(132);
  });

  it("resets dirty transients while preserving baselines and identities", async () => {
    // 1. Insert dirty transients into the test demo course
    const dirtyLectureId = demoId("lecture:transient", TEST_NAMESPACE);
    runPsql(
      `INSERT INTO public.lecture_sessions (id, course_id, title, status, started_at) VALUES ('${dirtyLectureId}', '${dataset.course.id}', 'Transient Lecture', 'live', NOW());`,
    );

    const transientCountBefore = Number.parseInt(
      runPsql(`SELECT COUNT(*) FROM public.lecture_sessions WHERE course_id = '${dataset.course.id}';`),
      10,
    );
    expect(transientCountBefore).toBe(1);

    // 2. Execute reset
    const resetResult = await resetDemoDatabase(testEnv, FROZEN_DATE, TEST_NAMESPACE);
    expect(resetResult.courseId).toBe(dataset.course.id);
    expect(resetResult.conceptCount).toBe(33);
    expect(resetResult.studentCount).toBe(4);
    expect(resetResult.masteryCount).toBe(132);

    // 3. Verify transient lecture is wiped
    const transientCountAfter = Number.parseInt(
      runPsql(`SELECT COUNT(*) FROM public.lecture_sessions WHERE course_id = '${dataset.course.id}';`),
      10,
    );
    expect(transientCountAfter).toBe(0);

    // 4. Verify baselines are intact
    const hari = dataset.students.find((s) => s.persona === "hari")!;
    const hariXp = Number.parseInt(
      runPsql(`SELECT COALESCE(SUM(amount), 0) FROM public.xp_events WHERE student_id = '${hari.id}';`),
      10,
    );
    expect(hariXp).toBe(620);
  });

  it("rejects seeding in production environment", async () => {
    await expect(
      seedDemoDatabase({ ...testEnv, NODE_ENV: "production" }, FROZEN_DATE, TEST_NAMESPACE),
    ).rejects.toThrow(AppError);
  });
});
