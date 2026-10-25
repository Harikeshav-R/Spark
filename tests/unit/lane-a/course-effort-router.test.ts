import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import type { GameService, CourseEffortDTO } from "../../../src/contracts/game.js";
import { AppError } from "../../../src/contracts/errors.js";
import type { AuthGateway } from "../../../src/server/platform/index.js";
import {
  createCourseEffortRouter,
} from "../../../src/server/core/game/course-effort-router.js";

describe("CourseEffortRouter", () => {
  const teacherId: UUID = "00000000-0000-4000-8000-000000000030";
  const courseId: UUID = "00000000-0000-4000-8000-000000000010";

  const teacherActor: ActorContext = {
    userId: "00000000-0000-4000-8000-00000000000c",
    authId: "00000000-0000-4000-8000-00000000000c",
    email: "teacher@example.com",
    name: "Prof C",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: "00000000-0000-4000-8000-0000000000a1",
    authId: "00000000-0000-4000-8000-0000000000a1",
    email: "student@example.com",
    name: "Student 1",
    role: "student",
    enrolledCourses: [],
  };

  let mockAuth: Pick<AuthGateway, "verifyToken">;
  let mockGame: Pick<GameService, "getCourseEffort">;
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    mockAuth = {
      verifyToken: vi.fn(async (token: string): Promise<ActorContext> => {
        if (token === "teacher-token") return teacherActor;
        if (token === "student-token") return studentActor;
        throw new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Invalid or expired token",
        });
      }),
    };

    const fixtureEffort: CourseEffortDTO[] = [
      {
        studentId: "00000000-0000-4000-8000-000000000001",
        name: "Rahul Verma",
        xp: 600,
        averageConfidence: 0.2,
        flag: "high_effort_low_mastery",
      },
      {
        studentId: "00000000-0000-4000-8000-000000000002",
        name: "Hari Ram",
        xp: 480,
        averageConfidence: 0.8,
        flag: null,
      },
    ];

    mockGame = {
      getCourseEffort: vi.fn(async (actor: ActorContext, targetCourseId: UUID) => {
        if (actor.role !== "teacher" || actor.teacherId !== teacherId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only the owning teacher can view course effort",
          });
        }
        if (targetCourseId === "00000000-0000-4000-8000-000000000404") {
          throw new AppError({
            code: "NOT_FOUND",
            statusCode: 404,
            message: "Course not found",
          });
        }
        return fixtureEffort;
      }),
    };

    const app = express();
    app.use(express.json());
    app.use(createCourseEffortRouter({ auth: mockAuth, game: mockGame }));

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
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      server.close((err) => (err ? reject(err) : resolve()));
      await promise;
      server = null;
    }
  });

  it("returns 200 with bare CourseEffortDTO array and Cache-Control: private, no-store", async () => {
    const res = await fetch(`${baseUrl}/api/courses/${courseId}/students/effort`, {
      headers: { Authorization: "Bearer teacher-token" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const data = await res.json();
    expect(data).toEqual([
      {
        studentId: "00000000-0000-4000-8000-000000000001",
        name: "Rahul Verma",
        xp: 600,
        averageConfidence: 0.2,
        flag: "high_effort_low_mastery",
      },
      {
        studentId: "00000000-0000-4000-8000-000000000002",
        name: "Hari Ram",
        xp: 480,
        averageConfidence: 0.8,
        flag: null,
      },
    ]);
  });

  it("returns 401 with standard error envelope when authorization header is missing", async () => {
    const res = await fetch(`${baseUrl}/api/courses/${courseId}/students/effort`);

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const data = (await res.json()) as { error: { code: string; message: string; requestId: string } };
    expect(data.error.code).toBe("UNAUTHORIZED");
    expect(typeof data.error.requestId).toBe("string");
  });

  it("returns 403 when authenticated actor is a student", async () => {
    const res = await fetch(`${baseUrl}/api/courses/${courseId}/students/effort`, {
      headers: { Authorization: "Bearer student-token" },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const data = (await res.json()) as { error: { code: string; message: string; requestId: string } };
    expect(data.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 when courseId parameter is not a valid UUID", async () => {
    const res = await fetch(`${baseUrl}/api/courses/not-a-valid-uuid/students/effort`, {
      headers: { Authorization: "Bearer teacher-token" },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const data = (await res.json()) as { error: { code: string; message: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when target course is not found", async () => {
    const res = await fetch(`${baseUrl}/api/courses/00000000-0000-4000-8000-000000000404/students/effort`, {
      headers: { Authorization: "Bearer teacher-token" },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const data = (await res.json()) as { error: { code: string; message: string } };
    expect(data.error.code).toBe("NOT_FOUND");
  });
});
