import type { ClassroomService } from "../../contracts/classroom.js";
import type { ActorContext, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import type { RoomAuthorizer } from "../realtime/room-authorizer.js";
import type { LectureRepository } from "./lecture-repository.js";
import { CS229_TRANSCRIPT_SCRIPT } from "./cs229-transcript.js";
import { runLectureSimulator } from "./simulator.js";
import { runZoomRtms } from "../zoom/index.js";

export interface SpeechStreamHandle {
  readonly done: Promise<void>;
  stop(): Promise<void>;
}

export interface ZoomRtmsStart {
  meetingUuid: string;
  rtmsStreamId: string;
  serverUrl: string;
}

export interface SpeechSourceConfig {
  integrationMode: "fixture" | "live";
  lectureSource: "simulator" | "zoom";
  tickRateMs: number;
  zoomClientId?: string;
  zoomClientSecret?: string;
}

export interface SpeechSourceDependencies {
  classroom: Pick<ClassroomService, "ingestTranscriptChunk">;
  lectures: Pick<LectureRepository, "getLecture">;
  rooms: Pick<RoomAuthorizer, "authorizeRoom">;
  createWebSocket?: (url: string) => WebSocket;
}

interface ActiveSession {
  abortController: AbortController;
  done: Promise<void>;
}

export function readSpeechSourceConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): SpeechSourceConfig {
  const integrationModeRaw = env.INTEGRATION_MODE ?? "fixture";
  if (integrationModeRaw !== "fixture" && integrationModeRaw !== "live") {
    throw new AppError({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: `Invalid INTEGRATION_MODE: ${integrationModeRaw}. Expected 'fixture' or 'live'`,
    });
  }

  const lectureSourceRaw = env.LECTURE_SOURCE ?? "simulator";
  if (lectureSourceRaw !== "simulator" && lectureSourceRaw !== "zoom") {
    throw new AppError({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: `Invalid LECTURE_SOURCE: ${lectureSourceRaw}. Expected 'simulator' or 'zoom'`,
    });
  }

  let tickRateMs = 4000;
  if (env.DEMO_TICK_RATE_MS !== undefined && env.DEMO_TICK_RATE_MS !== "") {
    const parsed = Number(env.DEMO_TICK_RATE_MS);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "DEMO_TICK_RATE_MS must be a positive finite integer",
      });
    }
    tickRateMs = parsed;
  }

  return {
    integrationMode: integrationModeRaw,
    lectureSource: lectureSourceRaw,
    tickRateMs,
    zoomClientId: env.ZOOM_CLIENT_ID,
    zoomClientSecret: env.ZOOM_CLIENT_SECRET,
  };
}

export class LectureSpeechService {
  private readonly sessions = new Map<UUID, ActiveSession>();

  constructor(
    private readonly dependencies: SpeechSourceDependencies,
    private readonly config: SpeechSourceConfig,
  ) {}

  async start(
    actor: ActorContext,
    lectureId: UUID,
    zoom?: ZoomRtmsStart,
  ): Promise<SpeechStreamHandle> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    if (this.sessions.has(lectureId)) {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Lecture speech stream already active",
      });
    }

    const abortController = new AbortController();
    // Reserve slot
    const placeholderSession: ActiveSession = {
      abortController,
      done: Promise.resolve(),
    };
    this.sessions.set(lectureId, placeholderSession);

    try {
      if (!actor || actor.role !== "teacher" || !actor.teacherId) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Only teachers can start speech streams",
        });
      }

      await this.dependencies.rooms.authorizeRoom(actor, `professor:${lectureId}`);

      const lecture = await this.dependencies.lectures.getLecture(lectureId);
      if (lecture.status !== "live") {
        throw new AppError({
          code: "BAD_REQUEST",
          statusCode: 400,
          message: "Cannot ingest transcript chunks into an inactive lecture",
        });
      }

      if (this.config.lectureSource === "simulator") {
        const donePromise = runLectureSimulator(
          this.dependencies.classroom,
          actor,
          lectureId,
          CS229_TRANSCRIPT_SCRIPT,
          this.config.tickRateMs,
          abortController.signal,
        );

        donePromise
          .catch((err) => {
            const domainCode = err instanceof AppError ? err.code : "UNKNOWN";
            // Sanitized logging without leaking sensitive payloads
            console.error(
              `[LectureSpeechService] Simulator finished with error for lecture ${lectureId}: ${domainCode}`,
            );
          })
          .finally(() => {
            if (this.sessions.get(lectureId)?.abortController === abortController) {
              this.sessions.delete(lectureId);
            }
          });

        this.sessions.set(lectureId, { abortController, done: donePromise });

        return {
          done: donePromise,
          stop: () => this.stop(lectureId),
        };
      }

      if (this.config.lectureSource === "zoom") {
        if (this.config.integrationMode === "fixture") {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom RTMS requires live integration mode",
          });
        }

        if (!this.config.zoomClientId || !this.config.zoomClientSecret) {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom RTMS credentials are not configured",
          });
        }

        if (!zoom) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Zoom RTMS connection parameters required",
          });
        }

        const { promise: readyPromise, resolve: readyResolve, reject: readyReject } =
          Promise.withResolvers<void>();

        const onAbortBeforeReady = () => {
          readyReject(
            new AppError({
              code: "BAD_REQUEST",
              statusCode: 400,
              message: "Lecture speech stream stopped",
            }),
          );
        };
        abortController.signal.addEventListener("abort", onAbortBeforeReady, { once: true });

        const donePromise = runZoomRtms(
          {
            classroom: this.dependencies.classroom,
            actor,
            lecture,
            meetingUuid: zoom.meetingUuid,
            rtmsStreamId: zoom.rtmsStreamId,
            serverUrl: zoom.serverUrl,
            clientId: this.config.zoomClientId,
            clientSecret: this.config.zoomClientSecret,
            createWebSocket: this.dependencies.createWebSocket,
          },
          abortController.signal,
          () => {
            abortController.signal.removeEventListener("abort", onAbortBeforeReady);
            readyResolve();
          },
        );

        donePromise
          .catch((err: unknown) => {
            readyReject(err);
            const domainCode = err instanceof AppError ? err.code : "UNKNOWN";
            console.error(
              `[LectureSpeechService] Zoom RTMS finished with error for lecture ${lectureId}: ${domainCode}`,
            );
          })
          .finally(() => {
            if (this.sessions.get(lectureId)?.abortController === abortController) {
              this.sessions.delete(lectureId);
            }
          });

        this.sessions.set(lectureId, { abortController, done: donePromise });

        await readyPromise;

        return {
          done: donePromise,
          stop: () => this.stop(lectureId),
        };
      }

      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: `Unsupported lecture source: ${String(this.config.lectureSource)}`,
      });
    } catch (err: unknown) {
      this.sessions.delete(lectureId);
      throw err;
    }
  }

  async stop(lectureId: UUID): Promise<void> {
    const session = this.sessions.get(lectureId);
    if (!session) {
      return;
    }
    session.abortController.abort();
    try {
      await session.done;
    } catch {
      // stop waits for done to settle
    } finally {
      this.sessions.delete(lectureId);
    }
  }

  async dispose(): Promise<void> {
    const lectureIds = Array.from(this.sessions.keys());
    await Promise.all(lectureIds.map((id) => this.stop(id)));
  }
}
