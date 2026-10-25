import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActorContext, Clock, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type { ZoomAdapter } from "../../contracts/classroom.js";
import { AppError } from "../../contracts/errors.js";
import { mapPostgrestError } from "../platform/index.js";

export type TeacherZoomAuth = Parameters<ZoomAdapter["createMeeting"]>[0];

const ENCRYPTION_KEY_REGEX = /^[0-9a-fA-F]{64}$/;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingOAuthState {
  teacherId: string;
  authId: string;
  nonceHash: string;
  expiresAt: number;
  clientId: string;
  clientSecret: string;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive().finite(),
  token_type: z.string().refine((val) => val.toLowerCase() === "bearer", {
    message: "Expected bearer token type",
  }),
});

const clientCredentialsSchema = z.object({
  zoomClientId: z.string().trim().min(1),
  zoomClientSecret: z.string().trim().min(1),
});

function getKeyBuffer(keyHex?: string): Buffer | null {
  if (!keyHex || !ENCRYPTION_KEY_REGEX.test(keyHex)) {
    return null;
  }
  return Buffer.from(keyHex, "hex");
}

function encryptCredential(
  keyBuffer: Buffer,
  teacherId: string,
  columnName: string,
  plaintext: string
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);
  cipher.setAAD(Buffer.from(`${teacherId}:${columnName}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decryptCredential(
  keyBuffer: Buffer,
  teacherId: string,
  columnName: string,
  envelope: string
): string {
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Corrupt stored Zoom credentials",
    });
  }

  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const ciphertext = Buffer.from(parts[3]!, "base64url");

  if (iv.length !== 12 || tag.length !== 16) {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Corrupt stored Zoom credentials",
    });
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", keyBuffer, iv);
    decipher.setAAD(Buffer.from(`${teacherId}:${columnName}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Corrupt stored Zoom credentials",
      cause: err,
    });
  }
}

function validateRedirectUri(redirectUri: string | undefined, appOrigin: string | undefined): string {
  if (!redirectUri || typeof redirectUri !== "string") {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Invalid or unconfigured ZOOM_REDIRECT_URI",
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Invalid or unconfigured ZOOM_REDIRECT_URI",
    });
  }

  if (parsed.pathname !== "/api/zoom/oauth/callback") {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "ZOOM_REDIRECT_URI must have pathname /api/zoom/oauth/callback",
    });
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (!isLocal && parsed.protocol !== "https:") {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "ZOOM_REDIRECT_URI must use HTTPS outside localhost",
    });
  }

  if (appOrigin) {
    try {
      const appOriginUrl = new URL(appOrigin);
      if (parsed.origin !== appOriginUrl.origin) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "ZOOM_REDIRECT_URI origin must match APP_ORIGIN",
        });
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Invalid APP_ORIGIN configuration",
      });
    }
  }

  return redirectUri;
}

export async function requestZoomTokens(input: {
  grant: "authorization_code" | "refresh_token";
  auth: Pick<TeacherZoomAuth, "zoomClientId" | "zoomClientSecret">;
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const basicAuth = Buffer.from(
    `${input.auth.zoomClientId}:${input.auth.zoomClientSecret}`,
    "utf8"
  ).toString("base64");

  const body = new URLSearchParams();
  if (input.grant === "authorization_code") {
    if (!input.code || !input.redirectUri) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Authorization code and redirect URI required for code grant",
      });
    }
    body.set("grant_type", "authorization_code");
    body.set("code", input.code);
    body.set("redirect_uri", input.redirectUri);
  } else {
    if (!input.refreshToken) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Refresh token required for refresh grant",
      });
    }
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", input.refreshToken);
  }

  let response: Response;
  try {
    response = await fetchImpl("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
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
        message: "Zoom token request timed out",
      });
    }
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom token request failed",
      cause: err,
    });
  }

  if (response.status === 400 || response.status === 401) {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Zoom credentials are not configured",
    });
  }

  if (!response.ok) {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom token request failed",
    });
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err) {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom token request failed",
      cause: err,
    });
  }

  const parsed = tokenResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new AppError({
      code: "BAD_GATEWAY",
      statusCode: 502,
      message: "Zoom token request failed",
      cause: parsed.error,
    });
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
  };
}

