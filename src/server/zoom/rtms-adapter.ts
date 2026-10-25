import { createHmac } from "node:crypto";
import { z } from "zod";
import type { ClassroomService, LectureSession } from "../../contracts/classroom.js";
import type { ActorContext } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";

export interface ZoomRtmsInput {
  classroom: Pick<ClassroomService, "ingestTranscriptChunk">;
  actor: ActorContext;
  lecture: LectureSession;
  meetingUuid: string;
  rtmsStreamId: string;
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  createWebSocket?: (url: string) => WebSocket;
}

function validateZoomUrl(urlString: string, isProviderUrl: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch (err) {
    throw new AppError({
      code: isProviderUrl ? "BAD_GATEWAY" : "VALIDATION_ERROR",
      statusCode: isProviderUrl ? 502 : 400,
      message: isProviderUrl ? "Invalid Zoom RTMS media URL" : "Invalid Zoom RTMS server URL",
      cause: err,
    });
  }

  if (parsed.protocol !== "wss:") {
    throw new AppError({
      code: isProviderUrl ? "BAD_GATEWAY" : "VALIDATION_ERROR",
      statusCode: isProviderUrl ? 502 : 400,
      message: "Zoom RTMS URL must use wss: protocol",
    });
  }

  const hostname = parsed.hostname.toLowerCase();
  const isValidHost =
    hostname === "zoom.us" ||
    hostname.endsWith(".zoom.us") ||
    hostname === "zoom.com" ||
    hostname.endsWith(".zoom.com");

  if (!isValidHost) {
    throw new AppError({
      code: isProviderUrl ? "BAD_GATEWAY" : "VALIDATION_ERROR",
      statusCode: isProviderUrl ? 502 : 400,
      message: "Zoom RTMS URL must point to zoom.us or zoom.com domain",
    });
  }

  if (parsed.username || parsed.password) {
    throw new AppError({
      code: isProviderUrl ? "BAD_GATEWAY" : "VALIDATION_ERROR",
      statusCode: isProviderUrl ? 502 : 400,
      message: "Zoom RTMS URL must not contain user credentials",
    });
  }

  if (parsed.hash) {
    throw new AppError({
      code: isProviderUrl ? "BAD_GATEWAY" : "VALIDATION_ERROR",
      statusCode: isProviderUrl ? 502 : 400,
      message: "Zoom RTMS URL must not contain a fragment",
    });
  }

  if (parsed.port !== "" && parsed.port !== "443") {
    throw new AppError({
      code: isProviderUrl ? "BAD_GATEWAY" : "VALIDATION_ERROR",
      statusCode: isProviderUrl ? 502 : 400,
      message: "Zoom RTMS URL must not use custom non-443 port",
    });
  }

  return parsed;
}

const baseMsgSchema = z.object({
  msg_type: z.number(),
});

const keepAliveMsgSchema = z.object({
  msg_type: z.literal(12),
  timestamp: z.unknown(),
});

const signalingReplySchema = z.object({
  msg_type: z.literal(2),
  status: z.number().optional(),
  status_code: z.number().optional(),
  media_server: z
    .object({
      server_urls: z
        .object({
          transcript: z.string(),
        })
        .optional(),
    })
    .optional(),
});

const mediaReplySchema = z.object({
  msg_type: z.literal(4),
  status: z.number().optional(),
  status_code: z.number().optional(),
});

const transcriptContentSchema = z.object({
  data: z.string(),
  timestamp: z.number().refine((val) => Number.isFinite(val) && val >= 0),
  user_name: z.string().optional(),
});

const transcriptMsgSchema = z.object({
  msg_type: z.literal(17),
  content: transcriptContentSchema,
});
const STARTUP_TIMEOUT_MS = 10_000;

