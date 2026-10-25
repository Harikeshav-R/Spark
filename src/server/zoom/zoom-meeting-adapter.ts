import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  ActorContext,
  Clock,
  ISOTimestamp,
  UUID,
} from "../../contracts/common.js";
import {
  isoTimestampSchema,
  uuidSchema,
} from "../../contracts/common.js";
import type { ZoomAdapter } from "../../contracts/classroom.js";
import { AppError } from "../../contracts/errors.js";
import type { CourseService } from "../core/index.js";
import {
  ZoomOAuth,
  requestZoomTokens,
} from "./zoom-oauth.js";

const FIXTURE_MEETING_ID = "9876543210";
const FIXTURE_JOIN_URL =
  "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123";

const meetingInputSchema = z.object({
  topic: z.string().trim().min(1),
  startTime: isoTimestampSchema,
  durationMinutes: z.number().int().positive().finite(),
});

function validateZoomJoinUrl(urlStr: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom meeting join_url is not a valid URL",
    });
  }

  if (parsed.protocol !== "https:") {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom join URL must use HTTPS",
    });
  }

  if (parsed.username || parsed.password) {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom join URL must not contain embedded credentials",
    });
  }

  if (parsed.hash) {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom join URL must not contain fragments",
    });
  }

  if (parsed.port && parsed.port !== "443") {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom join URL must use default HTTPS port",
    });
  }

  const host = parsed.hostname.toLowerCase();
  const isZoomUs = host === "zoom.us" || host.endsWith(".zoom.us");
  const isZoomCom = host === "zoom.com" || host.endsWith(".zoom.com");

  if (!isZoomUs && !isZoomCom) {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom join URL must belong to zoom.us or zoom.com domain",
    });
  }

  return urlStr;
}

function verifyHmacSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  secret: string | undefined,
  clock: Clock
): boolean {
  if (!secret || secret.trim().length === 0) {
    return false;
  }

  if (!signature || !timestamp || typeof rawBody !== "string") {
    return false;
  }

  if (!/^\d+$/.test(timestamp)) {
    return false;
  }

  const tsSec = parseInt(timestamp, 10);
  const nowSec = Math.floor(clock.now().getTime() / 1000);

  if (Math.abs(nowSec - tsSec) > 300) {
    return false;
  }

  if (!/^v0=[0-9a-fA-F]{64}$/.test(signature)) {
    return false;
  }

  const message = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac("sha256", secret).update(message, "utf8").digest("hex");
  const expectedSignature = `v0=${hmac}`;

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(signature, "utf8"),
    Buffer.from(expectedSignature, "utf8")
  );
}

export interface ZoomMeetingAdapterDependencies {
  clock: Clock;
  persistRefreshToken: (next: string) => Promise<void>;
  fetch?: typeof globalThis.fetch;
  webhookSecret?: string;
}

export class ZoomMeetingAdapter implements ZoomAdapter {
  private readonly clock: Clock;
  private readonly persistRefreshToken: (next: string) => Promise<void>;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly webhookSecret?: string;

  constructor(dependencies: ZoomMeetingAdapterDependencies) {
    this.clock = dependencies.clock;
    this.persistRefreshToken = dependencies.persistRefreshToken;
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.webhookSecret = dependencies.webhookSecret;
  }

  isConfigured(): boolean {
    return typeof this.persistRefreshToken === "function";
  }

  async createMeeting(
    teacherAuth: { zoomClientId: string; zoomClientSecret: string; zoomRefreshToken: string },
    topic: string,
    startTime: ISOTimestamp,
    durationMinutes: number
  ): Promise<{ meetingId: string; joinUrl: string }> {
    if (
      !teacherAuth ||
      !teacherAuth.zoomClientId?.trim() ||
      !teacherAuth.zoomClientSecret?.trim() ||
      !teacherAuth.zoomRefreshToken?.trim()
    ) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom credentials are not configured",
      });
    }

    const inputValidation = meetingInputSchema.safeParse({
      topic,
      startTime,
      durationMinutes,
    });
    if (!inputValidation.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid meeting creation input parameters",
        cause: inputValidation.error,
      });
    }

    const { accessToken, refreshToken: rotatedRefreshToken } = await requestZoomTokens({
      grant: "refresh_token",
      auth: {
        zoomClientId: teacherAuth.zoomClientId,
        zoomClientSecret: teacherAuth.zoomClientSecret,
      },
      refreshToken: teacherAuth.zoomRefreshToken,
      fetch: this.fetchImpl,
    });

    await this.persistRefreshToken(rotatedRefreshToken);

    const meetingPayload = {
      topic: inputValidation.data.topic,
      type: 2,
      start_time: new Date(inputValidation.data.startTime).toISOString(),
      duration: inputValidation.data.durationMinutes,
      timezone: "UTC",
      settings: {
        join_before_host: true,
        waiting_room: false,
      },
    };

    let response: Response;
    try {
      response = await this.fetchImpl("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(meetingPayload),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        ("name" in err && (err.name === "TimeoutError" || err.name === "AbortError"))
      ) {
        throw new AppError({
          code: "GATEWAY_TIMEOUT",
          statusCode: 504,
          message: "Zoom meeting request timed out",
        });
      }
      throw new AppError({
        code: "BAD_GATEWAY",
        statusCode: 502,
        message: "Zoom meeting request failed",
        cause: err,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom credentials rejected",
      });
    }

    if (response.status !== 201) {
      throw new AppError({
        code: "BAD_GATEWAY",
        statusCode: 502,
        message: "Zoom meeting request failed",
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new AppError({
        code: "BAD_GATEWAY",
        statusCode: 502,
        message: "Zoom meeting response was not valid JSON",
        cause: err,
      });
    }

    const meetingResponseSchema = z.object({
      id: z.union([
        z.number().int().positive().finite(),
        z.string().regex(/^\d+$/),
      ]),
      join_url: z.string().min(1),
    });

    const parsed = meetingResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError({
        code: "BAD_GATEWAY",
        statusCode: 502,
        message: "Zoom meeting response schema invalid",
        cause: parsed.error,
      });
    }

    const validatedJoinUrl = validateZoomJoinUrl(parsed.data.join_url);

    return {
      meetingId: String(parsed.data.id),
      joinUrl: validatedJoinUrl,
    };
  }

  validateWebhookSignature(rawBody: string, signature: string, timestamp: string): boolean {
    return verifyHmacSignature(rawBody, signature, timestamp, this.webhookSecret, this.clock);
  }
}