export interface ZoomOAuthDependencies {
  client: Pick<SupabaseClient, "from">;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  clock: Clock;
  fetch?: typeof globalThis.fetch;
}

export class ZoomOAuth {
  private readonly client: Pick<SupabaseClient, "from">;
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private readonly clock: Clock;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly teacherLocks = new Map<string, Promise<unknown>>();
  private readonly pendingStates = new Map<string, PendingOAuthState>();

  constructor(dependencies: ZoomOAuthDependencies) {
    this.client = dependencies.client;
    this.env = dependencies.env;
    this.clock = dependencies.clock;
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
  }

  private async withTeacherLock<T>(teacherId: string, fn: () => Promise<T>): Promise<T> {
    const current = this.teacherLocks.get(teacherId) ?? Promise.resolve();
    const { promise: next, resolve: release } = Promise.withResolvers<void>();
    this.teacherLocks.set(teacherId, next);
    try {
      await current;
      return await fn();
    } finally {
      release();
      if (this.teacherLocks.get(teacherId) === next) {
        this.teacherLocks.delete(teacherId);
      }
    }
  }

  private pruneExpiredStates(): void {
    const nowMs = this.clock.now().getTime();
    for (const [state, record] of this.pendingStates.entries()) {
      if (record.expiresAt <= nowMs) {
        this.pendingStates.delete(state);
      }
    }
  }

  private deletePendingStatesForTeacher(teacherId: string): void {
    for (const [state, record] of this.pendingStates.entries()) {
      if (record.teacherId === teacherId) {
        this.pendingStates.delete(state);
      }
    }
  }

  async getCredentialStatus(
    actor: ActorContext,
    teacherId: UUID
  ): Promise<{ configured: boolean; clientIdPrefix?: string }> {
    if (!uuidSchema.safeParse(teacherId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid teacher ID format",
      });
    }

