import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Student } from "../../../contracts/course";
import { studentSchema } from "../../../contracts/course";
import type { ActorContext } from "../../../contracts/common";
import { uuidSchema } from "../../../contracts/common";
import { AppError } from "../../../contracts/errors";

const studentRowSchema = z.object({
  id: uuidSchema,
  auth_id: uuidSchema,
  course_id: uuidSchema,
  name: z.string().min(1),
  email: z.email(),
  created_at: z.string().min(1),
});

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export class EnrollmentRepository {
  constructor(private readonly client: Pick<SupabaseClient, "rpc">) {}

  async enrollStudent(actor: ActorContext, joinCode: string): Promise<Student> {
    let result: { data: unknown; error: unknown };
    try {
      result = await this.client.rpc("enroll_student", {
        p_auth_id: actor.authId,
        p_join_code: joinCode,
        p_name: actor.name,
        p_email: actor.email,
      });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to connect to database",
        cause: err,
      });
    }

    if (result.error) {
      const err = result.error as PostgrestErrorLike;
      const code = err.code ?? "";

      if (code === "P0002") {
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Course not found for join code",
          cause: err,
        });
      }

      if (code === "22023" || code === "22P02") {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: err.message || "Invalid input parameters",
          cause: err,
        });
      }

      if (code === "42501") {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Permission denied",
          cause: err,
        });
      }

      if (code === "PGRST000" || code === "PGRST001" || code === "PGRST002") {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Database service unavailable",
          cause: err,
        });
      }

      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: err.message || "Failed to enroll student",
        cause: err,
      });
    }

    const rows = Array.isArray(result.data) ? result.data : [result.data];
    if (rows.length !== 1 || !rows[0]) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database did not return exactly one student record",
      });
    }

    const parsed = studentRowSchema.safeParse(rows[0]);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid student record",
        cause: parsed.error,
      });
    }

    return studentSchema.parse({
      id: parsed.data.id,
      authId: parsed.data.auth_id,
      courseId: parsed.data.course_id,
      name: parsed.data.name,
      email: parsed.data.email,
      createdAt: new Date(parsed.data.created_at).toISOString(),
    });
  }
}
