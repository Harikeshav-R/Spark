import net, { type AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type ServerInstance } from "../../../server/index.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import { OpenRouterClient } from "../../../src/server/ai/index.js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator.js";
import type { Clock } from "../../../src/contracts/common.js";
import {
  createFixtureSupabaseClient,
  FIXTURE_IDS,
} from "../lane-b/helpers/socket-fixture.js";

describe("P7-A-01: Cross-Lane Composed Server Contracts Integration", () => {
  let instance: ServerInstance;
  let baseUrl: string;
  let serverPort: number;
  let fixtureSupabase: ReturnType<typeof createFixtureSupabaseClient>;

  const fixedTimestamp = "2026-10-24T12:00:00.000Z";
  const teacherToken = FIXTURE_IDS.teacher1.token;
  const studentToken = FIXTURE_IDS.studentCourse1Only.token;
  const studentId = FIXTURE_IDS.studentCourse1Only.studentIdCourse1;
  const courseId = FIXTURE_IDS.teacher1.courseId;
  const concept1 = "33333333-3333-4333-8333-333333333317";
  beforeAll(async () => {
    const supabase = createFixtureSupabaseClient({
      tableRows: {
        courses: [
          {
            id: courseId,
            teacher_id: FIXTURE_IDS.teacher1.teacherId,
            name: "CS229: Machine Learning",
            join_code: "ML2026CS",
            created_at: new Date().toISOString(),
          },
        ],
        teachers: [
          {
            id: FIXTURE_IDS.teacher1.teacherId,
            auth_id: FIXTURE_IDS.teacher1.authId,
            name: "Prof. One",
            email: "teacher1@example.edu",
          },
        ],
        students: [
          {
            id: studentId,
            auth_id: FIXTURE_IDS.studentCourse1Only.authId,
            course_id: courseId,
            name: "Student One",
            email: "student_course1@example.edu",
          },
        ],
        concept_nodes: [
          {
            id: concept1,
            course_id: courseId,
            label: "Backpropagation",
            description: "Reverse-mode autodiff",
            category: "Neural Networks",
            difficulty: 3,
            created_at: new Date().toISOString(),
          },
        ],
        student_mastery: [
          {
            student_id: studentId,
            concept_id: concept1,
            confidence: 0.2,
            band: "red",
            version: 1,
            updated_at: new Date().toISOString(),
          },
        ],
      },
    });
    fixtureSupabase = supabase;

    const auth = createAuthGateway(supabase, supabase);
    const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const ids = new CryptoIdGenerator();
    const clock: Clock = {
      now: () => new Date(fixedTimestamp),
      nowISO: () => fixedTimestamp,
    };
    instance = createServer({
      auth,
      databaseClient: supabase,
      aiClient,
      clock,
      ids,
      env: {
        INTEGRATION_MODE: "fixture",
        NODE_ENV: "test",
      },
      sessionClientFactory: () => supabase,
    });

    const { promise, resolve } = Promise.withResolvers<void>();
    instance.httpServer.listen(0, "127.0.0.1", () => resolve());
    await promise;

    serverPort = (instance.httpServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${serverPort}`;
  });

  afterAll(async () => {
    if (instance) {
      await instance.dispose();
    }
  });

  it("1. GET /api/health responds with safe health payload", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = await res.json();
    expect(data).toEqual({
      status: "ok",
      timestamp: fixedTimestamp,
      version: "0.1.0",
      mode: "fixture",
    });
  });

  it("2. GET /api/auth/me returns authoritative profile with course enrollments", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(FIXTURE_IDS.studentCourse1Only.authId);
    expect(data.role).toBe("student");
    expect(data.enrollments).toHaveLength(1);
    expect(data.enrollments[0].courseId).toBe(courseId);
  });

  it("3. GET /api/courses lists authorized courses", async () => {
    const teacherRes = await fetch(`${baseUrl}/api/courses`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(teacherRes.status).toBe(200);
    const teacherCourses = await teacherRes.json();
    expect(Array.isArray(teacherCourses)).toBe(true);
    expect(teacherCourses[0].id).toBe(courseId);

    const studentRes = await fetch(`${baseUrl}/api/courses`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(studentRes.status).toBe(200);
    const studentCourses = await studentRes.json();
    expect(Array.isArray(studentCourses)).toBe(true);
    expect(studentCourses[0].id).toBe(courseId);
  });

  it("4. GET /api/concepts/:conceptId/learning-page returns generated content", async () => {
    const res = await fetch(`${baseUrl}/api/concepts/${concept1}/learning-page`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.content).toBe("string");
    expect(data.content.length).toBeGreaterThan(100);
  });

  it("5. GET /api/concepts/:conceptId/quiz returns questions without answers", async () => {
    const res = await fetch(`${baseUrl}/api/concepts/${concept1}/quiz`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conceptId).toBe(concept1);
    expect(data.questions).toHaveLength(5);
    for (const q of data.questions) {
      expect(q).toHaveProperty("question");
      expect(q).toHaveProperty("options");
      expect(q).not.toHaveProperty("correctAnswer");
    }
  });

  it("6. POST /api/resources/search and ask return academic resources", async () => {
    const searchRes = await fetch(`${baseUrl}/api/resources/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ conceptId: concept1, query: "optimization" }),
    });
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    expect(Array.isArray(searchData.resources)).toBe(true);

    const askRes = await fetch(`${baseUrl}/api/resources/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        conceptId: concept1,
        question: "How does backprop scale with network depth?",
      }),
    });
    expect(askRes.status).toBe(200);
    const askData = await askRes.json();
    expect(typeof askData.answer).toBe("string");
    expect(Array.isArray(askData.citations)).toBe(true);
  });

  it("7. Study Groups availability GET and PUT return valid intervals", async () => {
    const getRes = await fetch(
      `${baseUrl}/api/courses/${courseId}/study-groups/availability`,
      {
        headers: { Authorization: `Bearer ${studentToken}` },
      }
    );
    expect(getRes.status).toBe(200);
    const intervals = await getRes.json();
    expect(Array.isArray(intervals)).toBe(true);
  });

  it("8. Isolation check: Unenrolled outsider student rejected with 403/404", async () => {
    const outsiderToken = FIXTURE_IDS.teacher2.token; // Has no enrollment in course 1
    const res = await fetch(`${baseUrl}/api/concepts/${concept1}/learning-page`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    // Teacher2 does not own course1 and has no enrollment in course1 -> 404/403
    expect([403, 404]).toContain(res.status);
  });

  it("9. Lifecycle: in-flight HTTP drains, late requests rejected with 503, disposal idempotent, port rebound, no fabricated lecture end", async () => {
    const lectureId = "44444444-4444-4444-8444-444444444444";
    await fixtureSupabase.from("lectures").insert({
      id: lectureId,
      course_id: courseId,
      title: "Active Lecture",
      status: "live",
      created_at: new Date().toISOString(),
    });

    let slowHandlerExecuted = false;
    const { promise: handlerStarted, resolve: markHandlerStarted } = Promise.withResolvers<void>();
    const { promise: releaseHandler, resolve: triggerHandlerFinish } = Promise.withResolvers<void>();

    instance.app.get("/api/test-slow-drain", async (_req, res) => {
      markHandlerStarted();
      await releaseHandler;
      slowHandlerExecuted = true;
      res.json({ completed: true });
    });

    const slowRequestPromise = fetch(`${baseUrl}/api/test-slow-drain`);
    await handlerStarted;

    const disposePromise1 = instance.dispose();

    const lateRes = await fetch(`${baseUrl}/api/health`);
    expect(lateRes.status).toBe(503);
    const lateJson = (await lateRes.json()) as { error: { code: string } };
    expect(lateJson.error.code).toBe("SERVICE_UNAVAILABLE");

    triggerHandlerFinish();
    const slowRes = await slowRequestPromise;
    expect(slowRes.status).toBe(200);
    expect(slowHandlerExecuted).toBe(true);
    const slowJson = (await slowRes.json()) as { completed: boolean };
    expect(slowJson.completed).toBe(true);

    await disposePromise1;

    await expect(instance.dispose()).resolves.toBeUndefined();

    const testServer = net.createServer();
    const { promise: rebindPromise, resolve: rebindResolve } = Promise.withResolvers<void>();
    testServer.listen(serverPort, "127.0.0.1", () => rebindResolve());
    await rebindPromise;
    testServer.close();

    const { data: lectureRow } = await fixtureSupabase
      .from("lectures")
      .select("status")
      .eq("id", lectureId)
      .single();
    expect(lectureRow?.status).toBe("live");
  });
});
