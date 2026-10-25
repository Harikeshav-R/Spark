import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import http, { type Server } from "node:http";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import type { ActorContext } from "../../../src/contracts/common.js";
import { createDemoRouter } from "../../../src/server/platform/demo/router.js";
import { apiErrorHandler } from "../../../src/server/platform/middleware/api-error-handler.js";
import type { DemoController } from "../../../src/server/platform/demo/controller.js";
import { demoId } from "../../../src/server/platform/demo/dataset.js";
import { FIXTURE_COURSE_ID } from "../../../src/server/ai/index.js";

const chenActor: ActorContext = {
  userId: demoId("auth:teacher"),
  authId: demoId("auth:teacher"),
  teacherId: demoId("teacher:chen"),
  name: "Prof. Sarah Chen",
  email: "sarah.chen@example.test",
  role: "teacher",
  enrolledCourses: [],
};

const studentActor: ActorContext = {
  userId: demoId("auth:hari"),
  authId: demoId("auth:hari"),
  name: "Hari",
  email: "hari@example.test",
  role: "student",
  enrolledCourses: [
    {
      courseId: FIXTURE_COURSE_ID,
      studentId: demoId("student:hari"),
    },
  ],
};

describe("Demo Security & Admission", () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;

  const mockController = {
    getState: vi.fn().mockResolvedValue({
      courseId: FIXTURE_COURSE_ID,
      lectureId: null,
      activePollId: null,
      speech: { playing: false, speed: 1, nextIndex: 0, total: 30 },
      lastError: null,
    }),
    controlSpeech: vi.fn(),
    submitPollResponses: vi.fn(),
    instantMatch: vi.fn(),
    reset: vi.fn(),
    isMaintenanceActive: vi.fn().mockReturnValue(false),
  } as unknown as DemoController;

  const mockAuthGateway = {
    verifyToken: vi.fn(),
  };

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    app.use(
      createDemoRouter({
        auth: mockAuthGateway,
        controller: mockController,
        config: {
          origin: "http://localhost:3000",
          supabaseUrl: "http://127.0.0.1:54321",
          dbContainer: "supabase_db_HackOHIO-2026",
          tickRateMs: 4000,
          autoRespond: false,
        },
      }),
    );

    app.use(apiErrorHandler);

    const { promise, resolve } = Promise.withResolvers<void>();
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
    await promise;
  });

  afterEach(async () => {
    if (server) {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => resolve());
      await promise;
    }
  });

  it("sets Cache-Control: private, no-store on all demo responses", async () => {
    mockAuthGateway.verifyToken.mockResolvedValueOnce(chenActor);

    const res = await fetch(`${baseUrl}/api/demo/state`, {
      headers: {
        Authorization: "Bearer valid-token",
        Host: "localhost",
      },
    });

    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects unauthenticated requests with 401 UNAUTHORIZED", async () => {
    const res = await fetch(`${baseUrl}/api/demo/state`, {
      headers: {
        Host: "localhost",
      },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(DomainErrorCode.UNAUTHORIZED);
  });

  it("rejects non-loopback Host header with 403 FORBIDDEN", async () => {
    const url = new URL(`${baseUrl}/api/demo/state`);
    const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: string }>();
    const req = http.request(
      url,
      {
        method: "GET",
        headers: {
          Host: "evil-domain.com",
          Authorization: "Bearer valid-token",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: data });
        });
      },
    );
    req.on("error", reject);
    req.end();

    const res = await promise;
    expect(res.status).toBe(403);
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe(DomainErrorCode.FORBIDDEN);
  });

  it("rejects cross-site Origin with 403 FORBIDDEN", async () => {
    const res = await fetch(`${baseUrl}/api/demo/state`, {
      headers: {
        Host: "localhost",
        Origin: "http://malicious-site.com",
        Authorization: "Bearer valid-token",
      },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(DomainErrorCode.FORBIDDEN);
  });

  it("rejects extra body fields on /api/demo/speech with 400 VALIDATION_ERROR", async () => {
    mockAuthGateway.verifyToken.mockResolvedValueOnce(chenActor);

    const res = await fetch(`${baseUrl}/api/demo/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        lectureId: "22222222-2222-4222-8222-222222222222",
        action: "step",
        maliciousField: "injection",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(DomainErrorCode.VALIDATION_ERROR);
  });

  it("rejects extra body fields on /api/demo/poll-responses with 400 VALIDATION_ERROR", async () => {
    mockAuthGateway.verifyToken.mockResolvedValueOnce(chenActor);

    const res = await fetch(`${baseUrl}/api/demo/poll-responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        pollId: "33333333-3333-4333-8333-333333333333",
        extraData: "not-allowed",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(DomainErrorCode.VALIDATION_ERROR);
  });

  it("rejects extra body fields on /api/demo/instant-match with 400 VALIDATION_ERROR", async () => {
    mockAuthGateway.verifyToken.mockResolvedValueOnce(chenActor);

    const res = await fetch(`${baseUrl}/api/demo/instant-match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        hack: true,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(DomainErrorCode.VALIDATION_ERROR);
  });

  it("rejects extra body fields on /api/demo/reset with 400 VALIDATION_ERROR", async () => {
    mockAuthGateway.verifyToken.mockResolvedValueOnce(chenActor);

    const res = await fetch(`${baseUrl}/api/demo/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        force: true,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(DomainErrorCode.VALIDATION_ERROR);
  });

  it("rejects student mutation call on /api/demo/reset via controller authorization", async () => {
    mockAuthGateway.verifyToken.mockResolvedValueOnce(studentActor);
    vi.mocked(mockController.reset).mockRejectedValueOnce(
      new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Only Prof. Sarah Chen can perform demo management actions",
      }),
    );

    const res = await fetch(`${baseUrl}/api/demo/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(DomainErrorCode.FORBIDDEN);
  });
});
