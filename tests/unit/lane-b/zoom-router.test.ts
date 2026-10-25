import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import { AppError } from "../../../src/contracts/errors.js";
import {
  createZoomRouter,
  type ZoomRouterDependencies,
} from "../../../src/server/zoom/zoom-router.js";
import type { ZoomOAuth } from "../../../src/server/zoom/zoom-oauth.js";

describe("P6-B-04: Zoom Router Unit Tests", () => {
  const teacherId: UUID = "11111111-1111-4111-8111-111111111111";
  const otherTeacherId: UUID = "22222222-2222-4222-8222-222222222222";

  const teacherActor: ActorContext = {
    userId: "11111111-1111-4111-8111-111111111111",
    authId: "auth_t1",
    email: "teacher1@example.edu",
    name: "Teacher One",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: "33333333-3333-4333-8333-333333333333",
    authId: "auth_s1",
    email: "student1@example.edu",
    name: "Student One",
    role: "student",
    enrolledCourses: [
      {
        courseId: "33333333-3333-4333-8333-333333333333",
        studentId: "44444444-4444-4444-8444-444444444444",
      },
    ],
  };

  let mockActor: ActorContext | null = teacherActor;
  let mockOAuth: Partial<ZoomOAuth>;
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    mockActor = teacherActor;

    mockOAuth = {
      getCredentialStatus: vi.fn().mockImplementation(async (actor: ActorContext, tid: UUID) => {
        if (actor.role !== "teacher" || actor.teacherId !== tid) {
          throw new AppError({ code: "FORBIDDEN", statusCode: 403, message: "Forbidden" });
        }
        return { configured: true, clientIdPrefix: "test" };
      }),
      setClientCredentials: vi.fn().mockImplementation(async (actor: ActorContext, tid: UUID) => {
        if (actor.role !== "teacher" || actor.teacherId !== tid) {
          throw new AppError({ code: "FORBIDDEN", statusCode: 403, message: "Forbidden" });
        }
      }),
      beginAuthorization: vi.fn().mockImplementation(async (actor: ActorContext, tid: UUID) => {
        if (actor.role !== "teacher" || actor.teacherId !== tid) {
          throw new AppError({ code: "FORBIDDEN", statusCode: 403, message: "Forbidden" });
        }
        return { authorizationUrl: "https://zoom.us/oauth/authorize?response_type=code&state=mock_state" };
      }),
      completeAuthorization: vi.fn().mockImplementation(async (input: { state: string; browserNonce: string; code?: string; error?: string }) => {
        if (input.state === "invalid_state") {
          throw new AppError({ code: "BAD_REQUEST", statusCode: 400, message: "Invalid OAuth state" });
        }
      }),
    };

    const deps: ZoomRouterDependencies = {
      auth: {
        verifyToken: vi.fn().mockImplementation(async (token: string) => {
          if (token === "invalid_token" || !mockActor) {
            throw new AppError({ code: "UNAUTHORIZED", statusCode: 401, message: "Invalid token" });
          }
          return mockActor;
        }),
      },
      oauth: mockOAuth as ZoomOAuth,
      env: {
        APP_ORIGIN: "https://app.spark.example.com",
      },
    };

    app = express();
    app.use(createZoomRouter(deps));

    server = http.createServer(app);
    const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", () => listenResolve());
    await listenPromise;
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      const { promise: closePromise, resolve: closeResolve } = Promise.withResolvers<void>();
      server.close(() => closeResolve());
      await closePromise;
    }
  });

  describe("GET /api/teachers/:teacherId/zoom-credentials", () => {
    it("returns 401 when token is missing or invalid", async () => {
      const resMissing = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom-credentials`);
      expect(resMissing.status).toBe(401);

      const resInvalid = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom-credentials`, {
        headers: { Authorization: "Bearer invalid_token" },
      });
      expect(resInvalid.status).toBe(401);
    });

    it("returns 403 when authenticated user is not the owning teacher", async () => {
      mockActor = studentActor;
      const resStudent = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom-credentials`, {
        headers: { Authorization: "Bearer valid_token" },
      });
      expect(resStudent.status).toBe(403);

      mockActor = teacherActor;
      const resOtherTeacher = await fetch(`${baseUrl}/api/teachers/${otherTeacherId}/zoom-credentials`, {
        headers: { Authorization: "Bearer valid_token" },
      });
      expect(resOtherTeacher.status).toBe(403);
    });

    it("returns 200 with status and no secrets exposed, setting Cache-Control: no-store", async () => {
      const res = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom-credentials`, {
        headers: { Authorization: "Bearer valid_token" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-store");

      const body = (await res.json()) as { configured: boolean; clientIdPrefix?: string };
      expect(body).toEqual({ configured: true, clientIdPrefix: "test" });
    });
  });

  describe("PUT /api/teachers/:teacherId/zoom-credentials", () => {
    it("validates payload and rejects missing/blank credentials with 400", async () => {
      const resEmpty = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom-credentials`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid_token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ zoomClientId: "", zoomClientSecret: "sec" }),
      });
      expect(resEmpty.status).toBe(400);

      const resMissingSecret = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom-credentials`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid_token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ zoomClientId: "id" }),
      });
      expect(resMissingSecret.status).toBe(400);
    });

    it("returns 200 on successful update and sets Cache-Control: no-store", async () => {
      const res = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom-credentials`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid_token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          zoomClientId: "new_client_id_123",
          zoomClientSecret: "new_client_sec_456",
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-store");
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockOAuth.setClientCredentials).toHaveBeenCalledWith(teacherActor, teacherId, {
        zoomClientId: "new_client_id_123",
        zoomClientSecret: "new_client_sec_456",
      });
    });
  });

  describe("POST /api/teachers/:teacherId/zoom/oauth/start", () => {
    it("returns 200 with authorizationUrl and sets HttpOnly cookie", async () => {
      const res = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom/oauth/start`, {
        method: "POST",
        headers: { Authorization: "Bearer valid_token" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-store");

      const body = (await res.json()) as { authorizationUrl: string };
      expect(body.authorizationUrl).toContain("https://zoom.us/oauth/authorize");

      const cookieHeader = res.headers.get("set-cookie");
      expect(cookieHeader).toBeDefined();
      expect(cookieHeader).toContain("spark_zoom_oauth=");
      expect(cookieHeader).toContain("Path=/api/zoom/oauth/callback");
      expect(cookieHeader).toContain("SameSite=Lax");
      expect(cookieHeader).toContain("HttpOnly");
    });
  });

  describe("GET /api/zoom/oauth/callback", () => {
    it("returns 400 when state or nonce cookie is missing", async () => {
      // Missing state
      const resNoState = await fetch(`${baseUrl}/api/zoom/oauth/callback`, {
        headers: { Cookie: "spark_zoom_oauth=browser_nonce_123" },
      });
      expect(resNoState.status).toBe(400);

      // Missing cookie
      const resNoCookie = await fetch(`${baseUrl}/api/zoom/oauth/callback?state=some_state`);
      expect(resNoCookie.status).toBe(400);
    });

    it("returns 400 when oauth completes with error", async () => {
      const res = await fetch(`${baseUrl}/api/zoom/oauth/callback?state=invalid_state`, {
        headers: { Cookie: "spark_zoom_oauth=browser_nonce_123" },
      });
      expect(res.status).toBe(400);
    });

    it("redirects 303 to professor dashboard and clears cookie on success", async () => {
      const res = await fetch(`${baseUrl}/api/zoom/oauth/callback?state=mock_state&code=test_code`, {
        headers: { Cookie: "spark_zoom_oauth=browser_nonce_123" },
        redirect: "manual",
      });

      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(
        "https://app.spark.example.com/professor/dashboard?zoom=connected"
      );
      expect(res.headers.get("cache-control")).toContain("no-store");

      // Verify cookie was cleared
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeDefined();
      expect(setCookie).toMatch(/spark_zoom_oauth=;/);
    });
  });

  describe("malformed JSON error handling", () => {
    it("returns 400 VALIDATION_ERROR on malformed JSON payload", async () => {
      const res = await fetch(`${baseUrl}/api/teachers/${teacherId}/zoom-credentials`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid_token",
          "Content-Type": "application/json",
        },
        body: "{ this is not valid json",
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
