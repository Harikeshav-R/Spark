import { describe, it, expect, vi } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext, Clock } from "../../../src/contracts/common.js";
import {
  ZoomOAuth,
} from "../../../src/server/zoom/zoom-oauth.js";

class TestClock implements Clock {
  currentTime: Date;
  constructor(iso = "2026-10-24T12:00:00.000Z") {
    this.currentTime = new Date(iso);
  }
  now(): Date {
    return this.currentTime;
  }
  nowISO(): string {
    return this.currentTime.toISOString();
  }
  setTime(iso: string): void {
    this.currentTime = new Date(iso);
  }
  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

// 64-char hex key (32 bytes)
const VALID_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const WRONG_KEY_HEX = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

interface TeacherRecord {
  id: string;
  auth_id: string;
  zoom_client_id: string | null;
  zoom_client_secret: string | null;
  zoom_refresh_token: string | null;
}

interface MockQueryBuilder {
  select: (_cols?: string) => MockQueryBuilder;
  eq: (col: string, val: unknown) => MockQueryBuilder;
  update: (payload: Partial<TeacherRecord>) => MockQueryBuilder;
  maybeSingle: () => Promise<{ data: TeacherRecord | null; error: null }>;
  then: <TResult1 = { data: TeacherRecord | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: TeacherRecord | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;
}

function createMockSupabaseClient(initialTeachers: TeacherRecord[]) {
  const teachers = [...initialTeachers];

  return {
    teachers,
    from: (table: string) => {
      if (table !== "teachers") {
        throw new Error(`Unexpected table: ${table}`);
      }

      let filterId: string | undefined;
      let filterAuthId: string | undefined;
      let filterRefreshToken: string | null | undefined;
      let updatePayload: Partial<TeacherRecord> | undefined;

      const execute = async () => {
        const rows = teachers.filter((t) => {
          if (filterId && t.id !== filterId) return false;
          if (filterAuthId && t.auth_id !== filterAuthId) return false;
          if (filterRefreshToken !== undefined && t.zoom_refresh_token !== filterRefreshToken) return false;
          return true;
        });

        if (updatePayload) {
          if (rows.length === 0) {
            return { data: null, error: null };
          }
          const target = rows[0]!;
          Object.assign(target, updatePayload);
          return { data: { ...target }, error: null };
        }

        const found = rows[0] ? { ...rows[0] } : null;
        return { data: found, error: null };
      };

      const builder: MockQueryBuilder = {
        select: (_cols?: string) => builder,
        eq: (col: string, val: unknown) => {
          if (col === "id") filterId = String(val);
          if (col === "auth_id") filterAuthId = String(val);
          if (col === "zoom_refresh_token") filterRefreshToken = val as string | null;
          return builder;
        },
        update: (payload: Partial<TeacherRecord>) => {
          updatePayload = payload;
          return builder;
        },
        maybeSingle: execute,
        then: (onfulfilled, onrejected) =>
          execute().then(onfulfilled, onrejected),
      };

      return builder;
    },
  };
}

describe("P6-B-04: ZoomOAuth Unit Tests", () => {
  const teacherId1 = "11111111-1111-4111-8111-111111111111";
  const teacherAuthId1 = "22222222-2222-4222-8222-222222222222";
  const teacherActor1: ActorContext = {
    userId: "22222222-2222-4222-8222-222222222222",
    authId: teacherAuthId1,
    email: "teacher1@example.edu",
    name: "Teacher One",
    role: "teacher",
    teacherId: teacherId1,
    enrolledCourses: [],
  };

  const teacherId2 = "33333333-3333-4333-8333-333333333333";
  const teacherAuthId2 = "44444444-4444-4444-8444-444444444444";
  const teacherActor2: ActorContext = {
    userId: "44444444-4444-4444-8444-444444444444",
    authId: teacherAuthId2,
    email: "teacher2@example.edu",
    name: "Teacher Two",
    role: "teacher",
    teacherId: teacherId2,
    enrolledCourses: [],
  };

  it("produces distinct ciphertexts for identical plaintext and decrypts successfully", async () => {
    const clock = new TestClock();
    const db = createMockSupabaseClient([
      {
        id: teacherId1,
        auth_id: teacherAuthId1,
        zoom_client_id: null,
        zoom_client_secret: null,
        zoom_refresh_token: null,
      },
    ]);

    const oauth = new ZoomOAuth({
      client: db as unknown as SupabaseClient,
      env: {
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_HEX,
        INTEGRATION_MODE: "live",
      },
      clock,
    });

    // Set credentials twice with same values
    await oauth.setClientCredentials(teacherActor1, teacherId1, {
      zoomClientId: "test_client_id_constant",
      zoomClientSecret: "test_client_secret_constant",
    });
    const cipher1 = db.teachers[0]!.zoom_client_id!;

    await oauth.setClientCredentials(teacherActor1, teacherId1, {
      zoomClientId: "test_client_id_constant",
      zoomClientSecret: "test_client_secret_constant",
    });
    const cipher2 = db.teachers[0]!.zoom_client_id!;

    // Different IVs -> different ciphertexts
    expect(cipher1).not.toBe(cipher2);
    expect(cipher1.startsWith("v1:")).toBe(true);
    expect(cipher2.startsWith("v1:")).toBe(true);

    // Refresh token was set to null on client credentials update
    expect(db.teachers[0]!.zoom_refresh_token).toBeNull();
  });

  it("rejects tampering, wrong keys, and AAD column/teacher substitution with 503", async () => {
    const clock = new TestClock();
    const db = createMockSupabaseClient([
      {
        id: teacherId1,
        auth_id: teacherAuthId1,
        zoom_client_id: null,
        zoom_client_secret: null,
        zoom_refresh_token: null,
      },
      {
        id: teacherId2,
        auth_id: teacherAuthId2,
        zoom_client_id: null,
        zoom_client_secret: null,
        zoom_refresh_token: null,
      },
    ]);

    const oauth = new ZoomOAuth({
      client: db as unknown as SupabaseClient,
      env: {
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_HEX,
        INTEGRATION_MODE: "live",
      },
      clock,
    });

    await oauth.setClientCredentials(teacherActor1, teacherId1, {
      zoomClientId: "client_id_t1",
      zoomClientSecret: "client_sec_t1",
    });

    // Substitute ciphertext from teacher 1 into teacher 2 (AAD mismatch)
    db.teachers[1]!.zoom_client_id = db.teachers[0]!.zoom_client_id;
    db.teachers[1]!.zoom_client_secret = db.teachers[0]!.zoom_client_secret;
    db.teachers[1]!.zoom_refresh_token = db.teachers[0]!.zoom_client_id;

    await expect(
      oauth.getCredentialStatus(teacherActor2, teacherId2)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      })
    );

    // Swap columns in teacher 1: put client_id ciphertext in client_secret
    db.teachers[0]!.zoom_client_secret = db.teachers[0]!.zoom_client_id;
    db.teachers[0]!.zoom_refresh_token = db.teachers[0]!.zoom_client_id;

    await expect(
      oauth.getCredentialStatus(teacherActor1, teacherId1)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      })
    );