class FixtureZoomAdapter implements ZoomAdapter {
  private readonly clock: Clock;
  private readonly webhookSecret?: string;

  constructor(clock: Clock, webhookSecret?: string) {
    this.clock = clock;
    this.webhookSecret = webhookSecret;
  }

  isConfigured(): boolean {
    return true;
  }

  async createMeeting(
    _teacherAuth: { zoomClientId: string; zoomClientSecret: string; zoomRefreshToken: string },
    topic: string,
    startTime: ISOTimestamp,
    durationMinutes: number
  ): Promise<{ meetingId: string; joinUrl: string }> {
    const inputValidation = meetingInputSchema.safeParse({
      topic,
      startTime,
      durationMinutes,
    });
    if (!inputValidation.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid meeting creation input parameters",
        cause: inputValidation.error,
      });
    }

    return {
      meetingId: FIXTURE_MEETING_ID,
      joinUrl: FIXTURE_JOIN_URL,
    };
  }

  validateWebhookSignature(rawBody: string, signature: string, timestamp: string): boolean {
    return verifyHmacSignature(rawBody, signature, timestamp, this.webhookSecret, this.clock);
  }
}

export function createZoomAdapter(dependencies: {
  mode: "fixture" | "live";
  clock: Clock;
  fetch?: typeof globalThis.fetch;
  webhookSecret?: string;
  persistRefreshToken: (next: string) => Promise<void>;
}): ZoomAdapter {
  if (dependencies.mode === "live") {
    return new ZoomMeetingAdapter({
      clock: dependencies.clock,
      persistRefreshToken: dependencies.persistRefreshToken,
      fetch: dependencies.fetch,
      webhookSecret: dependencies.webhookSecret,
    });
  }

  return new FixtureZoomAdapter(dependencies.clock, dependencies.webhookSecret);
}

export interface ZoomMeetingServiceDependencies {
  oauth: ZoomOAuth;
  courses: Pick<CourseService, "getCourse">;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  clock: Clock;
  fetch?: typeof globalThis.fetch;
  webhookSecret?: string;
}

export class ZoomMeetingService {
  private readonly oauth: ZoomOAuth;
  private readonly courses: Pick<CourseService, "getCourse">;
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private readonly clock: Clock;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly webhookSecret?: string;

  constructor(dependencies: ZoomMeetingServiceDependencies) {
    this.oauth = dependencies.oauth;
    this.courses = dependencies.courses;
    this.env = dependencies.env;
    this.clock = dependencies.clock;
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.webhookSecret = dependencies.webhookSecret;
  }

  async createForCourse(
    actor: ActorContext,
    courseId: UUID,
    topic: string,
    startTime: ISOTimestamp,
    durationMinutes: number
  ): Promise<{ meetingId: string; joinUrl: string }> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    // Authorization & course resolution through core course service
    const course = await this.courses.getCourse(actor, courseId);

    const mode = this.env.INTEGRATION_MODE || "fixture";
    if (mode !== "fixture" && mode !== "live") {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: `Invalid INTEGRATION_MODE: '${mode}'. Must be 'fixture' or 'live'.`,
      });
    }

    if (mode === "fixture") {
      const adapter = createZoomAdapter({
        mode: "fixture",
        clock: this.clock,
        webhookSecret: this.webhookSecret,
        persistRefreshToken: async () => {},
      });
      return await adapter.createMeeting(
        {
          zoomClientId: "fixture",
          zoomClientSecret: "fixture",
          zoomRefreshToken: "fixture",
        },
        topic,
        startTime,
        durationMinutes
      );
    }

    // Live mode: serialize via teacher credentials lock and call Zoom
    return await this.oauth.withTeacherCredentials(course.teacherId, async (teacherAuth, persistRefreshToken) => {
      const adapter = createZoomAdapter({
        mode: "live",
        clock: this.clock,
        fetch: this.fetchImpl,
        webhookSecret: this.webhookSecret,
        persistRefreshToken,
      });
      return await adapter.createMeeting(teacherAuth, topic, startTime, durationMinutes);
    });
  }
}
