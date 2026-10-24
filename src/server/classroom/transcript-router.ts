import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import type { ClassroomService } from "../../contracts/classroom.js";
import { transcriptIngestResponseSchema } from "../../contracts/classroom.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import type { AuthGateway } from "../platform/index.js";
import { requireAuth } from "../platform/index.js";

const transcriptIngestRequestSchema = z
  .object({
    text: z.string().refine((val) => val.trim().length > 0, {
      message: "Text must not be empty or whitespace only",
    }),
    timestampSec: z.number().refine((val) => Number.isFinite(val) && val >= 0, {
      message: "Timestamp seconds must be a finite non-negative number",
    }),
    speakerName: z.string().max(100).nullable().optional(),
  })
  .strict();

export interface TranscriptRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  classroom: Pick<ClassroomService, "ingestTranscriptChunk">;
}

export function createTranscriptRouter(dependencies: TranscriptRouterDependencies): Router {
  const router = express.Router();

  router.post(
    "/api/lectures/:lectureId/transcript",
    requireAuth(dependencies.auth),
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

        const rawLectureId = req.params["lectureId"];
        const lectureIdParam = typeof rawLectureId === "string" ? rawLectureId : "";
        if (!uuidSchema.safeParse(lectureIdParam).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid lecture ID format in request URL",
          });
        }

        const parsedBody = transcriptIngestRequestSchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid transcript request payload",
            cause: parsedBody.error,
          });
        }

        const speaker =
          parsedBody.data.speakerName === null || parsedBody.data.speakerName === undefined
            ? undefined
            : parsedBody.data.speakerName;

        const result = await dependencies.classroom.ingestTranscriptChunk(
          actor,
          lectureIdParam,
          parsedBody.data.text,
          parsedBody.data.timestampSec,
          speaker,
        );

        const responsePayload = transcriptIngestResponseSchema.parse({
          chunkId: result.id,
          detectedConceptIds: result.detectedConceptIds,
        });

        res.status(201).json(responsePayload);
      } catch (err: unknown) {
        next(err);
      }
    },
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
    },
  );

  return router;
}
