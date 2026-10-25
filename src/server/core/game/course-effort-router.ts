import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { uuidSchema } from "../../../contracts/common.js";
import type { GameService } from "../../../contracts/game.js";
import { AppError } from "../../../contracts/errors.js";
import type { AuthGateway } from "../../platform/index.js";
import { requireAuth, apiErrorHandler } from "../../platform/index.js";

export interface CourseEffortRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  game: Pick<GameService, "getCourseEffort" | "getClassSky">;
}

export function createCourseEffortRouter(
  dependencies: CourseEffortRouterDependencies,
): Router {
  const router = express.Router();

  router.get(
    "/api/courses/:courseId/students/effort",
    (_req: Request, res: Response, next: NextFunction): void => {
      res.setHeader("Cache-Control", "private, no-store");
      next();
    },
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

        const rawCourseId = req.params["courseId"];
        const courseIdParam = typeof rawCourseId === "string" ? rawCourseId : "";
        const parsedCourseId = uuidSchema.safeParse(courseIdParam);
        if (!parsedCourseId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid course ID format in request URL",
            cause: parsedCourseId.error,
          });
        }

        const effort = await dependencies.game.getCourseEffort(actor, parsedCourseId.data);
        res.status(200).json(effort);
      } catch (err: unknown) {
        next(err);
      }
    },
  );

  router.get(
    "/api/courses/:courseId/class-sky",
    (_req: Request, res: Response, next: NextFunction): void => {
      res.setHeader("Cache-Control", "private, no-store");
      next();
    },
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


        const rawCourseId = req.params["courseId"];
        const courseIdParam = typeof rawCourseId === "string" ? rawCourseId : "";
        const parsedCourseId = uuidSchema.safeParse(courseIdParam);
        if (!parsedCourseId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid course ID format in request URL",
            cause: parsedCourseId.error,
          });
        }

        const classSky = await dependencies.game.getClassSky(actor, parsedCourseId.data);
        res.status(200).json(classSky);
      } catch (err: unknown) {
        next(err);
      }
    },
  );

  router.use(apiErrorHandler);

  return router;
}
