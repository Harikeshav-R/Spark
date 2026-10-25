import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { AuthGateway } from "../platform/index";
import { requireAuth } from "../platform/index";
import type { ConceptContextRepository } from "../core/courses/concept-context-repository";
import type { TutoringService } from "./tutoring-service";
import type { TutoringRepositoryPort } from "./tutoring-repository";
import { uuidSchema } from "../../contracts/common";
import {
  createTutoringSessionResponseSchema,
  submitTutoringMessageResponseSchema,
} from "../../contracts/learning";
import { AppError } from "../../contracts/errors";

const createSessionInputSchema = z
  .object({
    conceptIds: z.array(uuidSchema).min(1),
  })
  .strict();

const submitMessageInputSchema = z
  .object({
    content: z.string().min(1).max(2000),
    conceptId: uuidSchema.optional(),
  })
  .strict();

export interface TutoringRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  conceptContext: Pick<ConceptContextRepository, "resolve">;
  tutoringService: Pick<TutoringService, "createTutoringSession" | "submitTutoringMessage">;
  tutoringRepository: Pick<TutoringRepositoryPort, "listMessages">;
}

export function createTutoringRouter(dependencies: TutoringRouterDependencies): Router {
  const router = Router();
  const authMiddleware = requireAuth(dependencies.auth);

  // POST /api/tutoring/sessions
  router.post(
    "/api/tutoring/sessions",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedBody = createSessionInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid tutoring session creation payload",
            cause: parsedBody.error,
          });
        }

        const conceptIds = parsedBody.data.conceptIds;
        const resolvedContexts = await Promise.all(
          conceptIds.map((cId) => dependencies.conceptContext.resolve(actor, cId))
        );

        const firstCourseId = resolvedContexts[0].courseId;
        const firstStudentId = resolvedContexts[0].studentId;

        const allSameCourse = resolvedContexts.every((c) => c.courseId === firstCourseId);
        if (!allSameCourse) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "All tutoring session target concepts must belong to the same course",
          });
        }

        if (!firstStudentId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only enrolled students can initiate tutoring sessions",
          });
        }

        const result = await dependencies.tutoringService.createTutoringSession(
          actor,
          firstStudentId,
          conceptIds
        );

        res.status(201).json(createTutoringSessionResponseSchema.parse(result));
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // GET /api/tutoring/sessions/:sessionId/messages
  router.get(
    "/api/tutoring/sessions/:sessionId/messages",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedSessionId = uuidSchema.safeParse(req.params.sessionId);
        if (!parsedSessionId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid session ID format",
          });
        }

        const messages = await dependencies.tutoringRepository.listMessages(
          actor,
          parsedSessionId.data
        );

        res.status(200).json({ messages });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/tutoring/sessions/:sessionId/messages
  router.post(
    "/api/tutoring/sessions/:sessionId/messages",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedSessionId = uuidSchema.safeParse(req.params.sessionId);
        if (!parsedSessionId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid session ID format",
          });
        }

        const parsedBody = submitMessageInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid tutoring message payload",
            cause: parsedBody.error,
          });
        }

        const result = await dependencies.tutoringService.submitTutoringMessage(
          actor,
          parsedSessionId.data,
          parsedBody.data.content,
          parsedBody.data.conceptId
        );

        res.status(200).json(submitTutoringMessageResponseSchema.parse(result));
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}
