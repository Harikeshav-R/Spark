import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  createMultiUserHarness,
  type MultiUserHarness,
} from "./multi-context";
import {
  SupabaseTestHarness,
  type TestContext,
  getLocalSupabaseUrl,
} from "../../integration/lane-a/supabase-harness";
import {
  seedDemoDatabase,
  buildDemoDataset,
  DEMO_PASSWORD,
  type DemoDataset,
} from "../../../src/server/platform/index";
import { signIn } from "./journey-actions";

export { expect };

export interface AuthenticatedAccount {
  user: {
    id: string;
    email: string;
    name: string;
    role: "teacher" | "student";
  };
  session: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  };
  password: string;
}

export interface AuthenticatedStudentAccount extends AuthenticatedAccount {
  studentId: string;
}

export interface JourneyFixture {
  readonly harness: MultiUserHarness;
  readonly supabase: SupabaseTestHarness;
  readonly baseURL: string;
  readonly namespace: string;
  readonly now: Date;
  courseId: string;
  joinCode: string;
  conceptIdsByLabel: Map<string, string>;
  teacher: AuthenticatedAccount;
  hari: AuthenticatedStudentAccount;
  rahul: AuthenticatedStudentAccount;
  dataset?: DemoDataset;
  initCanonicalDemo(): Promise<void>;
  initEmptyOnboarding(): Promise<void>;
  trackCourseId(id: string): void;
  trackTeacherId(id: string): void;
  trackAuthUserId(id: string): void;
  trackStudentId(id: string): void;
}

export function verifyLoopback(urlStr: string, name: string): void {
  try {
    const parsed = new URL(urlStr);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new Error(`Refusing non-loopback ${name}: ${urlStr}`);
    }
  } catch (err) {
    throw new Error(`Invalid or non-loopback ${name}: ${urlStr}`, {
      cause: err,
    });
  }
}

