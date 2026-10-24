import type { Request, Response, NextFunction, RequestHandler } from "express";
import { AppError } from "../../../contracts/errors";
import type { ActorContext } from "../../../contracts/common";
import type { AuthGateway } from "../auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: ActorContext;
    }
  }
}

export function requireAuth(
  gateway: Pick<AuthGateway, "verifyToken">,
): RequestHandler {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // Invariant: delete any prior actor context on request before verification
    delete req.actor;

    let authHeaderCount = 0;
    if (Array.isArray(req.rawHeaders)) {
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i]?.toLowerCase() === "authorization") {
          authHeaderCount++;
        }
      }
    }

    if (authHeaderCount === 0) {
      return next(
        new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Missing Authorization header",
        }),
      );
    }

    if (authHeaderCount > 1) {
      return next(
        new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Duplicate Authorization headers detected",
        }),
      );
    }

    const rawAuth = req.headers["authorization"];
    if (Array.isArray(rawAuth)) {
      return next(
        new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Duplicate Authorization headers detected",
        }),
      );
    }

    if (typeof rawAuth !== "string" || !rawAuth.trim()) {
      return next(
        new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Empty or invalid Authorization header",
        }),
      );
    }

    if (rawAuth.includes(",")) {
      return next(
        new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Multiple Authorization header values detected",
        }),
      );
    }

    const trimmed = rawAuth.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
      return next(
        new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message:
            "Authorization header must use Bearer scheme with a single token",
        }),
      );
    }

    const token = parts[1];
    if (!token || /\s/.test(token)) {
      return next(
        new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Malformed Bearer token",
        }),
      );
    }

    try {
      const actor = await gateway.verifyToken(token);
      req.actor = actor;
      next();
    } catch (err) {
      next(err);
    }
  };
}
