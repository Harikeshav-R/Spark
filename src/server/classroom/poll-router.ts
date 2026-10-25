import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { uuidSchema, type UUID } from "../../contracts/common.js";
import {
  pollDraftInputSchema,
  teacherPollSnapshotSchema,
  pollQuestionSchema,
  pollResponseResultSchema,
} from "../../contracts/classroom.js";
import { AppError } from "../../contracts/errors.js";
import type { AuthGateway } from "../platform/index.js";
import { requireAuth } from "../platform/index.js";
import type { PollService } from "./poll-service.js";
import type { TeacherPollService } from "./teacher-poll-service.js";
import type { PollRepository } from "./poll-repository.js";

const generatePollBodySchema = z
  .object({
    conceptId: uuidSchema.optional(),
  })
  .strict();

const respondPollBodySchema = z
  .object({
    answer: z.string().trim().min(1, "Answer must not be empty"),
  })
  .strict();

export interface PollRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  polls: Pick<PollService, "activatePoll" | "closePoll" | "respondToPoll">;
  teacherPolls: Pick<
    TeacherPollService,
    "generatePoll" | "editDraft" | "getSnapshot"
  >;
  pollRepo: Pick<PollRepository, "getPoll">;
}

export function createPollRouter(dependencies: PollRouterDependencies): Router {
  const router = express.Router();
  const authMiddleware = requireAuth(dependencies.auth);

  // 1. GET /api/lectures/:lectureId/polls - Teacher Poll Snapshot
  router.get(
    "/api/lectures/:lectureId/polls",
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

        if (actor.role !== "teacher" || !actor.teacherId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only teachers can view teacher poll snapshots",
          });
        }

        const rawLectureId = req.params["lectureId"];
        const lectureIdParam =
          typeof rawLectureId === "string" ? rawLectureId : "";
        if (!uuidSchema.safeParse(lectureIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid lecture ID format in request URL",
          });
        }

        const snapshot = await dependencies.teacherPolls.getSnapshot(
          actor,
          lectureIdParam as UUID
        );
        const validSnapshot = teacherPollSnapshotSchema.parse(snapshot);
        res.status(200).json(validSnapshot);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 2. POST /api/lectures/:lectureId/poll/generate - Generate draft poll
  router.post(
    "/api/lectures/:lectureId/poll/generate",
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
            message: "Only teachers can generate polls",
          });
        }

        const rawLectureId = req.params["lectureId"];
        const lectureIdParam =
          typeof rawLectureId === "string" ? rawLectureId : "";
        if (!uuidSchema.safeParse(lectureIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid lecture ID format in request URL",
          });
        }

        const parsedBody = generatePollBodySchema.safeParse(req.body ?? {});
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid generate poll request body",
            cause: parsedBody.error,
          });
        }

        const draft = await dependencies.teacherPolls.generatePoll(
          actor,
          lectureIdParam as UUID,
          parsedBody.data.conceptId
        );
        const validDraft = pollQuestionSchema.parse(draft);
        res.status(201).json(validDraft);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 3. PATCH /api/polls/:pollId - Edit draft poll
  router.patch(
    "/api/polls/:pollId",
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
            message: "Only teachers can edit draft polls",
          });
        }

        const rawPollId = req.params["pollId"];
        const pollIdParam = typeof rawPollId === "string" ? rawPollId : "";
        if (!uuidSchema.safeParse(pollIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid poll ID format in request URL",
          });
        }

        const parsedBody = pollDraftInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid draft input payload",
            cause: parsedBody.error,
          });
        }

        const savedDraft = await dependencies.teacherPolls.editDraft(
          actor,
          pollIdParam as UUID,
          parsedBody.data
        );
        const validPoll = pollQuestionSchema.parse(savedDraft);
        res.status(200).json(validPoll);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 4. POST /api/polls/:pollId/activate - Activate poll
  router.post(
    "/api/polls/:pollId/activate",
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

        if (actor.role !== "teacher" || !actor.teacherId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only teachers can activate polls",
          });
        }

        const rawPollId = req.params["pollId"];
        const pollIdParam = typeof rawPollId === "string" ? rawPollId : "";
        if (!uuidSchema.safeParse(pollIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid poll ID format in request URL",
          });
        }

        const activated = await dependencies.polls.activatePoll(
          actor,
          pollIdParam as UUID
        );
        const validPoll = pollQuestionSchema.parse(activated);
        res.status(200).json(validPoll);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 5. POST /api/polls/:pollId/close - Close poll
  router.post(
    "/api/polls/:pollId/close",
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

        if (actor.role !== "teacher" || !actor.teacherId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only teachers can close polls",
          });
        }

        const rawPollId = req.params["pollId"];
        const pollIdParam = typeof rawPollId === "string" ? rawPollId : "";
        if (!uuidSchema.safeParse(pollIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid poll ID format in request URL",
          });
        }

        const closed = await dependencies.polls.closePoll(
          actor,
          pollIdParam as UUID
        );
        const validPoll = pollQuestionSchema.parse(closed);
        res.status(200).json(validPoll);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 6. POST /api/polls/:pollId/respond - Submit poll response
  router.post(
    "/api/polls/:pollId/respond",
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

        if (actor.role !== "student") {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only students can respond to polls",
          });
        }

        const rawPollId = req.params["pollId"];
        const pollIdParam = typeof rawPollId === "string" ? rawPollId : "";
        if (!uuidSchema.safeParse(pollIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid poll ID format in request URL",
          });
        }

        const parsedBody = respondPollBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid response payload",
            cause: parsedBody.error,
          });
        }

        // Authorize poll and derive student ID from verified actor enrollment in this course
        const pollContext = await dependencies.pollRepo.getPoll(
          actor,
          pollIdParam as UUID
        );
        const enrollment = actor.enrolledCourses?.find(
          (e) => e.courseId === pollContext.courseId
        );
        if (!enrollment) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Student is not enrolled in the poll's course",
          });
        }

        const result = await dependencies.polls.respondToPoll(
          actor,
          pollIdParam as UUID,
          enrollment.studentId,
          parsedBody.data.answer
        );

        const validResult = pollResponseResultSchema.parse(result);
        res.status(200).json(validResult);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // Standard error handler for poll router
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
