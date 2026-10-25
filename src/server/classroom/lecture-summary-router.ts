import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import type { ClassroomService } from "../../contracts/classroom.js";
import type { ActorContext, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import type { LectureSummaryRecord } from "../learning/index.js";
import type { AuthGateway } from "../platform/index.js";
import { requireAuth } from "../platform/index.js";

export interface LectureSummaryRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  classroom: Pick<ClassroomService, "endLecture">;
  summaries: {
    getSummary(actor: ActorContext, lectureId: UUID): Promise<LectureSummaryRecord>;
  };
}

export function createLectureSummaryRouter(
  dependencies: LectureSummaryRouterDependencies
): Router {
  const router = express.Router();

  router.post(
    "/api/lectures/:lectureId/end",
    requireAuth(dependencies.auth),
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
        const lectureIdParam =
          typeof rawLectureId === "string" ? rawLectureId : "";
        if (!uuidSchema.safeParse(lectureIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid lecture ID format in request URL",
          });
        }

        const completed = await dependencies.classroom.endLecture(
          actor,
          lectureIdParam
        );
        res.status(200).json(completed);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  router.get(
    "/api/lectures/:lectureId/summary",
    requireAuth(dependencies.auth),
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
        const lectureIdParam =
          typeof rawLectureId === "string" ? rawLectureId : "";
        if (!uuidSchema.safeParse(lectureIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid lecture ID format in request URL",
          });
        }

        const summary = await dependencies.summaries.getSummary(
          actor,
          lectureIdParam
        );
        res.status(200).json({
          lectureId: summary.lectureId,
          summary: summary.summary,
          keyConceptsCovered: summary.keyConceptsCovered,
          timelineHighlights: summary.timelineHighlights,
          generatedAt: summary.generatedAt,
        });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

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
