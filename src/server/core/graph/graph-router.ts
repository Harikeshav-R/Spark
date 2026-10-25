import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { uuidSchema, type UUID } from "../../../contracts/common.js";
import {
  courseGraphResponseSchema,
  syllabusPreviewSchema,
} from "../../../contracts/course.js";
import { AppError } from "../../../contracts/errors.js";
import type { AuthGateway } from "../../platform/index.js";
import { requireAuth } from "../../platform/index.js";
import type { CourseRepository } from "../courses/course-repository.js";
import type { GraphRepository } from "./graph-repository.js";
import type { MasteryRepository } from "../mastery/mastery-repository.js";
import { GraphService } from "./graph-service.js";

export interface GraphRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  courses: Pick<CourseRepository, "getCourse">;
  graphRepository: Pick<GraphRepository, "getTopology" | "commitKnowledgeGraph">;
  masteryRepository: Pick<MasteryRepository, "getMastery">;
}

export function createGraphRouter(dependencies: GraphRouterDependencies): Router {
  const router = express.Router();
  const authMiddleware = requireAuth(dependencies.auth);

  router.get(
    "/api/courses/:courseId/graph",
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

        // Verify course access before computing graph
        await dependencies.courses.getCourse(actor, courseIdParam as UUID);

        const graphService = new GraphService(
          actor,
          dependencies.graphRepository,
          dependencies.masteryRepository
        );

        const domainGraph = await graphService.getCourseGraph(actor, courseIdParam as UUID);

        // Serialize domain edges (sourceId/targetId) to wire schema (source/target)
        const wireEdges = domainGraph.edges.map((e) => ({
          id: e.id,
          source: e.sourceId,
          target: e.targetId,
          relationship: e.relationship,
        }));

        const responsePayload = courseGraphResponseSchema.parse({
          nodes: domainGraph.nodes,
          edges: wireEdges,
        });

        res.status(200).json(responsePayload);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/courses/:courseId/graph - Commit knowledge graph (teachers only)
  router.post(
    "/api/courses/:courseId/graph",
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

        // Verify course access before committing
        await dependencies.courses.getCourse(actor, courseIdParam as UUID);

        const parsed = syllabusPreviewSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid graph payload format",
            cause: parsed.error,
          });
        }

        const graphService = new GraphService(
          actor,
          dependencies.graphRepository,
          dependencies.masteryRepository
        );

        const result = await graphService.commitKnowledgeGraph(
          actor,
          courseIdParam as UUID,
          parsed.data.concepts,
          parsed.data.edges
        );

        res.status(201).json({
          success: true,
          nodeCount: result.nodeCount,
          edgeCount: result.edgeCount,
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