    if (actor.role !== "teacher" || actor.teacherId !== teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden",
      });
    }

    let result;
    try {
      result = await this.client
        .from("teachers")
        .select("zoom_client_id, zoom_client_secret, zoom_refresh_token")
        .eq("id", teacherId)
        .eq("auth_id", actor.authId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query teacher credentials",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(result.error, "Database error querying teacher credentials");
    }

    if (!result.data) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Teacher not found or unauthorized",
      });
    }

    const { zoom_client_id, zoom_client_secret, zoom_refresh_token } = result.data;

    // If any credential is absent, not configured
    if (!zoom_client_id || !zoom_client_secret || !zoom_refresh_token) {
      return { configured: false };
    }

    // All credentials are present: must decrypt to verify and extract prefix
    const keyBuffer = getKeyBuffer(this.env.CREDENTIAL_ENCRYPTION_KEY);
    if (!keyBuffer) {
      return { configured: false };
    }

    const decryptedClientId = decryptCredential(
      keyBuffer,
      teacherId,
      "zoom_client_id",
      zoom_client_id
    );
    // Verify remaining two decrypt cleanly as well
    decryptCredential(keyBuffer, teacherId, "zoom_client_secret", zoom_client_secret);
    decryptCredential(keyBuffer, teacherId, "zoom_refresh_token", zoom_refresh_token);

    return {
      configured: true,
      clientIdPrefix: decryptedClientId.slice(0, 4),
    };
  }

  async setClientCredentials(
    actor: ActorContext,
    teacherId: UUID,
    input: { zoomClientId: string; zoomClientSecret: string }
  ): Promise<void> {
    if (!uuidSchema.safeParse(teacherId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid teacher ID format",
      });
    }

    const parsedInput = clientCredentialsSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid client credentials payload",
        cause: parsedInput.error,
      });
    }

    if (actor.role !== "teacher" || actor.teacherId !== teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden",
      });
    }

    await this.withTeacherLock(teacherId, async () => {
      const keyBuffer = getKeyBuffer(this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (!keyBuffer) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom credentials are not configured",
        });
      }

      // Check teacher exists
      let check;
      try {
        check = await this.client
          .from("teachers")
          .select("id")
          .eq("id", teacherId)
          .eq("auth_id", actor.authId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Failed to verify teacher identity",
          cause: err,
        });
      }

      if (check.error) {
        throw mapPostgrestError(check.error, "Database error verifying teacher");
      }

      if (!check.data) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Teacher not found or unauthorized",
        });
      }

      const encClientId = encryptCredential(
        keyBuffer,
        teacherId,
        "zoom_client_id",
        parsedInput.data.zoomClientId
      );
      const encClientSecret = encryptCredential(
        keyBuffer,
        teacherId,
        "zoom_client_secret",
        parsedInput.data.zoomClientSecret
      );

      // Invalidate outstanding OAuth states for this teacher
      this.deletePendingStatesForTeacher(teacherId);

      let updateRes;
      try {
        updateRes = await this.client
          .from("teachers")
          .update({
            zoom_client_id: encClientId,
            zoom_client_secret: encClientSecret,
            zoom_refresh_token: null,
          })
          .eq("id", teacherId)
          .eq("auth_id", actor.authId);
      } catch (err) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Failed to persist teacher credentials",
          cause: err,
        });
      }

      if (updateRes.error) {
        throw mapPostgrestError(updateRes.error, "Database error persisting credentials");
      }
    });
  }

  async beginAuthorization(
    actor: ActorContext,
    teacherId: UUID,
    browserNonce: string
  ): Promise<{ authorizationUrl: string }> {
    if (this.env.INTEGRATION_MODE !== "live") {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom OAuth requires live integration mode",
      });
    }

    if (!uuidSchema.safeParse(teacherId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid teacher ID format",
      });
    }

    if (!browserNonce || typeof browserNonce !== "string" || browserNonce.trim().length === 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Browser nonce required",
      });
    }

    if (actor.role !== "teacher" || actor.teacherId !== teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden",
      });
    }

    return await this.withTeacherLock(teacherId, async () => {
      const keyBuffer = getKeyBuffer(this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (!keyBuffer) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom credentials are not configured",
        });
      }

      let teacherRow;
      try {
        teacherRow = await this.client
          .from("teachers")
          .select("zoom_client_id, zoom_client_secret, zoom_refresh_token")
          .eq("id", teacherId)
          .eq("auth_id", actor.authId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Failed to query teacher credentials",
          cause: err,
        });
      }

      if (teacherRow.error) {
        throw mapPostgrestError(teacherRow.error, "Database error querying teacher");
      }

      if (!teacherRow.data) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Teacher not found or unauthorized",
        });
      }

      const storedEncId = teacherRow.data.zoom_client_id;
      const storedEncSecret = teacherRow.data.zoom_client_secret;

      let clientId: string;
      let clientSecret: string;

      if (storedEncId && storedEncSecret) {
        clientId = decryptCredential(keyBuffer, teacherId, "zoom_client_id", storedEncId);
        clientSecret = decryptCredential(keyBuffer, teacherId, "zoom_client_secret", storedEncSecret);
      } else if (!storedEncId && !storedEncSecret) {
        const envClientId = this.env.ZOOM_CLIENT_ID?.trim();
        const envClientSecret = this.env.ZOOM_CLIENT_SECRET?.trim();
        if (!envClientId || !envClientSecret) {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom credentials are not configured",
          });
        }

        const encId = encryptCredential(keyBuffer, teacherId, "zoom_client_id", envClientId);
        const encSecret = encryptCredential(keyBuffer, teacherId, "zoom_client_secret", envClientSecret);

        let persistEnv;
        try {
          persistEnv = await this.client
            .from("teachers")
            .update({
              zoom_client_id: encId,
              zoom_client_secret: encSecret,
            })
            .eq("id", teacherId)
            .eq("auth_id", actor.authId);
        } catch (err) {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Failed to persist Zoom credentials",
            cause: err,
          });
        }

        if (persistEnv.error) {
          throw mapPostgrestError(persistEnv.error, "Database error persisting credentials");
        }

        clientId = envClientId;
        clientSecret = envClientSecret;
      } else {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom credentials are not configured",
        });
      }

      const redirectUri = validateRedirectUri(this.env.ZOOM_REDIRECT_URI, this.env.APP_ORIGIN);

      this.pruneExpiredStates();

      const state = randomBytes(32).toString("base64url");
      const nonceHash = createHash("sha256").update(browserNonce).digest("hex");

      this.pendingStates.set(state, {
        teacherId,
        authId: actor.authId,
        nonceHash,
        expiresAt: this.clock.now().getTime() + OAUTH_STATE_TTL_MS,
        clientId,
        clientSecret,
      });

      const authorizationUrl =
        `https://zoom.us/oauth/authorize?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${encodeURIComponent(state)}`;

      return { authorizationUrl };
    });
  }

  async completeAuthorization(input: {
    state: string;
    browserNonce: string;
    code?: string;
    error?: string;
  }): Promise<void> {
    if (this.env.INTEGRATION_MODE !== "live") {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom OAuth requires live integration mode",
      });
    }

    if (!input.state || typeof input.state !== "string" || !input.browserNonce || typeof input.browserNonce !== "string") {
      throw new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Missing OAuth state or browser nonce",
      });
    }

    this.pruneExpiredStates();

    const pending = this.pendingStates.get(input.state);
    if (!pending) {
      throw new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Invalid or expired OAuth state",
      });
    }

    // Consume state immediately
    this.pendingStates.delete(input.state);

    if (pending.expiresAt < this.clock.now().getTime()) {
      throw new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Expired OAuth state",
      });
    }

    const incomingNonceHash = createHash("sha256").update(input.browserNonce).digest("hex");
    if (
      incomingNonceHash.length !== pending.nonceHash.length ||
      !timingSafeEqual(Buffer.from(incomingNonceHash), Buffer.from(pending.nonceHash))
    ) {
      throw new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Invalid OAuth nonce",
      });
    }

    if (input.error) {
      throw new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Zoom OAuth authorization was denied or failed",
      });
    }

    if (!input.code || typeof input.code !== "string" || input.code.trim().length === 0) {
      throw new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Missing authorization code",
      });
    }

    await this.withTeacherLock(pending.teacherId, async () => {
      const keyBuffer = getKeyBuffer(this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (!keyBuffer) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom credentials are not configured",
        });
      }

      let teacherRow;
      try {
        teacherRow = await this.client
          .from("teachers")
          .select("zoom_client_id, zoom_client_secret")
          .eq("id", pending.teacherId)
          .eq("auth_id", pending.authId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Failed to verify teacher credentials",
          cause: err,
        });
      }

      if (teacherRow.error) {
        throw mapPostgrestError(teacherRow.error, "Database error verifying teacher");
      }

      if (!teacherRow.data || !teacherRow.data.zoom_client_id || !teacherRow.data.zoom_client_secret) {
        throw new AppError({
          code: "BAD_REQUEST",
          statusCode: 400,
          message: "App credentials changed during authorization",
        });
      }

      const currentClientId = decryptCredential(
        keyBuffer,
        pending.teacherId,
        "zoom_client_id",
        teacherRow.data.zoom_client_id
      );
      const currentClientSecret = decryptCredential(
        keyBuffer,
        pending.teacherId,
        "zoom_client_secret",
        teacherRow.data.zoom_client_secret
      );

      if (currentClientId !== pending.clientId || currentClientSecret !== pending.clientSecret) {
        throw new AppError({
          code: "BAD_REQUEST",
          statusCode: 400,
          message: "App credentials changed during authorization",
        });
      }

      const redirectUri = validateRedirectUri(this.env.ZOOM_REDIRECT_URI, this.env.APP_ORIGIN);

      const tokens = await requestZoomTokens({
        grant: "authorization_code",
        auth: {
          zoomClientId: pending.clientId,
          zoomClientSecret: pending.clientSecret,
        },
        code: input.code,
        redirectUri,
        fetch: this.fetchImpl,
      });

      const encRefreshToken = encryptCredential(
        keyBuffer,
        pending.teacherId,
        "zoom_refresh_token",
        tokens.refreshToken
      );

      let updateRes;
      try {
        updateRes = await this.client
          .from("teachers")
          .update({ zoom_refresh_token: encRefreshToken })
          .eq("id", pending.teacherId)
          .eq("auth_id", pending.authId);
      } catch (err) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Failed to persist Zoom refresh token",
          cause: err,
        });
      }

      if (updateRes.error) {
        throw mapPostgrestError(updateRes.error, "Database error updating refresh token");
      }
    });
  }

  async withTeacherCredentials<T>(
    teacherId: UUID,
    action: (
      auth: TeacherZoomAuth,
      persistRefreshToken: (next: string) => Promise<void>
    ) => Promise<T>
  ): Promise<T> {
    if (!uuidSchema.safeParse(teacherId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid teacher ID format",
      });
    }

    return await this.withTeacherLock(teacherId, async () => {
      const keyBuffer = getKeyBuffer(this.env.CREDENTIAL_ENCRYPTION_KEY);
      if (!keyBuffer) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom credentials are not configured",
        });
      }

      let teacherRow;
      try {
        teacherRow = await this.client
          .from("teachers")
          .select("zoom_client_id, zoom_client_secret, zoom_refresh_token")
          .eq("id", teacherId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Failed to query teacher credentials",
          cause: err,
        });
      }

      if (teacherRow.error) {
        throw mapPostgrestError(teacherRow.error, "Database error querying teacher credentials");
      }

      if (
        !teacherRow.data ||
        !teacherRow.data.zoom_client_id ||
        !teacherRow.data.zoom_client_secret ||
        !teacherRow.data.zoom_refresh_token
      ) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom credentials are not configured",
        });
      }

      const zoomClientId = decryptCredential(
        keyBuffer,
        teacherId,
        "zoom_client_id",
        teacherRow.data.zoom_client_id
      );
      const zoomClientSecret = decryptCredential(
        keyBuffer,
        teacherId,
        "zoom_client_secret",
        teacherRow.data.zoom_client_secret
      );
      const zoomRefreshToken = decryptCredential(
        keyBuffer,
        teacherId,
        "zoom_refresh_token",
        teacherRow.data.zoom_refresh_token
      );

      let currentEncryptedRefreshToken = teacherRow.data.zoom_refresh_token;

      const persistRefreshToken = async (nextRefreshToken: string): Promise<void> => {
        const nextEncrypted = encryptCredential(
          keyBuffer,
          teacherId,
          "zoom_refresh_token",
          nextRefreshToken
        );

        let updateRes;
        try {
          updateRes = await this.client
            .from("teachers")
            .update({ zoom_refresh_token: nextEncrypted })
            .eq("id", teacherId)
            .eq("zoom_refresh_token", currentEncryptedRefreshToken)
            .select("id")
            .maybeSingle();
        } catch (err) {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Failed to update Zoom refresh token",
            cause: err,
          });
        }

        if (updateRes.error) {
          throw mapPostgrestError(updateRes.error, "Database error updating Zoom refresh token");
        }

        if (!updateRes.data) {
          throw new AppError({
            code: "CONFLICT",
            statusCode: 409,
            message: "Concurrent Zoom credential update detected",
          });
        }

        currentEncryptedRefreshToken = nextEncrypted;
      };

      return await action(
        {
          zoomClientId,
          zoomClientSecret,
          zoomRefreshToken,
        },
        persistRefreshToken
      );
    });
  }
}
