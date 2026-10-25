import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import {
  classSkySnapshotSchema,
  courseEffortSchema,
} from "../../../src/contracts/game.js";
import { AppError, apiErrorSchema } from "../../../src/contracts/errors.js";
import type { Course, CourseService } from "../../../src/contracts/course.js";
import type { AuthGateway } from "../../../src/server/platform/index.js";
import { HeatmapService } from "../../../src/server/core/mastery/heatmap-service.js";
import { CourseEffortService } from "../../../src/server/core/game/course-effort-service.js";
import { createCourseEffortRouter } from "../../../src/server/core/game/course-effort-router.js";
import { createHeatmapRouter } from "../../../src/server/core/mastery/heatmap-router.js";
import {
  type FakeDbStore,
  FakeClock,
  createFakeSupabaseClient,
} from "./course-effort-harness.js";

describe("CourseEffortRouter (Service-backed HTTP Integration)", () => {
  const teacherId: UUID = "00000000-0000-4000-8000-000000000030";
  const otherTeacherId: UUID = "00000000-0000-4000-8000-000000000031";
  const courseId: UUID = "00000000-0000-4000-8000-000000000010";
  const missingCourseId: UUID = "00000000-0000-4000-8000-000000000404";

  const concept1Id: UUID = "00000000-0000-4000-8000-000000000101";
  const concept2Id: UUID = "00000000-0000-4000-8000-000000000102";

  const rahulId: UUID = "00000000-0000-4000-8000-000000000001";
  const hariId: UUID = "00000000-0000-4000-8000-000000000002";
  const miraId: UUID = "00000000-0000-4000-8000-000000000003";
  const leeId: UUID = "00000000-0000-4000-8000-000000000004";

  const lecture1Id: UUID = "00000000-0000-4000-9000-000000000001";

  const teacherActor: ActorContext = {
    userId: "00000000-0000-4000-8000-00000000000c",
    authId: "00000000-0000-4000-8000-00000000000c",
    email: "teacher@example.com",
    name: "Prof C",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const otherTeacherActor: ActorContext = {
    userId: "00000000-0000-4000-8000-00000000000d",
    authId: "00000000-0000-4000-8000-00000000000d",
    email: "teacher2@example.com",
    name: "Prof D",
    role: "teacher",
    teacherId: otherTeacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: "00000000-0000-4000-8000-000000000001",
    authId: "00000000-0000-4000-8000-000000000001",
    email: "student@example.com",
    name: "Student",
    role: "student",
    enrolledCourses: [{ studentId: rahulId, courseId }],
  };

  let store: FakeDbStore;
  let mockAuth: Pick<AuthGateway, "verifyToken">;
  let mockCourseService: Pick<CourseService, "getCourse">;
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    store = {
      conceptNodes: [
        { id: concept1Id, course_id: courseId, label: "Concept 1", category: "Core" },
        { id: concept2Id, course_id: courseId, label: "Concept 2", category: "Core" },
      ],
      students: [
        { id: rahulId, course_id: courseId, name: "Rahul Verma" },
        { id: hariId, course_id: courseId, name: "Hari Ram" },
        { id: miraId, course_id: courseId, name: "Mira" },
        { id: leeId, course_id: courseId, name: "Lee" },
      ],
      xpEvents: [],
      mastery: [],
      lectures: [
        { id: lecture1Id, course_id: courseId, status: "live" },
      ],
      transcriptChunks: [
        {
          id: "00000000-0000-4000-8000-000000000001" as UUID,
          lecture_id: lecture1Id,
          lecture: { course_id: courseId },
          transcript_concepts: [{ concept_id: concept1Id }],
        },
      ],
    };

    // Rahul: 600 XP (10 * 60), 0.20 confidence
    for (let i = 1; i <= 10; i++) {
      const hex = i.toString(16).padStart(12, "0");
      store.xpEvents.push({
        id: `00000000-0000-4000-a000-${hex}` as UUID,
        student_id: rahulId,
        amount: 60,
        student: { course_id: courseId },
      });
    }
    store.mastery.push(
      {
        id: "00000000-0000-4000-b000-000000000001" as UUID,
        student_id: rahulId,
        concept_id: concept1Id,
        confidence: 0.2,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
      {
        id: "00000000-0000-4000-b000-000000000002" as UUID,
        student_id: rahulId,
        concept_id: concept2Id,
        confidence: 0.2,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
    );

    // Hari: 480 XP (8 * 60), 0.80 confidence
    for (let i = 1; i <= 8; i++) {
      const hex = (i + 10).toString(16).padStart(12, "0");
      store.xpEvents.push({
        id: `00000000-0000-4000-a000-${hex}` as UUID,
        student_id: hariId,
        amount: 60,
        student: { course_id: courseId },
      });
    }
    store.mastery.push(
      {
        id: "00000000-0000-4000-b000-000000000003" as UUID,
        student_id: hariId,
        concept_id: concept1Id,
        confidence: 0.8,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
      {
        id: "00000000-0000-4000-b000-000000000004" as UUID,
        student_id: hariId,
        concept_id: concept2Id,
        confidence: 0.8,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
    );

    // Mira: 120 XP (2 * 60), 0.40 confidence
    for (let i = 1; i <= 2; i++) {
      const hex = (i + 20).toString(16).padStart(12, "0");
      store.xpEvents.push({
        id: `00000000-0000-4000-a000-${hex}` as UUID,
        student_id: miraId,
        amount: 60,
        student: { course_id: courseId },
      });
    }
    store.mastery.push(
      {
        id: "00000000-0000-4000-b000-000000000005" as UUID,
        student_id: miraId,
        concept_id: concept1Id,
        confidence: 0.4,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
      {
        id: "00000000-0000-4000-b000-000000000006" as UUID,
        student_id: miraId,
        concept_id: concept2Id,
        confidence: 0.4,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
    );

    // Lee: 0 events, 0 mastery rows

    mockAuth = {
      verifyToken: vi.fn(async (token: string): Promise<ActorContext> => {
        if (token === "teacher-token") return teacherActor;
        if (token === "student-token") return studentActor;
        if (token === "other-teacher-token") return otherTeacherActor;
        throw new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Invalid or expired token",
        });
      }),
    };

    mockCourseService = {
      getCourse: vi.fn(async (_actor: ActorContext, targetCourseId: UUID): Promise<Course> => {
        if (targetCourseId === courseId) {
          return {
            id: courseId,
            teacherId,
            name: "Intro to CS",
            joinCode: "CS101",
            createdAt: new Date().toISOString(),
          };
        }
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Course not found",
        });
      }),
    };

    const client = createFakeSupabaseClient(store);
    const clock = new FakeClock();
    const heatmapService = new HeatmapService({
      client,
      courses: mockCourseService,
      publisher: { emitToTeacher: vi.fn(async () => {}) },
      clock,
      ids: { generateId: vi.fn((): UUID => "00000000-0000-4000-8000-000000000777") },
    });

    const effortService = new CourseEffortService({
      client,
      courses: mockCourseService,
      heatmap: heatmapService,
    });

    const app = express();
    app.use(express.json());
    app.use(createCourseEffortRouter({ auth: mockAuth, game: effortService }));
    app.use(createHeatmapRouter({ auth: mockAuth, heatmap: heatmapService }));

    const { promise, resolve } = Promise.withResolvers<number>();
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server?.address();
      if (addr && typeof addr === "object") {
        resolve(addr.port);
      }
    });
    const port = await promise;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = null;
    }
  });

  describe("GET /api/courses/:courseId/students/effort", () => {
    it("returns 200 with computed cohort effort values, unassessed boolean, and private no-store headers", async () => {
      const res = await fetch(`${baseUrl}/api/courses/${courseId}/students/effort`, {
        headers: { Authorization: "Bearer teacher-token" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      for (const item of data) {
        expect(() => courseEffortSchema.parse(item)).not.toThrow();
      }

      expect(data).toEqual([
        {
          studentId: rahulId,
          name: "Rahul Verma",
          xp: 600,
          averageConfidence: 0.2,
          flag: "high_effort_low_mastery",
          unassessed: false,
        },
        {
          studentId: hariId,
          name: "Hari Ram",
          xp: 480,
          averageConfidence: 0.8,
          flag: null,
          unassessed: false,
        },
        {
          studentId: miraId,
          name: "Mira",
          xp: 120,
          averageConfidence: 0.4,
          flag: null,
          unassessed: false,
        },
        {
          studentId: leeId,
          name: "Lee",
          xp: 0,
          averageConfidence: 0,
          flag: null,
          unassessed: true,
        },
      ]);
    });

    it("returns 401 when authorization header is missing or invalid", async () => {
      const res = await fetch(`${baseUrl}/api/courses/${courseId}/students/effort`);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const data = await res.json();
      expect(() => apiErrorSchema.parse(data)).not.toThrow();
    });

    it("returns 403 when caller is student or other teacher", async () => {
      const resStudent = await fetch(`${baseUrl}/api/courses/${courseId}/students/effort`, {
        headers: { Authorization: "Bearer student-token" },
      });
      expect(resStudent.status).toBe(403);
      expect(resStudent.headers.get("cache-control")).toBe("private, no-store");
      const errStudent = await resStudent.json();
      expect(() => apiErrorSchema.parse(errStudent)).not.toThrow();

      const resOther = await fetch(`${baseUrl}/api/courses/${courseId}/students/effort`, {
        headers: { Authorization: "Bearer other-teacher-token" },
      });
      expect(resOther.status).toBe(403);
      expect(resOther.headers.get("cache-control")).toBe("private, no-store");
      const errOther = await resOther.json();
      expect(() => apiErrorSchema.parse(errOther)).not.toThrow();
    });

    it("returns 400 for malformed course UUID", async () => {
      const res = await fetch(`${baseUrl}/api/courses/not-a-uuid/students/effort`, {
        headers: { Authorization: "Bearer teacher-token" },
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const data = await res.json();
      expect(() => apiErrorSchema.parse(data)).not.toThrow();
    });

    it("returns 404 when target course is missing", async () => {
      const res = await fetch(`${baseUrl}/api/courses/${missingCourseId}/students/effort`, {
        headers: { Authorization: "Bearer teacher-token" },
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const data = await res.json();
      expect(() => apiErrorSchema.parse(data)).not.toThrow();
    });
  });

  describe("GET /api/courses/:courseId/class-sky", () => {
    it("returns 200 with computed ClassSkySnapshot, taught booleans, and private no-store headers", async () => {
      const res = await fetch(`${baseUrl}/api/courses/${courseId}/class-sky`, {
        headers: { Authorization: "Bearer teacher-token" },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const parsed = classSkySnapshotSchema.parse(data);

      expect(parsed.courseId).toBe(courseId);
      expect(parsed.totalStudents).toBe(4);
      expect(parsed.concepts).toHaveLength(2);

      const c1 = parsed.concepts.find((c) => c.conceptId === concept1Id);
      expect(c1).toBeDefined();
      expect(c1?.averageConfidence).toBe(0.35);
      expect(c1?.band).toBe("red");
      expect(c1?.taught).toBe(true);
      expect(c1?.distribution).toEqual({ gray: 1, red: 1, yellow: 1, green: 1 });

      const c2 = parsed.concepts.find((c) => c.conceptId === concept2Id);
      expect(c2).toBeDefined();
      expect(c2?.averageConfidence).toBe(0.35);
      expect(c2?.band).toBe("red");
      expect(c2?.taught).toBe(false);
      expect(c2?.distribution).toEqual({ gray: 1, red: 1, yellow: 1, green: 1 });
    });

    it("does not mark concepts taught from foreign course transcript links", async () => {
      const foreignLectureId: UUID = "00000000-0000-4000-9000-000000000099";
      store.lectures.push({ id: foreignLectureId, course_id: "00000000-0000-4000-8000-000000000099" as UUID, status: "completed" });
      store.transcriptChunks.push({
        id: "00000000-0000-4000-8000-000000000099" as UUID,
        lecture_id: foreignLectureId,
        lecture: { course_id: "00000000-0000-4000-8000-000000000099" as UUID },
        transcript_concepts: [{ concept_id: concept2Id }],
      });

      const res = await fetch(`${baseUrl}/api/courses/${courseId}/class-sky`, {
        headers: { Authorization: "Bearer teacher-token" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const parsed = classSkySnapshotSchema.parse(data);
      const c2 = parsed.concepts.find((c) => c.conceptId === concept2Id);
      expect(c2?.taught).toBe(false);
    });

    it("validates zero-student and zero-concept empty ClassSky responses", async () => {
      store.students = [];
      store.conceptNodes = [];
      store.transcriptChunks = [];

      const res = await fetch(`${baseUrl}/api/courses/${courseId}/class-sky`, {
        headers: { Authorization: "Bearer teacher-token" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const parsed = classSkySnapshotSchema.parse(data);
      expect(parsed.totalStudents).toBe(0);
      expect(parsed.concepts).toEqual([]);
    });

    it("enforces transport and authorization controls with standard error envelopes", async () => {
      // 401 Unauthorized
      const resUnauth = await fetch(`${baseUrl}/api/courses/${courseId}/class-sky`);
      expect(resUnauth.status).toBe(401);
      expect(resUnauth.headers.get("cache-control")).toBe("private, no-store");
      const errUnauth = await resUnauth.json();
      expect(() => apiErrorSchema.parse(errUnauth)).not.toThrow();

      // 403 Forbidden (student)
      const resStudent = await fetch(`${baseUrl}/api/courses/${courseId}/class-sky`, {
        headers: { Authorization: "Bearer student-token" },
      });
      expect(resStudent.status).toBe(403);
      expect(resStudent.headers.get("cache-control")).toBe("private, no-store");
      const errStudent = await resStudent.json();
      expect(() => apiErrorSchema.parse(errStudent)).not.toThrow();

      // 403 Forbidden (other teacher)
      const resOther = await fetch(`${baseUrl}/api/courses/${courseId}/class-sky`, {
        headers: { Authorization: "Bearer other-teacher-token" },
      });
      expect(resOther.status).toBe(403);
      expect(resOther.headers.get("cache-control")).toBe("private, no-store");
      const errOther = await resOther.json();
      expect(() => apiErrorSchema.parse(errOther)).not.toThrow();

      // 400 Validation Error (malformed UUID)
      const resBadUuid = await fetch(`${baseUrl}/api/courses/invalid-uuid/class-sky`, {
        headers: { Authorization: "Bearer teacher-token" },
      });
      expect(resBadUuid.status).toBe(400);
      expect(resBadUuid.headers.get("cache-control")).toBe("private, no-store");
      const errBadUuid = await resBadUuid.json();
      expect(() => apiErrorSchema.parse(errBadUuid)).not.toThrow();

      // 404 Not Found (missing course)
      const resMissing = await fetch(`${baseUrl}/api/courses/${missingCourseId}/class-sky`, {
        headers: { Authorization: "Bearer teacher-token" },
      });
      expect(resMissing.status).toBe(404);
      expect(resMissing.headers.get("cache-control")).toBe("private, no-store");
      const errMissing = await resMissing.json();
      expect(() => apiErrorSchema.parse(errMissing)).not.toThrow();

      // 503 Service Unavailable (DB aggregate failure)
      store.forcedError = {
        table: "transcript_chunks",
        error: { code: "PGRST000", message: "Database connection failed" },
      };
      const res503 = await fetch(`${baseUrl}/api/courses/${courseId}/class-sky`, {
        headers: { Authorization: "Bearer teacher-token" },
      });
      expect(res503.status).toBe(503);
      expect(res503.headers.get("cache-control")).toBe("private, no-store");
      const err503 = await res503.json();
      expect(() => apiErrorSchema.parse(err503)).not.toThrow();
    });
  });

  describe("Shared Error Serialization via Heatmap Route", () => {
    it("serializes AppError through apiErrorHandler on GET /api/courses/:courseId/heatmap", async () => {
      const resStudent = await fetch(`${baseUrl}/api/courses/${courseId}/heatmap`, {
        headers: { Authorization: "Bearer student-token" },
      });
      expect(resStudent.status).toBe(403);
      const err = await resStudent.json();
      expect(() => apiErrorSchema.parse(err)).not.toThrow();

      const resBadId = await fetch(`${baseUrl}/api/courses/bad-uuid/heatmap`, {
        headers: { Authorization: "Bearer teacher-token" },
      });
      expect(resBadId.status).toBe(400);
      const errBad = await resBadId.json();
      expect(() => apiErrorSchema.parse(errBad)).not.toThrow();
    });
  });
});
