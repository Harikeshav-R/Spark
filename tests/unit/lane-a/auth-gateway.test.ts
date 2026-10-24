import { describe, it, expect, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import { type AddressInfo } from "node:net";
import { AppError } from "../../../src/contracts/errors";
import { type ActorContext } from "../../../src/contracts/common";
import { createSupabaseClients } from "../../../src/server/platform/supabase";
import {
  createAuthGateway,
  type AuthClientPort,
  type DatabaseClientPort,
} from "../../../src/server/platform/auth";
import { requireAuth } from "../../../src/server/platform/middleware/require-auth";

describe("P1-A-01: Auth Gateway & Middleware", () => {
  const teacherAuthId = "11111111-1111-4111-8111-111111111111";
  const teacherId = "22222222-2222-4222-8222-222222222222";
  const studentAuthId = "33333333-3333-4333-8333-333333333333";
  const studentId1 = "44444444-4444-4444-8444-444444444444";
  const studentId2 = "55555555-5555-4555-8555-555555555555";
  const courseId1 = "66666666-6666-4666-8666-666666666666";
  const courseId2 = "77777777-7777-4777-8777-777777777777";

  describe("1. Valid teacher", () => {
    it("derives teacher role with teacherId, userId/authId = auth ID", async () => {
      const authClient: AuthClientPort = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: teacherAuthId,
                email: "prof@example.com",
                user_metadata: { name: "Professor Spark" },
              },
            },
            error: null,
          }),
        },
      };

      const databaseClient: DatabaseClientPort = {
        from: vi.fn((table: string) => {
          if (table === "teachers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: teacherId,
                      auth_id: teacherAuthId,
                      name: "Professor Spark",
                      email: "prof@example.com",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "students") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
      };

      const gateway = createAuthGateway(authClient, databaseClient);
      const actor = await gateway.verifyToken("valid-teacher-jwt");

      expect(actor).toEqual<ActorContext>({
        userId: teacherAuthId,
        authId: teacherAuthId,
        teacherId: teacherId,
        role: "teacher",
        name: "Professor Spark",
        email: "prof@example.com",
        enrolledCourses: [],
      });
      expect(actor.userId).not.toBe(actor.teacherId);
    });
  });

  describe("2. Valid student with multiple enrollments", () => {
    it("retains all enrollments and keeps userId tied to authId regardless of row order", async () => {
      const authClient: AuthClientPort = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: studentAuthId,
                email: "student@example.com",
                user_metadata: { name: "Alice Student" },
              },
            },
            error: null,
          }),
        },
      };

      const databaseClient: DatabaseClientPort = {
        from: vi.fn((table: string) => {
          if (table === "teachers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "students") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: studentId1,
                      auth_id: studentAuthId,
                      course_id: courseId1,
                      name: "Alice Student",
                      email: "student@example.com",
                    },
                    {
                      id: studentId2,
                      auth_id: studentAuthId,
                      course_id: courseId2,
                      name: "Alice Student",
                      email: "student@example.com",
                    },
                  ],
                  error: null,
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
      };

      const gateway = createAuthGateway(authClient, databaseClient);
      const actor = await gateway.verifyToken("valid-student-jwt");

      expect(actor.role).toBe("student");
      expect(actor.teacherId).toBeUndefined();
      expect(actor.userId).toBe(studentAuthId);
      expect(actor.authId).toBe(studentAuthId);
      expect(actor.enrolledCourses).toHaveLength(2);
      expect(actor.enrolledCourses).toEqual([
        { studentId: studentId1, courseId: courseId1 },
        { studentId: studentId2, courseId: courseId2 },
      ]);
    });
  });

  describe("3. Unenrolled student & metadata tampering resistance", () => {
    it("assigns student role with empty enrollments and ignores forged user_metadata.role", async () => {
      const authClient: AuthClientPort = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: studentAuthId,
                email: "attacker@example.com",
                user_metadata: {
                  role: "teacher",
                  teacherId: "00000000-0000-0000-0000-000000000000",
                },
              },
            },
            error: null,
          }),
        },
      };

      const databaseClient: DatabaseClientPort = {
        from: vi.fn((table: string) => {
          if (table === "teachers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "students") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
      };

      const gateway = createAuthGateway(authClient, databaseClient);
      const actor = await gateway.verifyToken("tampered-metadata-jwt");

      expect(actor.role).toBe("student");
      expect(actor.teacherId).toBeUndefined();
      expect(actor.enrolledCourses).toEqual([]);
      expect(actor.name).toBe("attacker@example.com");
    });
  });

  describe("4. Error handling & fail-closed behavior", () => {
    it("maps invalid/expired token to 401 and performs zero database access", async () => {
      const authClient: AuthClientPort = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: "Invalid token", status: 401 },
          }),
        },
      };
      const databaseClient: DatabaseClientPort = {
        from: vi.fn(),
      };

      const gateway = createAuthGateway(authClient, databaseClient);
      await expect(gateway.verifyToken("bad-jwt")).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
      expect(databaseClient.from).not.toHaveBeenCalled();
    });

    it("maps missing user in successful response to 401", async () => {
      const authClient: AuthClientPort = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: null,
          }),
        },
      };
      const databaseClient: DatabaseClientPort = {
        from: vi.fn(),
      };

      const gateway = createAuthGateway(authClient, databaseClient);
      await expect(gateway.verifyToken("empty-user-jwt")).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
      expect(databaseClient.from).not.toHaveBeenCalled();
    });

    it("maps transport failure / 5xx to 503 SERVICE_UNAVAILABLE", async () => {
      const authClient: AuthClientPort = {
        auth: {
          getUser: vi.fn().mockRejectedValue(new Error("Network connection refused")),
        },
      };
      const databaseClient: DatabaseClientPort = {
        from: vi.fn(),
      };

      const gateway = createAuthGateway(authClient, databaseClient);
      await expect(gateway.verifyToken("network-err-jwt")).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("maps database profile query failure to 500, never falling back to student", async () => {
      const authClient: AuthClientPort = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: teacherAuthId,
                email: "prof@example.com",
              },
            },
            error: null,
          }),
        },
      };
      const databaseClient: DatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "connection timeout", code: "57014" },
              }),
            }),
          }),
        }),
      };

      const gateway = createAuthGateway(authClient, databaseClient);
      await expect(gateway.verifyToken("valid-jwt-with-db-error")).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });
  });

  describe("5. Middleware real HTTP probe", () => {
    it("verifies Authorization header, rejects tampering, and handles errors", async () => {
      const mockGateway = {
        verifyToken: vi.fn(async (token: string): Promise<ActorContext> => {
          if (token === "good-token") {
            return {
              userId: teacherAuthId,
              authId: teacherAuthId,
              teacherId,
              role: "teacher",
              name: "Professor Spark",
              email: "prof@example.com",
              enrolledCourses: [],
            };
          }
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Unauthorized",
          });
        }),
      };

      const app = express();
      app.use(express.json());
      app.use(requireAuth(mockGateway));

      app.get("/api/probe", (req: Request, res: Response) => {
        res.json({ actor: req.actor });
      });

      // Express error handler using AppError.toResponse()
      app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (err instanceof AppError) {
          res.status(err.statusCode).json(err.toResponse());
          return;
        }
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Internal server error",
            requestId: "00000000-0000-0000-0000-000000000000",
          },
        });
      });

      const server = http.createServer(app);
      const { promise: listenPromise, resolve: listenResolve } =
        Promise.withResolvers<void>();
      server.listen(0, () => listenResolve());
      await listenPromise;

      const port = (server.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // A. Valid token -> 200 with actor
        const resOk = await fetch(`${baseUrl}/api/probe`, {
          headers: {
            Authorization: "Bearer good-token",
          },
        });
        expect(resOk.status).toBe(200);
        const bodyOk = (await resOk.json()) as { actor: ActorContext };
        expect(bodyOk.actor.userId).toBe(teacherAuthId);
        expect(bodyOk.actor.role).toBe("teacher");

        // B. Query & body tampering attempts cannot alter actor
        const resTamper = await fetch(
          `${baseUrl}/api/probe?role=student&userId=00000000-0000-0000-0000-000000000000`,
          {
            method: "GET",
            headers: {
              Authorization: "Bearer good-token",
            },
          },
        );
        expect(resTamper.status).toBe(200);
        const bodyTamper = (await resTamper.json()) as { actor: ActorContext };
        expect(bodyTamper.actor.userId).toBe(teacherAuthId);
        expect(bodyTamper.actor.role).toBe("teacher");

        // C. Missing Authorization header -> 401
        const resNoAuth = await fetch(`${baseUrl}/api/probe`);
        expect(resNoAuth.status).toBe(401);
        const bodyNoAuth = (await resNoAuth.json()) as { error: { code: string } };
        expect(bodyNoAuth.error.code).toBe("UNAUTHORIZED");

        // D. Malformed scheme (Basic) -> 401
        const resBasic = await fetch(`${baseUrl}/api/probe`, {
          headers: {
            Authorization: "Basic dXNlcjpwYXNz",
          },
        });
        expect(resBasic.status).toBe(401);

        // E. Duplicate Authorization headers -> 401
        const resMulti = await fetch(`${baseUrl}/api/probe`, {
          headers: [
            ["Authorization", "Bearer token1"],
            ["Authorization", "Bearer token2"],
          ],
        });
        expect(resMulti.status).toBe(401);

        // F. Invalid token -> 401
        const resBadToken = await fetch(`${baseUrl}/api/probe`, {
          headers: {
            Authorization: "Bearer bad-token",
          },
        });
        expect(resBadToken.status).toBe(401);
      } finally {
        const { promise: closePromise, resolve: closeResolve } =
          Promise.withResolvers<void>();
        server.close(() => closeResolve());
        await closePromise;
      }
    });
  });

  describe("6. Supabase client factory configuration & isolation", () => {
    it("throws 503 if required environment variables are missing", () => {
      expect(() => createSupabaseClients({})).toThrow();
      try {
        createSupabaseClients({});
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(503);
        expect(appErr.code).toBe("SERVICE_UNAVAILABLE");
        expect(appErr.message).toContain("SUPABASE_URL");
        expect(appErr.message).toContain("SUPABASE_ANON_KEY");
        expect(appErr.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
      }
    });

    it("creates two distinct clients configured with anon key and service role key", async () => {
      const capturedRequests: Array<{ url: string; headers: Record<string, string> }> = [];

      const mockServer = http.createServer((req, res) => {
        capturedRequests.push({
          url: req.url ?? "",
          headers: req.headers as Record<string, string>,
        });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({}));
      });

      const { promise: listenPromise, resolve: listenResolve } =
        Promise.withResolvers<void>();
      mockServer.listen(0, () => listenResolve());
      await listenPromise;

      const mockPort = (mockServer.address() as AddressInfo).port;
      const mockUrl = `http://127.0.0.1:${mockPort}`;

      try {
        const { authClient, databaseClient } = createSupabaseClients({
          SUPABASE_URL: mockUrl,
          SUPABASE_ANON_KEY: "anon-test-key-12345",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key-67890",
        });

        // Trigger auth request
        await authClient.auth.getUser("sample-caller-jwt").catch(() => {});

        // Trigger database request
        try {
          await databaseClient.from("teachers").select("id");
        } catch {
          // ignore network response parsing in mock server
        }

        expect(capturedRequests.length).toBeGreaterThanOrEqual(2);

        const authReq = capturedRequests.find((r) => r.url.includes("/auth/v1"));
        expect(authReq).toBeDefined();
        expect(authReq?.headers["apikey"]).toBe("anon-test-key-12345");
        expect(authReq?.headers["authorization"]).toBe("Bearer sample-caller-jwt");

        const dbReq = capturedRequests.find((r) => r.url.includes("/rest/v1"));
        expect(dbReq).toBeDefined();
        expect(dbReq?.headers["apikey"]).toBe("service-role-test-key-67890");
        expect(dbReq?.headers["authorization"]).toBe("Bearer service-role-test-key-67890");
        expect(dbReq?.headers["authorization"]).not.toBe("Bearer sample-caller-jwt");
      } finally {
        const { promise: closePromise, resolve: closeResolve } =
          Promise.withResolvers<void>();
        mockServer.close(() => closeResolve());
        await closePromise;
      }
    });
  });
});