export async function verifyServerHealth(baseURL: string): Promise<void> {
  verifyLoopback(baseURL, "application origin");
  const res = await fetch(`${baseURL}/api/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(
      `Server health probe failed: HTTP ${res.status} at ${baseURL}/api/health`
    );
  }
  const data: unknown = await res.json().catch(() => null);
  if (!data || typeof data !== "object") {
    throw new Error(
      `Server health check returned invalid JSON at ${baseURL}/api/health`
    );
  }
  if (!("status" in data) || data.status !== "ok") {
    throw new Error(
      `Server health check status is not ok at ${baseURL}/api/health: ${JSON.stringify(
        data
      )}`
    );
  }
  if (!("mode" in data) || data.mode !== "fixture") {
    throw new Error(
      `Server is not running in fixture mode: mode=${String(
        "mode" in data ? data.mode : "unknown"
      )}`
    );
  }
}

export const test = base.extend<{ journey: JourneyFixture }>({
  journey: async ({ browser, baseURL }, use) => {
    test.setTimeout(180_000);

    const effectiveBaseURL = baseURL || "http://localhost:3000";
    verifyLoopback(effectiveBaseURL, "APP_ORIGIN/baseURL");
    verifyLoopback(getLocalSupabaseUrl(), "SUPABASE_URL");

    await verifyServerHealth(effectiveBaseURL);

    const harness = await createMultiUserHarness(browser, {
      baseURL: effectiveBaseURL,
    });
    const supabase = new SupabaseTestHarness();
    const now = new Date();
    const namespace = `j_${Date.now()}_${randomUUID().slice(0, 8)}`;

    const trackedCourseIds = new Set<string>();
    const trackedTeacherIds = new Set<string>();
    const trackedAuthUserIds = new Set<string>();
    const trackedStudentIds = new Set<string>();

    let currentCourseId = "";
    let currentJoinCode = "";
    const conceptIdsByLabel = new Map<string, string>();
    let activeDataset: DemoDataset | undefined = undefined;

    let teacherAccount: AuthenticatedAccount = {
      user: { id: "", email: "", name: "Prof. Chen", role: "teacher" },
      session: { accessToken: "", expiresAt: 0 },
      password: DEMO_PASSWORD,
    };

    let hariAccount: AuthenticatedStudentAccount = {
      user: { id: "", email: "", name: "Hari", role: "student" },
      session: { accessToken: "", expiresAt: 0 },
      studentId: "",
      password: DEMO_PASSWORD,
    };

    let rahulAccount: AuthenticatedStudentAccount = {
      user: { id: "", email: "", name: "Rahul", role: "student" },
      session: { accessToken: "", expiresAt: 0 },
      studentId: "",
      password: DEMO_PASSWORD,
    };

    const initCanonicalDemo = async () => {
      await seedDemoDatabase(process.env, now, namespace);
      const dataset = buildDemoDataset(now, namespace);
      activeDataset = dataset;

      currentCourseId = dataset.course.id;
      currentJoinCode = dataset.course.joinCode;
      trackedCourseIds.add(dataset.course.id);
      trackedTeacherIds.add(dataset.teacher.id);

      for (const u of dataset.authUsers) {
        trackedAuthUserIds.add(u.id);
      }
      for (const s of dataset.students) {
        trackedStudentIds.add(s.id);
      }

      for (const c of dataset.concepts) {
        conceptIdsByLabel.set(c.label, c.id);
      }

      const teacherRes = await signIn(harness.teacher.page, {
        email: dataset.teacher.email,
        password: DEMO_PASSWORD,
      });
      teacherAccount = {
        user: teacherRes.user,
        session: teacherRes.session,
        password: DEMO_PASSWORD,
      };

      const hariStudent = dataset.students.find((s) => s.name === "Hari")!;
      const hariRes = await signIn(harness.hari.page, {
        email: hariStudent.email,
        password: DEMO_PASSWORD,
      });
      hariAccount = {
        user: hariRes.user,
        session: hariRes.session,
        studentId: hariStudent.id,
        password: DEMO_PASSWORD,
      };

      const rahulStudent = dataset.students.find((s) => s.name === "Rahul")!;
      const rahulRes = await signIn(harness.rahul.page, {
        email: rahulStudent.email,
        password: DEMO_PASSWORD,
      });
      rahulAccount = {
        user: rahulRes.user,
        session: rahulRes.session,
        studentId: rahulStudent.id,
        password: DEMO_PASSWORD,
      };
    };

    const initEmptyOnboarding = async () => {
      const testContext: TestContext = {
        users: [],
        teacherIds: [],
        courseIds: [],
      };

      const teacherUser = await supabase.createTestUser(testContext, "teacher", {
        name: "Prof. Chen",
        email: `prof_${namespace}@test.edu`,
      });
      trackedAuthUserIds.add(teacherUser.authId);

      const teacherId = randomUUID();
      const { error: teacherError } = await supabase.serviceClient
        .from("teachers")
        .insert({
          id: teacherId,
          auth_id: teacherUser.authId,
          name: teacherUser.name,
          email: teacherUser.email,
        });
      if (teacherError) {
        throw new Error(`Failed to insert test teacher: ${teacherError.message}`);
      }
      trackedTeacherIds.add(teacherId);

      const hariUser = await supabase.createTestUser(testContext, "student", {
        name: "Hari",
        email: `hari_${namespace}@test.edu`,
      });
      trackedAuthUserIds.add(hariUser.authId);

      const rahulUser = await supabase.createTestUser(testContext, "student", {
        name: "Rahul",
        email: `rahul_${namespace}@test.edu`,
      });
      trackedAuthUserIds.add(rahulUser.authId);

      const teacherRes = await signIn(harness.teacher.page, {
        email: teacherUser.email,
        password: "TestPassword123!",
      });
      teacherAccount = {
        user: teacherRes.user,
        session: teacherRes.session,
        password: "TestPassword123!",
      };

      const hariRes = await signIn(harness.hari.page, {
        email: hariUser.email,
        password: "TestPassword123!",
      });
      hariAccount = {
        user: hariRes.user,
        session: hariRes.session,
        studentId: "",
        password: "TestPassword123!",
      };

      const rahulRes = await signIn(harness.rahul.page, {
        email: rahulUser.email,
        password: "TestPassword123!",
      });
      rahulAccount = {
        user: rahulRes.user,
        session: rahulRes.session,
        studentId: "",
        password: "TestPassword123!",
      };
    };

    const journey: JourneyFixture = {
      harness,
      supabase,
      baseURL: effectiveBaseURL,
      namespace,
      now,
      get courseId() {
        return currentCourseId;
      },
      set courseId(val: string) {
        currentCourseId = val;
        trackedCourseIds.add(val);
      },
      get joinCode() {
        return currentJoinCode;
      },
      set joinCode(val: string) {
        currentJoinCode = val;
      },
      conceptIdsByLabel,
      get teacher() {
        return teacherAccount;
      },
      set teacher(acc: AuthenticatedAccount) {
        teacherAccount = acc;
      },
      get hari() {
        return hariAccount;
      },
      set hari(acc: AuthenticatedStudentAccount) {
        hariAccount = acc;
      },
      get rahul() {
        return rahulAccount;
      },
      set rahul(acc: AuthenticatedStudentAccount) {
        rahulAccount = acc;
      },
      get dataset() {
        return activeDataset;
      },
      initCanonicalDemo,
      initEmptyOnboarding,
      trackCourseId: (id: string) => trackedCourseIds.add(id),
      trackTeacherId: (id: string) => trackedTeacherIds.add(id),
      trackAuthUserId: (id: string) => trackedAuthUserIds.add(id),
      trackStudentId: (id: string) => trackedStudentIds.add(id),
    };

    try {
      await use(journey);
    } finally {
      await harness.closeAll();

      const errors: unknown[] = [];

      for (const courseId of trackedCourseIds) {
        try {
          const { error: pqErr } = await supabase.serviceClient
            .from("party_quest_progress")
            .delete()
            .neq(
              "party_quest_id",
              "00000000-0000-0000-0000-000000000000"
            );
          if (pqErr) {
            // best-effort cleanup of party quest progress
          }
        } catch {
          // ignore
        }

        try {
          const { error } = await supabase.serviceClient
            .from("courses")
            .delete()
            .eq("id", courseId);
          if (error) {
            errors.push(
              new Error(
                `Teardown failed to delete course ${courseId}: ${error.message}`
              )
            );
          }
        } catch (err) {
          errors.push(err);
        }
      }

      for (const teacherId of trackedTeacherIds) {
        try {
          const { error } = await supabase.serviceClient
            .from("teachers")
            .delete()
            .eq("id", teacherId);
          if (error) {
            errors.push(
              new Error(
                `Teardown failed to delete teacher ${teacherId}: ${error.message}`
              )
            );
          }
        } catch (err) {
          errors.push(err);
        }
      }

      for (const authId of trackedAuthUserIds) {
        try {
          const { error } =
            await supabase.serviceClient.auth.admin.deleteUser(authId);
          if (error) {
            errors.push(
              new Error(
                `Teardown failed to delete auth user ${authId}: ${error.message}`
              )
            );
          }
        } catch (err) {
          errors.push(err);
        }
      }

      if (errors.length > 0) {
        console.error("[journey-fixture] Cleanup errors:", errors);
      }
    }
  },
});
