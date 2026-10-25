import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { uuidSchema } from "../../../contracts/common.js";
import { AppError } from "../../../contracts/errors.js";
import type { GameService } from "../../../contracts/game.js";
import type { AuthGateway } from "../../platform/index.js";
import { apiErrorHandler, requireAuth } from "../../platform/index.js";

export interface GameRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  game: Pick<GameService, "getDailyQuest" | "getSummary" | "getEclipse">;
}

export function createGameRouter(dependencies: GameRouterDependencies): Router {
  const router = express.Router();

  // Middleware ensuring Cache-Control: private, no-store for all game endpoints
  const cacheControlMiddleware = (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  };

  router.get(
    "/api/students/:studentId/daily-quest",
    cacheControlMiddleware,
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

        const rawStudentId = req.params["studentId"];
        const studentIdParam = typeof rawStudentId === "string" ? rawStudentId : "";
        const parsedStudentId = uuidSchema.safeParse(studentIdParam);
        if (!parsedStudentId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid student ID format in request URL",
            cause: parsedStudentId.error,
          });
        }

        const dailyQuest = await dependencies.game.getDailyQuest(
          actor,
          parsedStudentId.data,
        );
        res.status(200).json(dailyQuest);
      } catch (err: unknown) {
        next(err);
      }
    },
  );

  router.get(
    "/api/students/:studentId/game-summary",
    cacheControlMiddleware,
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

        const rawStudentId = req.params["studentId"];
        const studentIdParam = typeof rawStudentId === "string" ? rawStudentId : "";
        const parsedStudentId = uuidSchema.safeParse(studentIdParam);
        if (!parsedStudentId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid student ID format in request URL",
            cause: parsedStudentId.error,
          });
        }

        const summary = await dependencies.game.getSummary(
          actor,
          parsedStudentId.data,
        );
        res.status(200).json(summary);
      } catch (err: unknown) {
        next(err);
      }
    },
  );

  router.get(
    "/api/students/:studentId/eclipse",
    cacheControlMiddleware,
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

        const rawStudentId = req.params["studentId"];
        const studentIdParam = typeof rawStudentId === "string" ? rawStudentId : "";
        const parsedStudentId = uuidSchema.safeParse(studentIdParam);
        if (!parsedStudentId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid student ID format in request URL",
            cause: parsedStudentId.error,
          });
        }

        const eclipse = await dependencies.game.getEclipse(
          actor,
          parsedStudentId.data,
        );
        res.status(200).json(eclipse);
      } catch (err: unknown) {
        next(err);
      }
    },
  );

  router.use(apiErrorHandler);

  return router;
}
