import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  ActorContext,
  MasteryBand,
  MasteryEvidence,
  StudentMastery,
  UUID,
} from "../../../contracts";
import {
  confidenceSchema,
  confidenceToBand,
  studentMasterySchema,
} from "../../../contracts/mastery";
import { uuidSchema } from "../../../contracts/common";
import { AppError } from "../../../contracts/errors";

const dbMasteryRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  concept_id: uuidSchema,
  confidence: confidenceSchema,
  attempts: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  last_updated: z.string().min(1),
});

const applyEvidenceResultRowSchema = z.object({
  new_confidence: confidenceSchema,
  new_attempts: z.number().int().nonnegative(),
  new_version: z.number().int().nonnegative(),
});

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export class MasteryRepository {
  constructor(private readonly client: Pick<SupabaseClient, "rpc">) {}

  private mapDatabaseError(errUnknown: unknown, defaultMessage: string): AppError {
    const err = (errUnknown ?? {}) as PostgrestErrorLike;
    const code = err.code ?? "";

    if (code === "P0002") {
      return new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: err.message || defaultMessage,
        cause: err,
      });
    }

    if (code === "42501") {
      return new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: err.message || "Permission denied",
        cause: err,
      });
    }

    if (code === "22023" || code === "22P02") {
      return new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: err.message || "Invalid input parameters",
        cause: err,
      });
    }

    if (code === "PGRST000" || code === "PGRST001" || code === "PGRST002") {
      return new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Database service unavailable",
        cause: err,
      });
    }

    return new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: err.message || defaultMessage,
      cause: err,
    });
  }

  async getMastery(actor: ActorContext, studentId: UUID): Promise<StudentMastery[]> {
    let result: { data: unknown; error: unknown };
    try {
      result = await this.client.rpc("get_student_mastery", {
        p_actor_auth_id: actor.authId,
        p_student_id: studentId,
      });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query student mastery",
        cause: err,
      });
    }

    if (result.error) {
      throw this.mapDatabaseError(result.error, "Failed to get student mastery");
    }

    if (!Array.isArray(result.data)) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned non-array for student mastery",
      });
    }

    return result.data.map((rawRow) => {
      const parsed = dbMasteryRowSchema.safeParse(rawRow);
      if (!parsed.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned invalid student mastery record",
          cause: parsed.error,
        });
      }
      return studentMasterySchema.parse({
        id: parsed.data.id,
        studentId: parsed.data.student_id,
        conceptId: parsed.data.concept_id,
        confidence: parsed.data.confidence,
        attempts: parsed.data.attempts,
        version: parsed.data.version,
        lastUpdated: new Date(parsed.data.last_updated).toISOString(),
      });
    });
  }

  async applyEvidence(
    actor: ActorContext,
    studentId: UUID,
    conceptId: UUID,
    evidence: MasteryEvidence,
  ): Promise<{ confidence: number; band: MasteryBand; attempts: number; version: number }> {
    let result: { data: unknown; error: unknown };
    try {
      result = await this.client.rpc("apply_mastery_evidence", {
        p_actor_auth_id: actor.authId,
        p_student_id: studentId,
        p_concept_id: conceptId,
        p_evidence: evidence,
      });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to apply mastery evidence",
        cause: err,
      });
    }

    if (result.error) {
      throw this.mapDatabaseError(result.error, "Failed to apply mastery evidence");
    }

    const rows = Array.isArray(result.data) ? result.data : [result.data];
    if (rows.length !== 1 || !rows[0]) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database did not return updated mastery values",
      });
    }

    const parsed = applyEvidenceResultRowSchema.safeParse(rows[0]);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid mastery mutation response",
        cause: parsed.error,
      });
    }

    const confidence = parsed.data.new_confidence;
    return {
      confidence,
      band: confidenceToBand(confidence),
      attempts: parsed.data.new_attempts,
      version: parsed.data.new_version,
    };
  }

  async initializeStudentMastery(studentId: UUID, courseId: UUID): Promise<number> {
    let result: { data: unknown; error: unknown };
    try {
      result = await this.client.rpc("initialize_student_mastery", {
        p_student_id: studentId,
        p_course_id: courseId,
      });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to initialize student mastery",
        cause: err,
      });
    }

    if (result.error) {
      throw this.mapDatabaseError(result.error, "Failed to initialize student mastery");
    }

    if (typeof result.data !== "number") {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database did not return inserted count",
      });
    }

    return result.data;
  }
}
