import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { ActorContext, Clock, ISOTimestamp } from "../../../src/contracts/common.js";
import {
  ZoomMeetingAdapter,
  createZoomAdapter,
  ZoomMeetingService,
} from "../../../src/server/zoom/zoom-meeting-adapter.js";
import type { ZoomOAuth, TeacherZoomAuth } from "../../../src/server/zoom/zoom-oauth.js";

class TestClock implements Clock {
  currentTime: Date;
  constructor(iso = "2026-10-24T12:00:00.000Z") {
    this.currentTime = new Date(iso);
  }
  now(): Date {
    return this.currentTime;
  }
  nowISO(): ISOTimestamp {
    return this.currentTime.toISOString();
  }
  setTime(iso: string): void {
    this.currentTime = new Date(iso);
  }
}

describe("P6-B-04: Zoom Meeting Adapter Unit Tests", () => {
  const teacherAuth: TeacherZoomAuth = {
    zoomClientId: "test_client_id_123",
    zoomClientSecret: "test_client_secret_abc",
    zoomRefreshToken: "refresh_token_initial_xyz",
  };

  const validTopic = "Peer Study Session: Linear Algebra";
  const validStartTime = "2026-10-24T14:00:00.000Z";
  const validDurationMinutes = 30;
  const webhookSecret = "secret_webhook_token_999";

  it("reports configured status when persistence callback is provided", () => {
    const clock = new TestClock();
    const adapter = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
      webhookSecret,
    });

    expect(adapter.isConfigured()).toBe(true);
  });

  it("rotates refresh token and persists it before creating scheduled meeting", async () => {
    const clock = new TestClock();
    const persistedTokens: string[] = [];
    const callOrder: string[] = [];

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr === "https://zoom.us/oauth/token") {
        callOrder.push("refresh_token_call");
        return new Response(
          JSON.stringify({
            access_token: "new_zoom_access_token_111",
            refresh_token: "rotated_refresh_token_222",
            expires_in: 3600,
            token_type: "bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr === "https://api.zoom.us/v2/users/me/meetings") {
        callOrder.push("create_meeting_call");
        expect(init?.method).toBe("POST");
        const headers = init?.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer new_zoom_access_token_111");
        expect(headers["Content-Type"]).toBe("application/json");

        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({
          topic: validTopic,
          type: 2,
          start_time: validStartTime,
          duration: validDurationMinutes,
          timezone: "UTC",
          settings: {
            join_before_host: true,
            waiting_room: false,
          },
        });

        return new Response(
          JSON.stringify({
            id: 98765432101,
            join_url: "https://zoom.us/j/98765432101?pwd=secureMeetingSecret123",
            start_url: "https://zoom.us/s/98765432101?zak=doNotLeakThis",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected url: ${urlStr}`);
    });

    const persistRefreshToken = async (next: string) => {
      callOrder.push("persist_refresh_token");
      persistedTokens.push(next);
    };

    const adapter = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken,
      fetch: mockFetch as typeof globalThis.fetch,
      webhookSecret,
    });

    const result = await adapter.createMeeting(
      teacherAuth,
      validTopic,
      validStartTime,
      validDurationMinutes
    );

    expect(result).toEqual({
      meetingId: "98765432101",
      joinUrl: "https://zoom.us/j/98765432101?pwd=secureMeetingSecret123",
    });

    // Check strict sequence: token refresh -> token persist -> meeting create
    expect(callOrder).toEqual([
      "refresh_token_call",
      "persist_refresh_token",
      "create_meeting_call",
    ]);
    expect(persistedTokens).toEqual(["rotated_refresh_token_222"]);
  });

  it("rejects incomplete teacher credentials with 503 SERVICE_UNAVAILABLE", async () => {
    const clock = new TestClock();
    const adapter = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
    });

    await expect(
      adapter.createMeeting(
        { zoomClientId: "", zoomClientSecret: "sec", zoomRefreshToken: "ref" },
        validTopic,
        validStartTime,
        validDurationMinutes
      )
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      })
    );

    await expect(
      adapter.createMeeting(
        { zoomClientId: "id", zoomClientSecret: "", zoomRefreshToken: "ref" },
        validTopic,
        validStartTime,
        validDurationMinutes
      )
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      })
    );

    await expect(
      adapter.createMeeting(
        { zoomClientId: "id", zoomClientSecret: "sec", zoomRefreshToken: "" },
        validTopic,
        validStartTime,
        validDurationMinutes
      )
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      })
    );
  });

  it("validates boundary inputs for topic, startTime, and durationMinutes", async () => {
    const clock = new TestClock();
    const adapter = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
    });

    // Empty topic
    await expect(
      adapter.createMeeting(teacherAuth, "   ", validStartTime, validDurationMinutes)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      })
    );

    // Invalid ISO timestamp
    await expect(
      adapter.createMeeting(teacherAuth, validTopic, "invalid-timestamp", validDurationMinutes)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      })
    );

    // Non-positive or non-integer duration
    await expect(
      adapter.createMeeting(teacherAuth, validTopic, validStartTime, 0)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      })
    );

    await expect(
      adapter.createMeeting(teacherAuth, validTopic, validStartTime, 30.5)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      })
    );
  });

  it("handles token refresh failures: invalid credentials (503), timeout (504), network failure (502)", async () => {
    const clock = new TestClock();

    // 401 Unauthorized from token endpoint
    const fetchAuthFail = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );
    const adapterAuthFail = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
      fetch: fetchAuthFail as typeof globalThis.fetch,
    });
    await expect(
      adapterAuthFail.createMeeting(teacherAuth, validTopic, validStartTime, validDurationMinutes)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      })
    );

    // Timeout from token endpoint
    const timeoutErr = new Error("Abort");
    timeoutErr.name = "TimeoutError";
    const fetchTimeout = vi.fn().mockRejectedValue(timeoutErr);
    const adapterTimeout = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
      fetch: fetchTimeout as typeof globalThis.fetch,
    });
    await expect(
      adapterTimeout.createMeeting(teacherAuth, validTopic, validStartTime, validDurationMinutes)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "GATEWAY_TIMEOUT",
        statusCode: 504,
      })
    );

    // Network error from token endpoint
    const fetchNetFail = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const adapterNetFail = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
      fetch: fetchNetFail as typeof globalThis.fetch,
    });
    await expect(
      adapterNetFail.createMeeting(teacherAuth, validTopic, validStartTime, validDurationMinutes)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "BAD_GATEWAY",
        statusCode: 502,
      })
    );
  });

  it("handles meeting creation failures: credential rejected (503), timeout (504), upstream error (502)", async () => {
    const clock = new TestClock();
    const okTokenResponse = new Response(
      JSON.stringify({
        access_token: "tok",
        refresh_token: "rot",
        expires_in: 3600,
        token_type: "bearer",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    // Meeting endpoint 403
    const fetchMeeting403 = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/oauth/token")) return okTokenResponse.clone();
      return new Response("Forbidden", { status: 403 });
    });
    const adapter403 = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
      fetch: fetchMeeting403 as typeof globalThis.fetch,
    });
    await expect(
      adapter403.createMeeting(teacherAuth, validTopic, validStartTime, validDurationMinutes)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      })
    );

    // Meeting endpoint timeout
    const timeoutErr = new Error("Abort");
    timeoutErr.name = "TimeoutError";
    const fetchMeetingTimeout = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/oauth/token")) return okTokenResponse.clone();
      throw timeoutErr;
    });
    const adapterMeetingTimeout = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
      fetch: fetchMeetingTimeout as typeof globalThis.fetch,
    });
    await expect(
      adapterMeetingTimeout.createMeeting(teacherAuth, validTopic, validStartTime, validDurationMinutes)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "GATEWAY_TIMEOUT",
        statusCode: 504,
      })
    );

    // Meeting endpoint non-201
    const fetchMeeting500 = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/oauth/token")) return okTokenResponse.clone();
      return new Response("Internal Server Error", { status: 500 });
    });
    const adapterMeeting500 = new ZoomMeetingAdapter({
      clock,
      persistRefreshToken: async () => {},
      fetch: fetchMeeting500 as typeof globalThis.fetch,
    });
    await expect(
      adapterMeeting500.createMeeting(teacherAuth, validTopic, validStartTime, validDurationMinutes)
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "BAD_GATEWAY",
        statusCode: 502,
      })
    );
  });

  it("validates join_url domain, protocol, credentials, fragment, and port security", async () => {
    const clock = new TestClock();
    const okTokenResponse = new Response(
      JSON.stringify({
        access_token: "tok",
        refresh_token: "rot",
        expires_in: 3600,
        token_type: "bearer",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const testJoinUrl = async (badUrl: string) => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("/oauth/token")) return okTokenResponse.clone();
        return new Response(
          JSON.stringify({ id: 123456, join_url: badUrl }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      });
      const adapter = new ZoomMeetingAdapter({
        clock,
        persistRefreshToken: async () => {},
        fetch: mockFetch as typeof globalThis.fetch,
      });
      return adapter.createMeeting(teacherAuth, validTopic, validStartTime, validDurationMinutes);
    };

    // Non-HTTPS
    await expect(testJoinUrl("http://zoom.us/j/123456")).rejects.toThrowError(
      expect.objectContaining({ code: "BAD_GATEWAY", statusCode: 502 })
    );

    // Embedded credentials
    await expect(testJoinUrl("https://user:pass@zoom.us/j/123456")).rejects.toThrowError(
      expect.objectContaining({ code: "BAD_GATEWAY", statusCode: 502 })
    );

    // Fragments
    await expect(testJoinUrl("https://zoom.us/j/123456#fragment")).rejects.toThrowError(
      expect.objectContaining({ code: "BAD_GATEWAY", statusCode: 502 })
    );

    // Custom port
    await expect(testJoinUrl("https://zoom.us:8443/j/123456")).rejects.toThrowError(
      expect.objectContaining({ code: "BAD_GATEWAY", statusCode: 502 })
    );

    // Non-zoom domain
    await expect(testJoinUrl("https://evil-phishing.com/j/123456")).rejects.toThrowError(
      expect.objectContaining({ code: "BAD_GATEWAY", statusCode: 502 })
    );

    // Valid zoom.com subdomain
    const okSubdomain = await testJoinUrl("https://mycompany.zoom.com/j/123456?pwd=abc");
    expect(okSubdomain.joinUrl).toBe("https://mycompany.zoom.com/j/123456?pwd=abc");
  });

  describe("webhook signature validation", () => {
    it("validates authentic webhook HMAC with timestamp freshness", () => {
      const clock = new TestClock("2026-10-24T12:00:00.000Z");
      const adapter = new ZoomMeetingAdapter({
        clock,
        persistRefreshToken: async () => {},
        webhookSecret,
      });

      const rawBody = JSON.stringify({ event: "meeting.started", payload: { id: "123" } });
      const nowSec = Math.floor(clock.now().getTime() / 1000);
      const timestamp = String(nowSec);

      const message = `v0:${timestamp}:${rawBody}`;
      const signature = `v0=${createHmac("sha256", webhookSecret).update(message).digest("hex")}`;

      // Valid signature
      expect(adapter.validateWebhookSignature(rawBody, signature, timestamp)).toBe(true);

      // Boundary: exactly 300 seconds past
      const past300 = String(nowSec - 300);
      const pastSig = `v0=${createHmac("sha256", webhookSecret).update(`v0:${past300}:${rawBody}`).digest("hex")}`;
      expect(adapter.validateWebhookSignature(rawBody, pastSig, past300)).toBe(true);

      // Boundary: exactly 300 seconds future
      const future300 = String(nowSec + 300);
      const futureSig = `v0=${createHmac("sha256", webhookSecret).update(`v0:${future300}:${rawBody}`).digest("hex")}`;
      expect(adapter.validateWebhookSignature(rawBody, futureSig, future300)).toBe(true);

      // Skew beyond 300 seconds: rejected
      const past301 = String(nowSec - 301);
      const past301Sig = `v0=${createHmac("sha256", webhookSecret).update(`v0:${past301}:${rawBody}`).digest("hex")}`;
      expect(adapter.validateWebhookSignature(rawBody, past301Sig, past301)).toBe(false);

      const future301 = String(nowSec + 301);
      const future301Sig = `v0=${createHmac("sha256", webhookSecret).update(`v0:${future301}:${rawBody}`).digest("hex")}`;
      expect(adapter.validateWebhookSignature(rawBody, future301Sig, future301)).toBe(false);

      // Tampered body
      expect(adapter.validateWebhookSignature(rawBody + "tamper", signature, timestamp)).toBe(false);

      // Missing or wrong secret
      const noSecretAdapter = new ZoomMeetingAdapter({
        clock,
        persistRefreshToken: async () => {},
      });
      expect(noSecretAdapter.validateWebhookSignature(rawBody, signature, timestamp)).toBe(false);

      // Malformed signature format
      expect(adapter.validateWebhookSignature(rawBody, "invalid_sig_without_v0", timestamp)).toBe(false);
    });
  });

  describe("createZoomAdapter factory & ZoomMeetingService", () => {
    it("returns deterministic fixture adapter in fixture mode without live credentials", async () => {
      const clock = new TestClock();
      const adapter = createZoomAdapter({
        mode: "fixture",
        clock,
        persistRefreshToken: async () => {},
      });

      expect(adapter.isConfigured()).toBe(true);

      const meeting = await adapter.createMeeting(
        { zoomClientId: "f", zoomClientSecret: "f", zoomRefreshToken: "f" },
        validTopic,
        validStartTime,
        validDurationMinutes
      );

      expect(meeting).toEqual({
        meetingId: "9876543210",
        joinUrl: "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
      });
    });

    it("ZoomMeetingService uses course teacher ID and delegates to adapter", async () => {
      const clock = new TestClock();
      const courseId = "11111111-1111-4111-8111-111111111111";
      const teacherId = "22222222-2222-4222-8222-222222222222";

      const actor: ActorContext = {
        userId: "55555555-5555-4555-8555-555555555555",
        authId: "auth_user_1",
        email: "student1@example.edu",
        name: "Student One",
        role: "student",
        enrolledCourses: [{ courseId, studentId: "77777777-7777-4777-8777-777777777777" }],
      };

      const mockCourses = {
        getCourse: vi.fn().mockResolvedValue({
          id: courseId,
          teacherId,
          name: "CS 101",
          joinCode: "CS101A",
          createdAt: clock.nowISO(),
        }),
      };

      const mockOAuth = {
        withTeacherCredentials: vi.fn().mockImplementation(async (tid: string, action: (auth: TeacherZoomAuth, persist: (next: string) => Promise<void>) => Promise<unknown>) => {
          expect(tid).toBe(teacherId);
          return action(teacherAuth, async () => {});
        }),
      } as unknown as ZoomOAuth;

      // Fixture mode
      const fixtureService = new ZoomMeetingService({
        oauth: mockOAuth,
        courses: mockCourses,
        env: { INTEGRATION_MODE: "fixture" },
        clock,
      });

      const fixtureMeeting = await fixtureService.createForCourse(
        actor,
        courseId,
        validTopic,
        validStartTime,
        validDurationMinutes
      );
      expect(fixtureMeeting.meetingId).toBe("9876543210");
      expect(mockOAuth.withTeacherCredentials).not.toHaveBeenCalled();

      // Live mode with mock fetch
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("/oauth/token")) {
          return new Response(
            JSON.stringify({
              access_token: "tok",
              refresh_token: "rot",
              expires_in: 3600,
              token_type: "bearer",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            id: 555666777,
            join_url: "https://zoom.us/j/555666777?pwd=liveMeetingPwd",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      });

      const liveService = new ZoomMeetingService({
        oauth: mockOAuth,
        courses: mockCourses,
        env: { INTEGRATION_MODE: "live" },
        clock,
        fetch: mockFetch as typeof globalThis.fetch,
      });

      const liveMeeting = await liveService.createForCourse(
        actor,
        courseId,
        validTopic,
        validStartTime,
        validDurationMinutes
      );

      expect(liveMeeting).toEqual({
        meetingId: "555666777",
        joinUrl: "https://zoom.us/j/555666777?pwd=liveMeetingPwd",
      });
      expect(mockOAuth.withTeacherCredentials).toHaveBeenCalledTimes(1);
    });

    it("ZoomMeetingService rejects invalid INTEGRATION_MODE with 503", async () => {
      const clock = new TestClock();
      const courseId = "11111111-1111-4111-8111-111111111111";
      const actor: ActorContext = {
        userId: "66666666-6666-4666-8666-666666666666",
        authId: "auth_user_1",
        email: "teacher1@example.edu",
        name: "Teacher One",
        role: "teacher",
        teacherId: "22222222-2222-4222-8222-222222222222",
        enrolledCourses: [],
      };

      const mockCourses = {
        getCourse: vi.fn().mockResolvedValue({
          id: courseId,
          teacherId: "22222222-2222-4222-8222-222222222222",
          name: "CS 101",
          joinCode: "CS101A",
          createdAt: clock.nowISO(),
        }),
      };

      const service = new ZoomMeetingService({
        oauth: {} as ZoomOAuth,
        courses: mockCourses,
        env: { INTEGRATION_MODE: "invalid_mode" },
        clock,
      });

      await expect(
        service.createForCourse(actor, courseId, validTopic, validStartTime, validDurationMinutes)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
        })
      );
    });
  });
});
