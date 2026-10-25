import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { uuidSchema } from "../../../contracts/common.js";
import { AppError } from "../../../contracts/errors.js";
import type { AuthGateway } from "../../platform/index.js";
import { requireAuth, apiErrorHandler } from "../../platform/index.js";
import type { HeatmapService } from "./heatmap-service.js";

export interface HeatmapRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  heatmap: Pick<HeatmapService, "getCourseSnapshot">;
}

export function createHeatmapRouter(dependencies: HeatmapRouterDependencies): Router {
  const router = express.Router();

  router.get(
    "/api/courses/:courseId/heatmap",
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

        const snapshot = await dependencies.heatmap.getCourseSnapshot(actor, parsedCourseId.data);
        res.status(200).json(snapshot);
      } catch (err: unknown) {
        next(err);
      }
    },
  );

  router.use(apiErrorHandler);

  return router;
}
