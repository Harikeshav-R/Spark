import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { uuidSchema, type UUID } from "../../contracts/common.js";
import {
  lectureSnapshotSchema,
  lectureSessionSchema,
  type LectureSnapshot,
} from "../../contracts/classroom.js";
import type { CourseService } from "../../contracts/course.js";
import { AppError } from "../../contracts/errors.js";
import type { AuthGateway } from "../platform/index.js";
import { requireAuth } from "../platform/index.js";
import type { RoomAuthorizer } from "../realtime/index.js";
import type { LectureRepository } from "./lecture-repository.js";
import type { LectureService } from "./lecture-service.js";
import type { PollRepository } from "./poll-repository.js";
import type { TranscriptRepository } from "./transcript-repository.js";

const startLectureBodySchema = z
  .object({
    title: z.string().trim().min(1, "Title must not be empty").max(255),
  })
  .strict();

export interface LectureRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  courses: Pick<CourseService, "getCourse">;
  lectures: Pick<LectureRepository, "getLecture" | "listLectures">;
  lectureService: Pick<LectureService, "startLecture">;
  polls: Pick<PollRepository, "getActivePoll">;
  transcripts: Pick<TranscriptRepository, "getRecentChunks">;
  rooms: Pick<RoomAuthorizer, "authorizeRoom">;
}

export function createLectureRouter(dependencies: LectureRouterDependencies): Router {
  const router = express.Router();
  const authMiddleware = requireAuth(dependencies.auth);

  // 1. GET /api/courses/:courseId/lectures - List course lectures
  router.get(
    "/api/courses/:courseId/lectures",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const rawCourseId = req.params["courseId"];
        const courseIdParam = typeof rawCourseId === "string" ? rawCourseId : "";
        if (!uuidSchema.safeParse(courseIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid course ID format in request URL",
          });
        }

        // Authorize course access
        await dependencies.courses.getCourse(actor, courseIdParam as UUID);

        const lectures = await dependencies.lectures.listLectures(courseIdParam as UUID);
        const validLectures = z.array(lectureSessionSchema).parse(lectures);
        res.status(200).json(validLectures);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 2. POST /api/courses/:courseId/lectures - Start lecture
  router.post(
    "/api/courses/:courseId/lectures",
    authMiddleware,
    express.json(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        if (actor.role !== "teacher" || !actor.teacherId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only teachers can start lectures",
          });
        }

        const rawCourseId = req.params["courseId"];
        const courseIdParam = typeof rawCourseId === "string" ? rawCourseId : "";
        if (!uuidSchema.safeParse(courseIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid course ID format in request URL",
          });
        }

        // Verify teacher owns the course
        const course = await dependencies.courses.getCourse(actor, courseIdParam as UUID);
        if (course.teacherId !== actor.teacherId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "You do not own this course",
          });
        }

        const parsedBody = startLectureBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid start lecture request body",
            cause: parsedBody.error,
          });
        }

        const lecture = await dependencies.lectureService.startLecture(
          actor,
          courseIdParam as UUID,
          parsedBody.data.title
        );
        const validLecture = lectureSessionSchema.parse(lecture);
        res.status(201).json(validLecture);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 3. GET /api/lectures/:lectureId/snapshot - Lecture snapshot
  router.get(
    "/api/lectures/:lectureId/snapshot",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const rawLectureId = req.params["lectureId"];
        const lectureIdParam = typeof rawLectureId === "string" ? rawLectureId : "";
        if (!uuidSchema.safeParse(lectureIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid lecture ID format in request URL",
          });
        }

        // Authorize lecture room access
        await dependencies.rooms.authorizeRoom(actor, `lecture:${lectureIdParam}`);

        const lecture = await dependencies.lectures.getLecture(lectureIdParam as UUID);
        const [activePoll, recentChunks] = await Promise.all([
          dependencies.polls.getActivePoll(actor, lectureIdParam as UUID),
          dependencies.transcripts.getRecentChunks(lectureIdParam as UUID, 50),
        ]);

        let activeConceptIds: UUID[] = [];
        if (lecture.status === "completed") {
          activeConceptIds = [];
        } else {
          const newestTimestamp =
            recentChunks.length > 0
              ? recentChunks[recentChunks.length - 1]!.timestampSec
              : 0;
          const minTimestamp = Math.max(0, newestTimestamp - 90);
          const activeSet = new Set<UUID>();

          for (const chunk of recentChunks) {
            if (chunk.timestampSec >= minTimestamp && chunk.timestampSec <= newestTimestamp) {
              for (const cid of chunk.detectedConceptIds) {
                activeSet.add(cid);
              }
            }
          }

          if (activePoll) {
            activeSet.add(activePoll.conceptId);
          }

          activeConceptIds = Array.from(activeSet);
        }

        const snapshot: LectureSnapshot = {
          lecture,
          activePoll,
          recentChunks,
          activeConceptIds,
        };

        const validSnapshot = lectureSnapshotSchema.parse(snapshot);
        res.status(200).json(validSnapshot);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // Error handler
  router.use(
    (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
      if (res.headersSent) {
        next(err);
        return;
      }

      if (err instanceof AppError) {
        res.status(err.statusCode).json(err.toResponse());
        return;
      }

      if (
        err instanceof SyntaxError &&
        "status" in err &&
        typeof err.status === "number" &&
        err.status === 400 &&
        "body" in err
      ) {
        const validationErr = new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Malformed JSON payload",
          cause: err,
        });
        res.status(400).json(validationErr.toResponse());
        return;
      }

      const internalErr = new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "An internal server error occurred",
        cause: err,
      });
      res.status(500).json(internalErr.toResponse());
    }
  );

  return router;
}
