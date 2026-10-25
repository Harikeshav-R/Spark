import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { AuthGateway } from "../platform/index";
import { requireAuth } from "../platform/index";
import type { ConceptContextRepository } from "../core/courses/concept-context-repository";
import type { EncounterService } from "./encounter-service";
import type { EncounterRepositoryPort } from "./encounter-repository";
import { uuidSchema, type UUID, type ActorContext } from "../../contracts/common";
import {
  createEncounterInputSchema,
  encounterSchema,
  encounterResultSchema,
  type HintLevel,
} from "../../contracts/game";
import { AppError } from "../../contracts/errors";

const hintInputSchema = z
  .object({
    questionId: uuidSchema,
    level: z.number().int().min(1).max(3),
  })
  .strict();

const submitEncounterInputSchema = z
  .object({
    answers: z.array(
      z
        .object({
          questionId: uuidSchema,
          selectedOption: z.number().int().min(0).max(3),
        })
        .strict()
    ),
  })
  .strict();

export interface EncounterRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  conceptContext: Pick<ConceptContextRepository, "resolve">;
  encounterRepository: Pick<EncounterRepositoryPort, "getEncounter">;
  createEncounterService: (
    courseId: UUID
  ) => Pick<
    EncounterService,
    "createEncounter" | "getEncounter" | "getHint" | "submitEncounter"
  >;
}

async function resolveStudentEncounter(
  actor: ActorContext,
  rawEncounterId: string | undefined,
  repository: Pick<EncounterRepositoryPort, "getEncounter">
): Promise<{ encounterId: UUID; studentId: UUID; courseId: UUID }> {
  if (actor.role !== "student") {
    throw new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Only enrolled students can access encounters",
    });
  }

  const parsedId = uuidSchema.safeParse(rawEncounterId);
  if (!parsedId.success) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: "Invalid encounter ID format",
    });
  }

  if (!actor.enrolledCourses || actor.enrolledCourses.length === 0) {
    throw new AppError({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "Encounter not found",
    });
  }

  for (const enrollment of actor.enrolledCourses) {
    const record = await repository.getEncounter(
      enrollment.studentId,
      parsedId.data
    );
    if (record) {
      return {
        encounterId: parsedId.data,
        studentId: enrollment.studentId,
        courseId: enrollment.courseId,
      };
    }
  }

  throw new AppError({
    code: "NOT_FOUND",
    statusCode: 404,
    message: "Encounter not found",
  });
}

export function createEncounterRouter(
  dependencies: EncounterRouterDependencies
): Router {
  const router = Router();
  const authMiddleware = requireAuth(dependencies.auth);

  // POST /api/students/:studentId/encounters - Canonical encounter creation
  router.post(
    "/api/students/:studentId/encounters",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const parsedStudentId = uuidSchema.safeParse(req.params.studentId);
        if (!parsedStudentId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid student ID in encounter route path",
          });
        }

        const parsedBody = createEncounterInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid encounter creation payload",
            cause: parsedBody.error,
          });
        }

        const context = await dependencies.conceptContext.resolve(
          actor,
          parsedBody.data.conceptId
        );

        if (!context.studentId || context.studentId !== parsedStudentId.data) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Actor is not authorized for the requested student encounter",
          });
        }

        const service = dependencies.createEncounterService(context.courseId);
        const encounter = await service.createEncounter(
          actor,
          parsedStudentId.data,
          parsedBody.data
        );

        res.status(201).json(encounterSchema.parse(encounter));
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // GET /api/encounters/:encounterId
  router.get(
    "/api/encounters/:encounterId",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const rawId = req.params["encounterId"];
        const encounterId = Array.isArray(rawId) ? rawId[0] : rawId;
        const resolved = await resolveStudentEncounter(
          actor,
          encounterId,
          dependencies.encounterRepository
        );

        const service = dependencies.createEncounterService(resolved.courseId);
        const data = await service.getEncounter(actor, resolved.encounterId);

        res.status(200).json(data);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/encounters/:encounterId/hints
  router.post(
    "/api/encounters/:encounterId/hints",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const rawId = req.params["encounterId"];
        const encounterId = Array.isArray(rawId) ? rawId[0] : rawId;
        const resolved = await resolveStudentEncounter(
          actor,
          encounterId,
          dependencies.encounterRepository
        );

        const parsedBody = hintInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "INVALID_HINT_LEVEL",
            statusCode: 400,
            message: "Invalid hint level request payload",
            cause: parsedBody.error,
          });
        }

        const service = dependencies.createEncounterService(resolved.courseId);
        const hint = await service.getHint(
          actor,
          resolved.encounterId,
          parsedBody.data.questionId,
          parsedBody.data.level as HintLevel
        );

        res.status(200).json(hint);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/encounters/:encounterId/submit
  router.post(
    "/api/encounters/:encounterId/submit",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const rawId = req.params["encounterId"];
        const encounterId = Array.isArray(rawId) ? rawId[0] : rawId;
        const resolved = await resolveStudentEncounter(
          actor,
          encounterId,
          dependencies.encounterRepository
        );

        const parsedBody = submitEncounterInputSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid encounter answers submission payload",
            cause: parsedBody.error,
          });
        }

        const service = dependencies.createEncounterService(resolved.courseId);
        const result = await service.submitEncounter(
          actor,
          resolved.encounterId,
          parsedBody.data.answers
        );

        res.status(200).json(encounterResultSchema.parse(result));
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}