export async function runZoomRtms(
  input: ZoomRtmsInput,
  signal: AbortSignal,
  onReady: () => void,
): Promise<void> {
  if (!input.clientId || !input.clientSecret) {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Zoom RTMS credentials are not configured",
    });
  }

  if (
    !input.meetingUuid ||
    typeof input.meetingUuid !== "string" ||
    input.meetingUuid.trim().length === 0 ||
    !input.rtmsStreamId ||
    typeof input.rtmsStreamId !== "string" ||
    input.rtmsStreamId.trim().length === 0 ||
    !input.serverUrl ||
    typeof input.serverUrl !== "string" ||
    input.serverUrl.trim().length === 0
  ) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: "Invalid Zoom RTMS parameters: meetingUuid, rtmsStreamId, and serverUrl required",
    });
  }

  validateZoomUrl(input.serverUrl, false);

  const signature = createHmac("sha256", input.clientSecret)
    .update(`${input.clientId},${input.meetingUuid},${input.rtmsStreamId}`)
    .digest("hex");

  const wsFactory = input.createWebSocket ?? ((url: string) => new WebSocket(url));

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let isReady = false;
  let settled = false;
  let signalingSocket: WebSocket | null = null;
  let mediaSocket: WebSocket | null = null;
  let startupTimer: NodeJS.Timeout | null = null;
  let ingestionChain: Promise<void> = Promise.resolve();

  const cleanup = () => {
    if (startupTimer !== null) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    if (signalingSocket) {
      try {
        signalingSocket.close();
      } catch {
        // ignore socket close errors
      }
      signalingSocket = null;
    }
    if (mediaSocket) {
      try {
        mediaSocket.close();
      } catch {
        // ignore socket close errors
      }
      mediaSocket = null;
    }
  };

  const finish = (err?: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (err) {
      reject(err);
    } else {
      resolve();
    }
  };

  const onAbort = async () => {
    cleanup();
    try {
      await ingestionChain;
    } catch {
      // ignore ingestion errors on abort
    }

    if (!isReady) {
      finish(
        new AppError({
          code: "BAD_REQUEST",
          statusCode: 400,
          message: "Lecture speech stream stopped",
        }),
      );
    } else {
      finish();
    }
  };

  signal.addEventListener("abort", onAbort, { once: true });

  startupTimer = setTimeout(() => {
    if (!isReady && !settled) {
      finish(
        new AppError({
          code: "GATEWAY_TIMEOUT",
          statusCode: 504,
          message: "Zoom RTMS connection timed out",
        }),
      );
    }
  }, STARTUP_TIMEOUT_MS);
  startupTimer.unref?.();

  const handleFatalError = (err: unknown) => {
    if (settled) return;
    finish(err);
  };

  try {
    signalingSocket = wsFactory(input.serverUrl);
  } catch (err: unknown) {
    finish(
      new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom RTMS connection failed",
        cause: err,
      }),
    );
    return promise;
  }

  signalingSocket.addEventListener("error", (event) => {
    handleFatalError(
      new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom RTMS connection failed",
        cause: event,
      }),
    );
  });

  signalingSocket.addEventListener("close", () => {
    if (!settled && !signal.aborted) {
      handleFatalError(
        new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom RTMS connection failed",
        }),
      );
    }
  });

  signalingSocket.addEventListener("open", () => {
    if (signal.aborted || settled || !signalingSocket) return;
    const clientHandshake = {
      msg_type: 1,
      protocol_version: 1,
      sequence: 0,
      meeting_uuid: input.meetingUuid,
      rtms_stream_id: input.rtmsStreamId,
      signature,
    };
    signalingSocket.send(JSON.stringify(clientHandshake));
  });

  signalingSocket.addEventListener("message", (event) => {
    if (signal.aborted || settled) return;
    let raw: unknown;
    try {
      raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      handleFatalError(
        new AppError({
          code: "BAD_GATEWAY",
          statusCode: 502,
          message: "Invalid Zoom RTMS message",
        }),
      );
      return;
    }

    const baseParsed = baseMsgSchema.safeParse(raw);
    if (!baseParsed.success) {
      handleFatalError(
        new AppError({
          code: "BAD_GATEWAY",
          statusCode: 502,
          message: "Invalid Zoom RTMS message",
        }),
      );
      return;
    }

    const msgType = baseParsed.data.msg_type;

    // Keep-alive handling (msg_type 12 -> 13)
    if (msgType === 12) {
      const kaParsed = keepAliveMsgSchema.safeParse(raw);
      if (kaParsed.success) {
        signalingSocket?.send(JSON.stringify({ msg_type: 13, timestamp: kaParsed.data.timestamp }));
      }
      return;
    }

    // Signaling Handshake response (msg_type 2)
    if (msgType === 2) {
      const sigParsed = signalingReplySchema.safeParse(raw);
      if (!sigParsed.success) {
        handleFatalError(
          new AppError({
            code: "BAD_GATEWAY",
            statusCode: 502,
            message: "Invalid Zoom RTMS message",
            cause: sigParsed.error,
          }),
        );
        return;
      }

      const status = sigParsed.data.status ?? sigParsed.data.status_code ?? 0;
      if (status !== 0) {
        handleFatalError(
          new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom RTMS handshake failed",
          }),
        );
        return;
      }

      const transcriptUrl = sigParsed.data.media_server?.server_urls?.transcript;
      if (!transcriptUrl || typeof transcriptUrl !== "string") {
        handleFatalError(
          new AppError({
            code: "BAD_GATEWAY",
            statusCode: 502,
            message: "Invalid Zoom RTMS message",
          }),
        );
        return;
      }

      try {
        validateZoomUrl(transcriptUrl, true);
      } catch (err) {
        handleFatalError(err);
        return;
      }

      // Open media socket
      try {
        mediaSocket = wsFactory(transcriptUrl);
      } catch (err) {
        handleFatalError(
          new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom RTMS connection failed",
            cause: err,
          }),
        );
        return;
      }

      mediaSocket.addEventListener("error", (mEvent) => {
        handleFatalError(
          new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom RTMS connection failed",
            cause: mEvent,
          }),
        );
      });

      mediaSocket.addEventListener("close", () => {
        if (!settled && !signal.aborted) {
          handleFatalError(
            new AppError({
              code: "SERVICE_UNAVAILABLE",
              statusCode: 503,
              message: "Zoom RTMS connection failed",
            }),
          );
        }
      });

      mediaSocket.addEventListener("open", () => {
        if (signal.aborted || settled || !mediaSocket) return;
        const mediaHandshake = {
          msg_type: 3,
          protocol_version: 1,
          sequence: 0,
          meeting_uuid: input.meetingUuid,
          rtms_stream_id: input.rtmsStreamId,
          signature,
          media_type: 8,
        };
        mediaSocket.send(JSON.stringify(mediaHandshake));
      });

      mediaSocket.addEventListener("message", (mEvent) => {
        if (signal.aborted || settled) return;
        let mRaw: unknown;
        try {
          mRaw = JSON.parse(typeof mEvent.data === "string" ? mEvent.data : String(mEvent.data));
        } catch {
          handleFatalError(
            new AppError({
              code: "BAD_GATEWAY",
              statusCode: 502,
              message: "Invalid Zoom RTMS message",
            }),
          );
          return;
        }

        const mBaseParsed = baseMsgSchema.safeParse(mRaw);
        if (!mBaseParsed.success) {
          handleFatalError(
            new AppError({
              code: "BAD_GATEWAY",
              statusCode: 502,
              message: "Invalid Zoom RTMS message",
            }),
          );
          return;
        }

        const mType = mBaseParsed.data.msg_type;

        // Keep-alive on media socket (msg_type 12 -> 13)
        if (mType === 12) {
          const mKaParsed = keepAliveMsgSchema.safeParse(mRaw);
          if (mKaParsed.success) {
            mediaSocket?.send(JSON.stringify({ msg_type: 13, timestamp: mKaParsed.data.timestamp }));
          }
          return;
        }

        // Media Handshake response (msg_type 4)
        if (mType === 4) {
          const mReplyParsed = mediaReplySchema.safeParse(mRaw);
          if (!mReplyParsed.success) {
            handleFatalError(
              new AppError({
                code: "BAD_GATEWAY",
                statusCode: 502,
                message: "Invalid Zoom RTMS message",
                cause: mReplyParsed.error,
              }),
            );
            return;
          }

          const mStatus = mReplyParsed.data.status ?? mReplyParsed.data.status_code ?? 0;
          if (mStatus !== 0) {
            handleFatalError(
              new AppError({
                code: "SERVICE_UNAVAILABLE",
                statusCode: 503,
                message: "Zoom RTMS handshake failed",
              }),
            );
            return;
          }

          // Send ready msg_type 7 on signaling socket
          signalingSocket?.send(
            JSON.stringify({
              msg_type: 7,
              rtms_stream_id: input.rtmsStreamId,
            }),
          );

          isReady = true;
          if (startupTimer) {
            clearTimeout(startupTimer);
            startupTimer = null;
          }
          onReady();
          return;
        }

        // Media data (msg_type 17)
        if (mType === 17) {
          if (!isReady) return;

          const tParsed = transcriptMsgSchema.safeParse(mRaw);
          if (!tParsed.success) {
            handleFatalError(
              new AppError({
                code: "BAD_GATEWAY",
                statusCode: 502,
                message: "Invalid Zoom RTMS message",
                cause: tParsed.error,
              }),
            );
            return;
          }

          const { data, timestamp, user_name } = tParsed.data.content;
          const trimmedText = data.trim();
          if (trimmedText.length === 0) {
            return;
          }

          const lectureStartedAtEpoch = Date.parse(input.lecture.startedAt);
          const timestampSec = (timestamp - lectureStartedAtEpoch) / 1000;

          if (!Number.isFinite(timestampSec) || timestampSec < 0) {
            handleFatalError(
              new AppError({
                code: "BAD_GATEWAY",
                statusCode: 502,
                message: "Invalid Zoom RTMS message",
              }),
            );
            return;
          }

          // Serialize ingestion in arrival order
          ingestionChain = ingestionChain
            .then(async () => {
              if (signal.aborted || settled) return;
              await input.classroom.ingestTranscriptChunk(
                input.actor,
                input.lecture.id,
                trimmedText,
                timestampSec,
                user_name,
                { isSimulated: false },
              );
            })
            .catch((err: unknown) => {
              handleFatalError(err);
            });
        }
      });
    }
  });

  return promise;
}
