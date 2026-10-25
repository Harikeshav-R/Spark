import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { AuthGateway } from "../platform/index";
import { requireAuth } from "../platform/index";
import type { ConceptContextRepository } from "../core/courses/concept-context-repository";
import type { LearningPageService } from "./learning-page-service";
import type { QuizService } from "./quiz-service";
import type { SearchResourcesAi, ResourceQaAi } from "../ai/index";
import { uuidSchema, type UUID } from "../../contracts/common";
import {
  getLearningPageResponseSchema,
  getQuizResponseSchema,
  submitQuizResponseSchema,
} from "../../contracts/learning";
import {
  academicResourcesSchema,
  answeredResourceQuestionSchema,
} from "../../contracts/ai";
import { AppError } from "../../contracts/errors";

const submitQuizInputSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: uuidSchema,
            selectedOption: z.number().int().min(0).max(3),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict();

const searchResourcesInputSchema = z
  .object({
    conceptId: uuidSchema,
    query: z.string().optional(),
  })
  .strict();

const askResourceInputSchema = z
  .object({
    conceptId: uuidSchema,
    question: z.string().min(1).max(2000),
  })
  .strict();

export interface LearningRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  conceptContext: Pick<ConceptContextRepository, "resolve">;
  createLearningPageService: (courseId: UUID) => Pick<LearningPageService, "getLearningPage">;
  createQuizService: (courseId: UUID) => Pick<QuizService, "getQuiz" | "submitQuiz">;
  searchResourcesAi: Pick<SearchResourcesAi, "searchAcademicResources">;
  resourceQaAi: Pick<ResourceQaAi, "answerResourceQuestion">;
}

export function createLearningRouter(dependencies: LearningRouterDependencies): Router {
  const router = Router();
  const authMiddleware = requireAuth(dependencies.auth);

  // GET /api/concepts/:conceptId/learning-page
  router.get(
    "/api/concepts/:conceptId/learning-page",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedId = uuidSchema.safeParse(req.params.conceptId);
        if (!parsedId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid concept ID format",
          });
        }

        const context = await dependencies.conceptContext.resolve(actor, parsedId.data);
        const service = dependencies.createLearningPageService(context.courseId);
        const content = await service.getLearningPage(actor, parsedId.data);

        res.status(200).json(
          getLearningPageResponseSchema.parse({
            conceptId: parsedId.data,
            content,
          })
        );
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // GET /api/concepts/:conceptId/quiz
  router.get(
    "/api/concepts/:conceptId/quiz",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedId = uuidSchema.safeParse(req.params.conceptId);
        if (!parsedId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid concept ID format",
          });
        }

        const context = await dependencies.conceptContext.resolve(actor, parsedId.data);
        const service = dependencies.createQuizService(context.courseId);
        const questions = await service.getQuiz(actor, parsedId.data);

        res.status(200).json(
          getQuizResponseSchema.parse({
            conceptId: parsedId.data,
            questions,
          })
        );
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/concepts/:conceptId/quiz-submit
  router.post(
    "/api/concepts/:conceptId/quiz-submit",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedId = uuidSchema.safeParse(req.params.conceptId);
        if (!parsedId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid concept ID format",
          });
        }

        const context = await dependencies.conceptContext.resolve(actor, parsedId.data);
        if (!context.studentId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only students enrolled in this course can submit quizzes",
          });
        }

        const parsedBody = submitQuizInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid quiz answers payload",
            cause: parsedBody.error,
          });
        }

        const service = dependencies.createQuizService(context.courseId);
        const result = await service.submitQuiz(
          actor,
          context.studentId,
          parsedId.data,
          parsedBody.data.answers
        );

        res.status(200).json(submitQuizResponseSchema.parse(result));
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/resources/search
  router.post(
    "/api/resources/search",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedBody = searchResourcesInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid academic resource search payload",
            cause: parsedBody.error,
          });
        }

        const context = await dependencies.conceptContext.resolve(
          actor,
          parsedBody.data.conceptId
        );

        const resources = await dependencies.searchResourcesAi.searchAcademicResources(
          context.concept.label,
          parsedBody.data.query
        );

        res.status(200).json(
          academicResourcesSchema.parse({
            resources,
          })
        );
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/resources/ask
  router.post(
    "/api/resources/ask",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedBody = askResourceInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid academic Q&A payload",
            cause: parsedBody.error,
          });
        }

        const context = await dependencies.conceptContext.resolve(
          actor,
          parsedBody.data.conceptId
        );

        const answered = await dependencies.resourceQaAi.answerResourceQuestion(
          context.concept,
          parsedBody.data.question
        );

        res.status(200).json(answeredResourceQuestionSchema.parse(answered));
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}
