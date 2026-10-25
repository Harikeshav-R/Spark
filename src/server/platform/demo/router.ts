import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { AppError, DomainErrorCode } from "../../../contracts/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import type { AuthGateway } from "../auth.js";
import type { DemoController } from "./controller.js";
import type { DemoConfig } from "./config.js";

export interface DemoRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  controller: DemoController;
  config: DemoConfig;
}

const speechInputSchema = z
  .object({
    lectureId: z.string().uuid(),
    action: z.enum(["play", "pause", "step", "speed"]),
    speed: z.union([z.literal(1), z.literal(2), z.literal(5)]).optional(),
  })
  .strict();

const pollResponsesInputSchema = z
  .object({
    pollId: z.string().uuid(),
  })
  .strict();

const emptyObjectSchema = z.object({}).strict();

function isLoopbackAddress(addr?: string): boolean {
  if (!addr) return false;
  const normalized = addr.replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function isLoopbackHost(hostHeader?: string): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0]?.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function createDemoRouter(deps: DemoRouterDependencies): Router {
  const router = Router();

  // Security guard middleware: loopback enforcement and cache control
  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "private, no-store");

    const remoteAddr = req.socket.remoteAddress;
    if (!isLoopbackAddress(remoteAddr)) {
      return next(
        new AppError({
          code: DomainErrorCode.FORBIDDEN,
          statusCode: 403,
          message: "Demo endpoints are restricted to local loopback connections",
        }),
      );
    }

    if (!isLoopbackHost(req.headers.host)) {
      return next(
        new AppError({
          code: DomainErrorCode.FORBIDDEN,
          statusCode: 403,
          message: "Demo endpoints require loopback Host header",
        }),
      );
    }

    const origin = req.headers.origin;
    if (origin && origin.toLowerCase() !== deps.config.origin.toLowerCase()) {
      return next(
        new AppError({
          code: DomainErrorCode.FORBIDDEN,
          statusCode: 403,
          message: `Cross-site origin rejected for demo endpoints: ${origin}`,
        }),
      );
    }

    next();
  });

  const authMiddleware = requireAuth(deps.auth);

  // 1. GET /api/demo/state
  router.get("/api/demo/state", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new AppError({
          code: DomainErrorCode.UNAUTHORIZED,
          statusCode: 401,
          message: "Authentication required",
        });
      }

      const state = await deps.controller.getState(actor);
      res.json(state);
    } catch (err) {
      next(err);
    }
  });

  // 2. POST /api/demo/speech
  router.post("/api/demo/speech", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new AppError({
          code: DomainErrorCode.UNAUTHORIZED,
          statusCode: 401,
          message: "Authentication required",
        });
      }

      const parsed = speechInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid speech control payload",
          cause: parsed.error,
        });
      }

      if (parsed.data.action === "speed" && parsed.data.speed === undefined) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Speed parameter is required for speed action",
        });
      }

      const result = await deps.controller.controlSpeech(actor, parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // 3. POST /api/demo/poll-responses
  router.post(
    "/api/demo/poll-responses",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: DomainErrorCode.UNAUTHORIZED,
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const parsed = pollResponsesInputSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError({
            code: DomainErrorCode.VALIDATION_ERROR,
            statusCode: 400,
            message: "Invalid poll-responses payload",
            cause: parsed.error,
          });
        }

        const result = await deps.controller.submitPollResponses(actor, parsed.data.pollId);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // 4. POST /api/demo/instant-match
  router.post(
    "/api/demo/instant-match",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: DomainErrorCode.UNAUTHORIZED,
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const parsed = emptyObjectSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError({
            code: DomainErrorCode.VALIDATION_ERROR,
            statusCode: 400,
            message: "Instant-match takes no body parameters",
            cause: parsed.error,
          });
        }

        const result = await deps.controller.instantMatch(actor);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // 5. POST /api/demo/reset
  router.post("/api/demo/reset", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new AppError({
          code: DomainErrorCode.UNAUTHORIZED,
          statusCode: 401,
          message: "Authentication required",
        });
      }

      const parsed = emptyObjectSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Reset takes no body parameters",
          cause: parsed.error,
        });
      }

      const result = await deps.controller.reset(actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
