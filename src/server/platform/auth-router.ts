import { Router, type Request, type Response, type NextFunction } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AuthGateway } from "./auth";
import { requireAuth } from "./middleware/require-auth";
import { AppError } from "../../contracts/errors";
import type { CourseService } from "../core/courses/course-service";

const loginInputSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1),
  })
  .strict();

const refreshInputSchema = z.object({}).strict();

export interface AuthRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  courses: Pick<CourseService, "listCourses">;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  sessionClientFactory?: () => Pick<SupabaseClient, "auth">;
}

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function checkOrigin(
  req: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): void {
  const origin = req.headers.origin;
  const configuredOrigin = env.APP_ORIGIN;
  if (origin && configuredOrigin && origin !== configuredOrigin) {
    throw new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Origin mismatch",
    });
  }
}

function getDefaultSessionClient(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Pick<SupabaseClient, "auth"> {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Missing SUPABASE_URL or SUPABASE_ANON_KEY configuration",
    });
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createAuthRouter(dependencies: AuthRouterDependencies): Router {
  const router = Router();
  const env = dependencies.env ?? process.env;

  const getSessionAuthClient = () => {
    return dependencies.sessionClientFactory
      ? dependencies.sessionClientFactory()
      : getDefaultSessionClient(env);
  };

  // POST /api/auth/login
  router.post(
    "/api/auth/login",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        checkOrigin(req, env);

        const parsed = loginInputSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid login credentials format",
            cause: parsed.error,
          });
        }

        const client = getSessionAuthClient();
        const { data, error } = await client.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });

        if (error || !data.session) {
          const status =
            error && typeof error === "object" && "status" in error && typeof error.status === "number"
              ? error.status
              : 401;
          if (status >= 500) {
            throw new AppError({
              code: "SERVICE_UNAVAILABLE",
              statusCode: 503,
              message: "Authentication service unavailable",
              cause: error,
            });
          }
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: error?.message || "Invalid email or password",
          });
        }

        const actor = await dependencies.auth.verifyToken(data.session.access_token);
        const expiresAt =
          typeof data.session.expires_at === "number"
            ? data.session.expires_at
            : Math.floor(Date.now() / 1000) + (data.session.expires_in ?? 3600);

        res.cookie("spark_refresh", data.session.refresh_token, {
          httpOnly: true,
          sameSite: "strict",
          secure: env.NODE_ENV === "production",
          path: "/api/auth",
        });

        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).json({
          user: {
            id: actor.userId,
            email: actor.email,
            name: actor.name,
            role: actor.role,
          },
          session: {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt,
          },
        });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/auth/refresh
  router.post(
    "/api/auth/refresh",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        checkOrigin(req, env);

        const parsed = refreshInputSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Refresh request body must be empty object",
            cause: parsed.error,
          });
        }

        const refreshToken = parseCookie(req.headers.cookie, "spark_refresh");
        if (!refreshToken) {
          res.clearCookie("spark_refresh", { path: "/api/auth" });
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Missing refresh token cookie",
          });
        }

        const client = getSessionAuthClient();
        const { data, error } = await client.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (error || !data.session) {
          res.clearCookie("spark_refresh", { path: "/api/auth" });
          const status =
            error && typeof error === "object" && "status" in error && typeof error.status === "number"
              ? error.status
              : 401;
          if (status >= 500) {
            throw new AppError({
              code: "SERVICE_UNAVAILABLE",
              statusCode: 503,
              message: "Authentication service unavailable",
              cause: error,
            });
          }
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Invalid or expired refresh token",
          });
        }

        await dependencies.auth.verifyToken(data.session.access_token);
        const expiresAt =
          typeof data.session.expires_at === "number"
            ? data.session.expires_at
            : Math.floor(Date.now() / 1000) + (data.session.expires_in ?? 3600);

        res.cookie("spark_refresh", data.session.refresh_token, {
          httpOnly: true,
          sameSite: "strict",
          secure: env.NODE_ENV === "production",
          path: "/api/auth",
        });

        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).json({
          session: {
            accessToken: data.session.access_token,
            expiresAt,
          },
        });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // GET /api/auth/me
  router.get(
    "/api/auth/me",
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

        const courses = await dependencies.courses.listCourses(actor).catch(() => []);
        const courseMap = new Map<string, string>();
        for (const c of courses) {
          courseMap.set(c.id, c.name);
        }

        const enrollments = actor.enrolledCourses.map((e) => ({
          studentId: e.studentId,
          courseId: e.courseId,
          courseName: courseMap.get(e.courseId) ?? "Unknown Course",
        }));

        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).json({
          id: actor.userId,
          email: actor.email,
          name: actor.name,
          role: actor.role,
          teacherId: actor.teacherId,
          enrollments,
        });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/auth/logout
  router.post(
    "/api/auth/logout",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        checkOrigin(req, env);

        const authHeader = req.headers.authorization;
        const accessToken = authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : null;
        const refreshToken = parseCookie(req.headers.cookie, "spark_refresh");

        if (accessToken) {
          try {
            await dependencies.auth.verifyToken(accessToken);
            const client = getSessionAuthClient();
            if (refreshToken) {
              await client.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
            }
            await client.auth.signOut({ scope: "local" });
          } catch {
            // Ignore signout network errors to allow local cleanup
          }
        }

        res.clearCookie("spark_refresh", { path: "/api/auth" });
        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).json({ success: true });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}
