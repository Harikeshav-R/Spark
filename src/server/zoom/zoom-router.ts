import { randomBytes } from "node:crypto";
import express, {
  type Request,
  type Response,
  type NextFunction,
  type Router,
} from "express";
import { z } from "zod";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import {
  type AuthGateway,
  requireAuth,
  apiErrorHandler,
} from "../platform/index.js";
import type { ZoomOAuth } from "./zoom-oauth.js";

const putCredentialsBodySchema = z
  .object({
    zoomClientId: z.string().trim().min(1),
    zoomClientSecret: z.string().trim().min(1),
  })
  .strict();

function getCookie(req: Request, name: string): string | undefined {
  if (req.cookies && typeof req.cookies[name] === "string") {
    return req.cookies[name];
  }
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

export interface ZoomRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  oauth: ZoomOAuth;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export function createZoomRouter(dependencies: ZoomRouterDependencies): Router {
  const router = express.Router();
  const authMiddleware = requireAuth(dependencies.auth);

  // 1. GET /api/teachers/:teacherId/zoom-credentials
  router.get(
    "/api/teachers/:teacherId/zoom-credentials",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        res.setHeader("Cache-Control", "no-store");
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const rawTeacherId = req.params["teacherId"];
        const teacherId = typeof rawTeacherId === "string" ? rawTeacherId : "";
        if (!uuidSchema.safeParse(teacherId).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid teacher ID format in request URL",
          });
        }

        const status = await dependencies.oauth.getCredentialStatus(actor, teacherId);
        res.status(200).json(status);
      } catch (err) {
        next(err);
      }
    }
  );

  // 2. PUT /api/teachers/:teacherId/zoom-credentials
  router.put(
    "/api/teachers/:teacherId/zoom-credentials",
    authMiddleware,
    express.json(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        res.setHeader("Cache-Control", "no-store");
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const rawTeacherId = req.params["teacherId"];
        const teacherId = typeof rawTeacherId === "string" ? rawTeacherId : "";
        if (!uuidSchema.safeParse(teacherId).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid teacher ID format in request URL",
          });
        }

        const parsedBody = putCredentialsBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid client credentials payload",
            cause: parsedBody.error,
          });
        }

        await dependencies.oauth.setClientCredentials(actor, teacherId, parsedBody.data);
        res.status(200).json({ success: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 3. POST /api/teachers/:teacherId/zoom/oauth/start
  router.post(
    "/api/teachers/:teacherId/zoom/oauth/start",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        res.setHeader("Cache-Control", "no-store");
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const rawTeacherId = req.params["teacherId"];
        const teacherId = typeof rawTeacherId === "string" ? rawTeacherId : "";
        if (!uuidSchema.safeParse(teacherId).success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid teacher ID format in request URL",
          });
        }

        const browserNonce = randomBytes(32).toString("base64url");
        const { authorizationUrl } = await dependencies.oauth.beginAuthorization(
          actor,
          teacherId,
          browserNonce
        );

        let isSecure = false;
        if (dependencies.env.APP_ORIGIN) {
          try {
            isSecure = new URL(dependencies.env.APP_ORIGIN).protocol === "https:";
          } catch {
            isSecure = req.secure;
          }
        } else {
          isSecure = req.secure;
        }

        res.cookie("spark_zoom_oauth", browserNonce, {
          httpOnly: true,
          sameSite: "lax",
          path: "/api/zoom/oauth/callback",
          maxAge: 600_000,
          secure: isSecure,
        });

        res.status(200).json({ authorizationUrl });
      } catch (err) {
        next(err);
      }
    }
  );

  // 4. GET /api/zoom/oauth/callback
  router.get(
    "/api/zoom/oauth/callback",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        res.setHeader("Cache-Control", "no-store");
        const rawState = req.query["state"];
        const rawCode = req.query["code"];
        const rawError = req.query["error"];

        if (typeof rawState !== "string" || rawState.trim().length === 0) {
          throw new AppError({
            code: "BAD_REQUEST",
            statusCode: 400,
            message: "Missing or invalid state parameter",
          });
        }

        const browserNonce = getCookie(req, "spark_zoom_oauth");
        if (!browserNonce) {
          throw new AppError({
            code: "BAD_REQUEST",
            statusCode: 400,
            message: "Missing OAuth nonce cookie",
          });
        }

        const code = typeof rawCode === "string" && rawCode.trim().length > 0 ? rawCode : undefined;
        const error = typeof rawError === "string" && rawError.trim().length > 0 ? rawError : undefined;

        try {
          await dependencies.oauth.completeAuthorization({
            state: rawState,
            browserNonce,
            code,
            error,
          });

          res.clearCookie("spark_zoom_oauth", { path: "/api/zoom/oauth/callback" });

          const baseOrigin = dependencies.env.APP_ORIGIN || "http://localhost:3000";
          const redirectTarget = `${baseOrigin.replace(/\/+$/, "")}/professor/dashboard?zoom=connected`;
          res.redirect(303, redirectTarget);
        } catch (authErr) {
          res.clearCookie("spark_zoom_oauth", { path: "/api/zoom/oauth/callback" });
          throw authErr;
        }
      } catch (err) {
        next(err);
      }
    }
  );

  // Error boundary
  router.use(
    (err: unknown, req: Request, res: Response, next: NextFunction): void => {
      if (
        err instanceof SyntaxError &&
        "status" in err &&
        err.status === 400 &&
        "body" in err
      ) {
        const validationErr = new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Malformed JSON payload",
          cause: err,
        });
        apiErrorHandler(validationErr, req, res, next);
        return;
      }
      apiErrorHandler(err, req, res, next);
    }
  );

  return router;
}
