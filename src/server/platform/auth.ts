import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError } from "../../contracts/errors";
import {
  type ActorContext,
  actorContextSchema,
  uuidSchema,
} from "../../contracts/common";

const teacherRowSchema = z.object({
  id: uuidSchema,
  auth_id: uuidSchema,
  name: z.string().min(1),
  email: z.email(),
});

const studentRowSchema = z.object({
  id: uuidSchema,
  auth_id: uuidSchema,
  course_id: uuidSchema,
  name: z.string().min(1),
  email: z.email(),
});

export interface AuthClientPort {
  auth: {
    getUser(token?: string): Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          user_metadata?: Record<string, unknown> | null;
        } | null;
      } | null;
      error: { message: string; status?: number; code?: string } | null;
    }>;
  };
}

export interface DatabaseClientPort {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{ data: unknown; error: unknown }>;
      } & Promise<{ data: unknown; error: unknown }>;
    };
  };
}

export interface AuthGateway {
  verifyToken(token: string): Promise<ActorContext>;
}

export function createAuthGateway(
  authClient: Pick<SupabaseClient, "auth"> | AuthClientPort,
  databaseClient: Pick<SupabaseClient, "from"> | DatabaseClientPort,
): AuthGateway {
  const auth = authClient.auth;
  const db = databaseClient as DatabaseClientPort;

  return {
    async verifyToken(token: string): Promise<ActorContext> {
      let authResponse;
      try {
        authResponse = await auth.getUser(token);
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Authentication service unavailable",
          cause: err,
        });
      }

      if (authResponse.error) {
        const status = authResponse.error.status;
        if (typeof status === "number" && status >= 500) {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Authentication service error",
            cause: authResponse.error,
          });
        }
        throw new AppError({
          code: "UNAUTHORIZED",
          statusCode: 401,
          message: "Unauthorized",
          cause: authResponse.error,
        });
      }

      const user = authResponse.data?.user;
      if (!user || !user.id || !user.email) {
        if (!user) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Unauthorized",
          });
        }
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Verified auth user is missing required profile fields",
        });
      }

      if (
        !uuidSchema.safeParse(user.id).success ||
        !z.email().safeParse(user.email).success
      ) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Verified auth user has invalid id or email format",
        });
      }

      let teacherResult;
      try {
        teacherResult = await db
          .from("teachers")
          .select("id,auth_id,name,email")
          .eq("auth_id", user.id)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to query teacher profile",
          cause: err,
        });
      }

      if (teacherResult.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error querying teacher profile",
          cause: teacherResult.error,
        });
      }

      let studentResult;
      try {
        studentResult = await db
          .from("students")
          .select("id,auth_id,course_id,name,email")
          .eq("auth_id", user.id);
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to query student enrollments",
          cause: err,
        });
      }

      if (studentResult.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error querying student enrollments",
          cause: studentResult.error,
        });
      }
      let teacherRow: z.infer<typeof teacherRowSchema> | null;
      try {
        teacherRow = teacherResult.data
          ? teacherRowSchema.parse(teacherResult.data)
          : null;
      } catch (parseErr) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Malformed teacher record in database",
          cause: parseErr,
        });
      }

      let studentRows: z.infer<typeof studentRowSchema>[];
      try {
        studentRows = z.array(studentRowSchema).parse(studentResult.data ?? []);
      } catch (parseErr) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Malformed student record in database",
          cause: parseErr,
        });
      }

      const rawMetadataName = user.user_metadata?.name;
      const metadataName =
        typeof rawMetadataName === "string" ? rawMetadataName.trim() : "";
      const studentDisplayName =
        metadataName.length > 0 ? metadataName : user.email;

      const rawActor: ActorContext = teacherRow
        ? {
            userId: user.id,
            authId: user.id,
            teacherId: teacherRow.id,
            role: "teacher",
            name: teacherRow.name,
            email: teacherRow.email,
            enrolledCourses: studentRows.map((r) => ({
              studentId: r.id,
              courseId: r.course_id,
            })),
          }
        : {
            userId: user.id,
            authId: user.id,
            role: "student",
            name: studentDisplayName,
            email: user.email,
            enrolledCourses: studentRows.map((r) => ({
              studentId: r.id,
              courseId: r.course_id,
            })),
          };

      try {
        return actorContextSchema.parse(rawActor);
      } catch (actorErr) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Constructed actor failed schema validation",
          cause: actorErr,
        });
      }
    },
  };
}
