import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { ActorContext, UUID } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import {
  type ClientToServerEvents,
  type RealtimePublisher,
  lectureJoinPayloadSchema,
  lectureLeavePayloadSchema,
  studyGroupJoinPayloadSchema,
  studyGroupLeavePayloadSchema,
} from "../../contracts/realtime.js";
import type { AuthGateway } from "../platform/index.js";
import type { LectureRepository } from "../classroom/index.js";
import { PresenceTracker } from "./presence-tracker.js";
import type { RoomAuthorizer } from "./room-authorizer.js";

export interface SocketServerDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  rooms: RoomAuthorizer;
  lectures: Pick<LectureRepository, "getLecture">;
  origin?: string;
}

export type RealtimeSocketServer = SocketIOServer<
  ClientToServerEvents,
  Record<string, (payload: unknown) => void>,
  Record<string, never>,
  { actor: ActorContext }
>;

export function createSocketServer(
  httpServer: HttpServer,
  dependencies: SocketServerDependencies
): {
  io: RealtimeSocketServer;
  publisher: RealtimePublisher;
  presence: PresenceTracker;
} {
  const allowedOrigin =
    dependencies.origin ?? process.env.APP_ORIGIN ?? "http://localhost:3000";

  const io: RealtimeSocketServer = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigin,
      methods: ["GET", "POST"],
    },
  });

  const publisher: RealtimePublisher = {
    async emitToLecture(lectureId: UUID, event: string, payload: unknown): Promise<void> {
      io.to(`lecture:${lectureId}`).emit(event, payload);
    },
    async emitToTeacher(lectureId: UUID, event: string, payload: unknown): Promise<void> {
      io.to(`professor:${lectureId}`).emit(event, payload);
    },
    async emitToStudent(studentId: UUID, event: string, payload: unknown): Promise<void> {
      io.to(`student:${studentId}`).emit(event, payload);
    },
    async emitToStudyGroup(matchId: UUID, event: string, payload: unknown): Promise<void> {
      io.to(`study-group:${matchId}`).emit(event, payload);
    },
  };
  const presence = new PresenceTracker();
  if (httpServer && typeof httpServer.on === "function") {
    httpServer.on("close", () => {
      presence.dispose();
    });
  }


  io.use(async (socket, next) => {
    const authInput: unknown = socket.handshake.auth;
    const token =
      typeof authInput === "object" &&
      authInput !== null &&
      "token" in authInput &&
      typeof authInput.token === "string"
        ? authInput.token.trim()
        : "";

    if (!token) {
      const err = new Error("UNAUTHORIZED") as Error & {
        data?: { code: string; statusCode: number };
      };
      err.data = { code: "UNAUTHORIZED", statusCode: 401 };
      return next(err);
    }

    try {
      const actor = await dependencies.auth.verifyToken(token);
      socket.data.actor = actor;
      return next();
    } catch (error) {
      if (error instanceof AppError) {
        if (error.code === "SERVICE_UNAVAILABLE" || error.statusCode === 503) {
          const err = new Error("SERVICE_UNAVAILABLE") as Error & {
            data?: { code: string; statusCode: number };
          };
          err.data = { code: "SERVICE_UNAVAILABLE", statusCode: 503 };
          return next(err);
        }
        if (error.code === "UNAUTHORIZED" || error.statusCode === 401) {
          const err = new Error("UNAUTHORIZED") as Error & {
            data?: { code: string; statusCode: number };
          };
          err.data = { code: "UNAUTHORIZED", statusCode: 401 };
          return next(err);
        }
      }
      const err = new Error("INTERNAL_SERVER_ERROR") as Error & {
        data?: { code: string; statusCode: number };
      };
      err.data = { code: "INTERNAL_SERVER_ERROR", statusCode: 500 };
      return next(err);
    }
  });

  io.on("connection", async (socket) => {
    const actor = socket.data.actor;
    const joinedLectures = new Map<UUID, UUID>();

    socket.on("disconnect", () => {
      for (const [lectureId, studentId] of joinedLectures.entries()) {
        presence.disconnect(lectureId, studentId, socket.id);
      }
      joinedLectures.clear();
    });

    if (actor.role === "student") {
      try {
        for (const enrollment of actor.enrolledCourses) {
          const room = `student:${enrollment.studentId}`;
          await dependencies.rooms.authorizeRoom(actor, room);
          if (!socket.connected) {
            return;
          }
          await socket.join(room);
        }
      } catch (err) {
        console.error("Failed to initialize student private rooms:", err);
        socket.disconnect(true);
        return;
      }
    }

    let operationQueue = Promise.resolve();

    function enqueueOperation(op: () => Promise<void>): void {
      const next = operationQueue.then(op, op);
      operationQueue = next.then(
        () => {},
        (queueErr: unknown) => {
          console.error("Realtime room operation queue error:", queueErr);
        }
      );
    }

    socket.on("lecture:join", (rawPayload, ack) => {
      if (typeof ack !== "function") {
        return;
      }

      enqueueOperation(async () => {
        const parseResult = lectureJoinPayloadSchema.safeParse(rawPayload);
        if (!parseResult.success) {
          ack({ success: false, error: "VALIDATION_ERROR" });
          return;
        }

        const { lectureId } = parseResult.data;

        try {
          if (actor.role === "teacher") {
            await dependencies.rooms.authorizeRoom(actor, `professor:${lectureId}`);
            if (!socket.connected) {
              return;
            }
            try {
              await socket.join(`lecture:${lectureId}`);
              await socket.join(`professor:${lectureId}`);
            } catch (joinErr) {
              await socket.leave(`lecture:${lectureId}`);
              await socket.leave(`professor:${lectureId}`);
              throw joinErr;
            }
          } else {
            await dependencies.rooms.authorizeRoom(actor, `lecture:${lectureId}`);
            if (!socket.connected) {
              return;
            }
            const lecture = await dependencies.lectures.getLecture(lectureId);
            const enrollment = actor.enrolledCourses.find(
              (e) => e.courseId === lecture.courseId
            );
            if (!enrollment) {
              throw new AppError({
                code: "FORBIDDEN",
                statusCode: 403,
                message: "Student is not enrolled in course for this lecture",
              });
            }
            if (!socket.connected) {
              return;
            }
            await socket.join(`lecture:${lectureId}`);
            if (!socket.connected) {
              try {
                await socket.leave(`lecture:${lectureId}`);
              } catch {
                // Ignore cleanup error if already disconnected
              }
              return;
            }
            presence.join(lectureId, enrollment.studentId, socket.id);
            joinedLectures.set(lectureId, enrollment.studentId);
          }
          ack({ success: true });
        } catch (err) {
          if (err instanceof AppError) {
            ack({ success: false, error: err.code });
          } else {
            ack({ success: false, error: "INTERNAL_SERVER_ERROR" });
          }
        }
      });
    });

    socket.on("lecture:leave", (rawPayload, ack) => {
      if (typeof ack !== "function") {
        return;
      }

      enqueueOperation(async () => {
        const parseResult = lectureLeavePayloadSchema.safeParse(rawPayload);
        if (!parseResult.success) {
          ack({ success: false, error: "VALIDATION_ERROR" });
          return;
        }

        const { lectureId } = parseResult.data;

        const studentId = joinedLectures.get(lectureId);
        if (studentId) {
          joinedLectures.delete(lectureId);
          presence.leave(lectureId, studentId, socket.id);
        }

        try {
          await socket.leave(`lecture:${lectureId}`);
          await socket.leave(`professor:${lectureId}`);
          ack({ success: true });
        } catch (err) {
          console.error(`Failed to leave rooms for lecture ${lectureId}:`, err);
          if (err instanceof AppError) {
            ack({ success: false, error: err.code });
          } else {
            ack({ success: false, error: "INTERNAL_SERVER_ERROR" });
          }
          socket.disconnect(true);
        }
      });
    });

    socket.on("study-group:join", (rawPayload, ack) => {
      if (typeof ack !== "function") {
        return;
      }

      enqueueOperation(async () => {
        const parseResult = studyGroupJoinPayloadSchema.safeParse(rawPayload);
        if (!parseResult.success) {
          ack({ success: false, error: "VALIDATION_ERROR" });
          return;
        }

        const { matchId } = parseResult.data;
        const room = `study-group:${matchId}`;

        try {
          await dependencies.rooms.authorizeRoom(actor, room);
          if (!socket.connected) {
            return;
          }

          try {
            await socket.join(room);
          } catch (joinErr) {
            try {
              await socket.leave(room);
            } catch (cleanupErr) {
              console.error(`Failed to cleanup room ${room} after join error:`, cleanupErr);
              socket.disconnect(true);
            }
            throw joinErr;
          }

          if (!socket.connected) {
            try {
              await socket.leave(room);
            } catch {
              // Ignore cleanup if already disconnected
            }
            return;
          }

          ack({ success: true });
        } catch (err) {
          if (err instanceof AppError) {
            ack({ success: false, error: err.code });
          } else {
            ack({ success: false, error: "INTERNAL_SERVER_ERROR" });
          }
        }
      });
    });

    socket.on("study-group:leave", (rawPayload, ack) => {
      if (typeof ack !== "function") {
        return;
      }

      enqueueOperation(async () => {
        const parseResult = studyGroupLeavePayloadSchema.safeParse(rawPayload);
        if (!parseResult.success) {
          ack({ success: false, error: "VALIDATION_ERROR" });
          return;
        }

        const { matchId } = parseResult.data;
        const room = `study-group:${matchId}`;

        try {
          await socket.leave(room);
          ack({ success: true });
        } catch (err) {
          console.error(`Failed to leave room ${room}:`, err);
          if (err instanceof AppError) {
            ack({ success: false, error: err.code });
          } else {
            ack({ success: false, error: "INTERNAL_SERVER_ERROR" });
          }
          socket.disconnect(true);
        }
      });
    });
  });

  return { io, publisher, presence };
}