    // Wrong decryption key
    const oauthWrongKey = new ZoomOAuth({
      client: db as unknown as SupabaseClient,
      env: {
        CREDENTIAL_ENCRYPTION_KEY: WRONG_KEY_HEX,
        INTEGRATION_MODE: "live",
      },
      clock,
    });

    await expect(
      oauthWrongKey.getCredentialStatus(teacherActor1, teacherId1)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      })
    );
  });

  it("reports configured status with client ID prefix without exposing secrets", async () => {
    const clock = new TestClock();
    const db = createMockSupabaseClient([
      {
        id: teacherId1,
        auth_id: teacherAuthId1,
        zoom_client_id: null,
        zoom_client_secret: null,
        zoom_refresh_token: null,
      },
    ]);

    const oauth = new ZoomOAuth({
      client: db as unknown as SupabaseClient,
      env: {
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_HEX,
        INTEGRATION_MODE: "live",
      },
      clock,
    });

    // Initially unconfigured
    const initialStatus = await oauth.getCredentialStatus(teacherActor1, teacherId1);
    expect(initialStatus).toEqual({ configured: false });

    // Set app credentials, but refresh token is still null
    await oauth.setClientCredentials(teacherActor1, teacherId1, {
      zoomClientId: "zoom_live_client_id_456",
      zoomClientSecret: "super_secret_key_789",
    });

    const pendingStatus = await oauth.getCredentialStatus(teacherActor1, teacherId1);
    expect(pendingStatus).toEqual({ configured: false });

    // Simulate completion of OAuth by storing encrypted refresh token
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access_token_1",
          refresh_token: "refresh_token_final_999",
          expires_in: 3600,
          token_type: "bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const liveOAuth = new ZoomOAuth({
      client: db as unknown as SupabaseClient,
      env: {
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_HEX,
        INTEGRATION_MODE: "live",
        ZOOM_REDIRECT_URI: "https://example.com/api/zoom/oauth/callback",
        APP_ORIGIN: "https://example.com",
      },
      clock,
      fetch: mockFetch as typeof globalThis.fetch,
    });

    const nonce = "browser_test_nonce_1234567890abcdef";
    const { authorizationUrl } = await liveOAuth.beginAuthorization(teacherActor1, teacherId1, nonce);
    const state = new URL(authorizationUrl).searchParams.get("state")!;

    await liveOAuth.completeAuthorization({
      state,
      browserNonce: nonce,
      code: "auth_code_from_zoom",
    });

    const completeStatus = await liveOAuth.getCredentialStatus(teacherActor1, teacherId1);
    expect(completeStatus).toEqual({
      configured: true,
      clientIdPrefix: "zoom",
    });
  });

  it("handles OAuth lifecycle errors: replay, expired state, nonce mismatch, and denied consent", async () => {
    const clock = new TestClock();
    const db = createMockSupabaseClient([
      {
        id: teacherId1,
        auth_id: teacherAuthId1,
        zoom_client_id: null,
        zoom_client_secret: null,
        zoom_refresh_token: null,
      },
    ]);

    const oauth = new ZoomOAuth({
      client: db as unknown as SupabaseClient,
      env: {
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_HEX,
        INTEGRATION_MODE: "live",
        ZOOM_REDIRECT_URI: "https://example.com/api/zoom/oauth/callback",
        APP_ORIGIN: "https://example.com",
        ZOOM_CLIENT_ID: "env_client_id",
        ZOOM_CLIENT_SECRET: "env_client_secret",
      },
      clock,
    });

    const nonce = "browser_nonce_1";
    const { authorizationUrl } = await oauth.beginAuthorization(teacherActor1, teacherId1, nonce);
    const state = new URL(authorizationUrl).searchParams.get("state")!;

    // Denied consent
    await expect(
      oauth.completeAuthorization({
        state,
        browserNonce: nonce,
        error: "access_denied",
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "BAD_REQUEST",
        statusCode: 400,
      })
    );

    // State was consumed and cannot be replayed
    await expect(
      oauth.completeAuthorization({
        state,
        browserNonce: nonce,
        code: "valid_code",
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "BAD_REQUEST",
        statusCode: 400,
      })
    );

    // Nonce mismatch
    const { authorizationUrl: url2 } = await oauth.beginAuthorization(teacherActor1, teacherId1, "nonce_2");
    const state2 = new URL(url2).searchParams.get("state")!;

    await expect(
      oauth.completeAuthorization({
        state: state2,
        browserNonce: "wrong_nonce",
        code: "valid_code",
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "BAD_REQUEST",
        statusCode: 400,
      })
    );

    // Expired state (> 10 minutes)
    const { authorizationUrl: url3 } = await oauth.beginAuthorization(teacherActor1, teacherId1, "nonce_3");
    const state3 = new URL(url3).searchParams.get("state")!;
    clock.advance(11 * 60 * 1000); // 11 minutes later

    await expect(
      oauth.completeAuthorization({
        state: state3,
        browserNonce: "nonce_3",
        code: "valid_code",
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "BAD_REQUEST",
        statusCode: 400,
      })
    );
  });

  it("serializes concurrent withTeacherCredentials calls and enforces CAS token update", async () => {
    const clock = new TestClock();
    const db = createMockSupabaseClient([
      {
        id: teacherId1,
        auth_id: teacherAuthId1,
        zoom_client_id: null,
        zoom_client_secret: null,
        zoom_refresh_token: null,
      },
    ]);

    const oauth = new ZoomOAuth({
      client: db as unknown as SupabaseClient,
      env: {
        CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_HEX,
        INTEGRATION_MODE: "live",
      },
      clock,
    });

    await oauth.setClientCredentials(teacherActor1, teacherId1, {
      zoomClientId: "zoom_client_1",
      zoomClientSecret: "zoom_secret_1",
    });

    // Mock initial refresh token in DB
    const key = Buffer.from(VALID_KEY_HEX, "hex");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`${teacherId1}:zoom_refresh_token`, "utf8"));
    const ct = Buffer.concat([cipher.update("initial_refresh_token_0", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    db.teachers[0]!.zoom_refresh_token = `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;

    const executedOrder: string[] = [];

    const { promise: p1Resume, resolve: resumeP1 } = Promise.withResolvers<void>();

    // Launch two parallel credential-using operations for the same teacher
    const p1 = oauth.withTeacherCredentials(teacherId1, async (auth, persist) => {
      executedOrder.push("start_1");
      expect(auth.zoomRefreshToken).toBe("initial_refresh_token_0");
      queueMicrotask(resumeP1);
      await p1Resume;
      await persist("rotated_refresh_token_1");
      executedOrder.push("end_1");
      return "res1";
    });

    const p2 = oauth.withTeacherCredentials(teacherId1, async (auth, persist) => {
      executedOrder.push("start_2");
      // Because p1 persisted rotated_refresh_token_1, p2 must read the updated token!
      expect(auth.zoomRefreshToken).toBe("rotated_refresh_token_1");
      await persist("rotated_refresh_token_2");
      executedOrder.push("end_2");
      return "res2";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("res1");
    expect(r2).toBe("res2");

    // Strictly serialized: start_1 -> end_1 -> start_2 -> end_2
    expect(executedOrder).toEqual(["start_1", "end_1", "start_2", "end_2"]);
  });
});
