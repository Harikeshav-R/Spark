import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ISOTimestamp, UUID } from "../../contracts/common.js";
import {
  isoTimestampSchema,
  uuidSchema,
} from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";

export type PoolEntryStatus = "waiting" | "matched" | "expired" | "cancelled";

export const poolEntryStatusSchema = z.enum([
  "waiting",
  "matched",
  "expired",
  "cancelled",
]);

export interface PoolEntry {
  id: UUID;
  studentId: UUID;
  courseId: UUID;
  conceptIds: UUID[];
  status: PoolEntryStatus;
  createdAt: ISOTimestamp;
  expiresAt: ISOTimestamp;
}

export const poolRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  course_id: uuidSchema,
  concept_ids: z.array(uuidSchema),
  status: poolEntryStatusSchema,
  created_at: z.string().min(1),
  expires_at: z.string().min(1),
});

function mapPoolRow(row: z.infer<typeof poolRowSchema>): PoolEntry {
  return {
    id: row.id,
    studentId: row.student_id,
    courseId: row.course_id,
    conceptIds: row.concept_ids,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export interface InsertPoolEntryInput {
  id?: UUID;
  studentId: UUID;
  courseId: UUID;
  conceptIds: UUID[];
  expiresAt?: ISOTimestamp;
}

export interface QueryResult<T = unknown> {
  data: T | null;
  error: unknown;
  count?: number | null;
}

export interface PoolSelectFilterBuilder {
  eq(column: string, value: string): PoolSelectFilterBuilder;
  neq(column: string, value: string): PoolSelectFilterBuilder;
  gt(column: string, value: string): PoolSelectFilterBuilder;
  lt(column: string, value: string): PoolSelectFilterBuilder;
  single(): Promise<QueryResult<unknown>>;
  maybeSingle(): Promise<QueryResult<unknown>>;
  then: Promise<QueryResult<unknown[]>>["then"];
}

export interface PoolSelectBuilder {
  eq(column: string, value: string): PoolSelectFilterBuilder;
  neq(column: string, value: string): PoolSelectFilterBuilder;
  gt(column: string, value: string): PoolSelectFilterBuilder;
  lt(column: string, value: string): PoolSelectFilterBuilder;
  single(): Promise<QueryResult<unknown>>;
  maybeSingle(): Promise<QueryResult<unknown>>;
  then: Promise<QueryResult<unknown[]>>["then"];
}

export interface PoolInsertBuilder {
  select(columns?: string): {
    single(): Promise<QueryResult<unknown>>;
    maybeSingle(): Promise<QueryResult<unknown>>;
  };
}

export interface PoolUpdateFilterBuilder {
  eq(column: string, value: string): PoolUpdateFilterBuilder;
  lt(column: string, value: string): PoolUpdateFilterBuilder;
  gt(column: string, value: string): PoolUpdateFilterBuilder;
  select(columns?: string): {
    single(): Promise<QueryResult<unknown>>;
    maybeSingle(): Promise<QueryResult<unknown>>;
    then: Promise<QueryResult<unknown[]>>["then"];
  };
  then: Promise<QueryResult<unknown>>["then"];
}

export interface PoolUpdateBuilder {
  eq(column: string, value: string): PoolUpdateFilterBuilder;
  lt(column: string, value: string): PoolUpdateFilterBuilder;
  gt(column: string, value: string): PoolUpdateFilterBuilder;
  select(columns?: string): {
    single(): Promise<QueryResult<unknown>>;
    maybeSingle(): Promise<QueryResult<unknown>>;
    then: Promise<QueryResult<unknown[]>>["then"];
  };
  then: Promise<QueryResult<unknown>>["then"];
}

export interface PoolDeleteFilterBuilder {
  eq(column: string, value: string): PoolDeleteFilterBuilder;
  lt(column: string, value: string): PoolDeleteFilterBuilder;
  then: Promise<QueryResult<unknown>>["then"];
}

export interface PoolDeleteBuilder {
  eq(column: string, value: string): PoolDeleteFilterBuilder;
  lt(column: string, value: string): PoolDeleteFilterBuilder;
  then: Promise<QueryResult<unknown>>["then"];
}

export interface PoolDatabaseClientPort {
  from(table: string): {
    select(columns?: string): PoolSelectBuilder;
    insert(values: unknown): PoolInsertBuilder;
    update(
      values: unknown,
      options?: { count?: "exact" | "planned" | "estimated" },
    ): PoolUpdateBuilder;
    delete(): PoolDeleteBuilder;
  };
}

export class PoolRepository {
  private readonly client: PoolDatabaseClientPort;

  constructor(
    client: Pick<SupabaseClient, "from"> | PoolDatabaseClientPort,
  ) {
    this.client = client as unknown as PoolDatabaseClientPort;
  }

  async insertPoolEntry(entry: InsertPoolEntryInput): Promise<PoolEntry> {
    if (!uuidSchema.safeParse(entry.studentId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid student ID format",
      });
    }

    if (!uuidSchema.safeParse(entry.courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    const conceptsParse = z.array(uuidSchema).min(1).safeParse(entry.conceptIds);
    if (!conceptsParse.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "At least one valid concept ID is required",
      });
    }

    const id = entry.id ?? crypto.randomUUID();
    const expiresAt =
      entry.expiresAt ??
      new Date(Date.now() + 5 * 60 * 1000).toISOString();

    let insertResult;
    try {
      insertResult = await this.client
        .from("study_group_pool")
        .insert({
          id,
          student_id: entry.studentId,
          course_id: entry.courseId,
          concept_ids: entry.conceptIds,
          status: "waiting",
          expires_at: expiresAt,
        })
        .select(
          "id, student_id, course_id, concept_ids, status, created_at, expires_at",
        )
        .single();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to insert study group pool entry",
        cause: err,
      });
    }

    if (insertResult.error) {
      const errObj = insertResult.error as {
        code?: string;
        message?: string;
        details?: string;
      };
      if (
        errObj.code === "23505" ||
        errObj.message?.includes("study_group_pool_student_id_course_id_key") ||
        errObj.details?.includes("study_group_pool_student_id_course_id_key") ||
        errObj.message?.includes("duplicate key")
      ) {
        throw new AppError({
          code: "CONFLICT",
          statusCode: 409,
          message:
            "Student already has an active pool entry for this course",
          cause: insertResult.error,
        });
      }

      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error inserting study group pool entry",
        cause: insertResult.error,
      });
    }

    let parsedRow: z.infer<typeof poolRowSchema>;
    try {
      parsedRow = poolRowSchema.parse(insertResult.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed pool row",
        cause: err,
      });
    }

    return mapPoolRow(parsedRow);
  }

  async getActiveEntries(
    courseId: UUID,
    now: ISOTimestamp,
  ): Promise<PoolEntry[]> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    if (!isoTimestampSchema.safeParse(now).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid timestamp format",
      });
    }

    let result;
    try {
      result = await this.client
        .from("study_group_pool")
        .select(
          "id, student_id, course_id, concept_ids, status, created_at, expires_at",
        )
        .eq("course_id", courseId)
        .eq("status", "waiting")
        .gt("expires_at", now);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to retrieve active pool entries",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error retrieving active pool entries",
        cause: result.error,
      });
    }

    const rawRows = Array.isArray(result.data) ? result.data : [];
    let parsedRows: z.infer<typeof poolRowSchema>[];
    try {
      parsedRows = z.array(poolRowSchema).parse(rawRows);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed pool rows",
        cause: err,
      });
    }

    return parsedRows.map(mapPoolRow);
  }

  async getEntryByStudent(
    studentId: UUID,
    courseId: UUID,
  ): Promise<PoolEntry | null> {
    if (!uuidSchema.safeParse(studentId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid student ID format",
      });
    }

    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    let result;
    try {
      result = await this.client
        .from("study_group_pool")
        .select(
          "id, student_id, course_id, concept_ids, status, created_at, expires_at",
        )
        .eq("student_id", studentId)
        .eq("course_id", courseId)
        .eq("status", "waiting")
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to retrieve pool entry by student",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error retrieving pool entry by student",
        cause: result.error,
      });
    }

    if (!result.data) {
      return null;
    }

    let parsedRow: z.infer<typeof poolRowSchema>;
    try {
      parsedRow = poolRowSchema.parse(result.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed pool row",
        cause: err,
      });
    }

    return mapPoolRow(parsedRow);
  }

  async updateEntryStatus(
    entryId: UUID,
    status: PoolEntryStatus,
  ): Promise<PoolEntry> {
    if (!uuidSchema.safeParse(entryId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid pool entry ID format",
      });
    }

    if (!poolEntryStatusSchema.safeParse(status).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid pool entry status",
      });
    }

    let result;
    try {
      result = await this.client
        .from("study_group_pool")
        .update({ status })
        .eq("id", entryId)
        .select(
          "id, student_id, course_id, concept_ids, status, created_at, expires_at",
        )
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to update pool entry status",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error updating pool entry status",
        cause: result.error,
      });
    }

    if (!result.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Study group pool entry not found",
      });
    }

    let parsedRow: z.infer<typeof poolRowSchema>;
    try {
      parsedRow = poolRowSchema.parse(result.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed pool row",
        cause: err,
      });
    }

    return mapPoolRow(parsedRow);
  }

  async cancelWaitingEntry(
    studentId: UUID,
    courseId: UUID,
  ): Promise<PoolEntry | null> {
    if (!uuidSchema.safeParse(studentId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid student ID format",
      });
    }

    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    let result;
    try {
      result = await this.client
        .from("study_group_pool")
        .update({ status: "cancelled" })
        .eq("student_id", studentId)
        .eq("course_id", courseId)
        .eq("status", "waiting")
        .select(
          "id, student_id, course_id, concept_ids, status, created_at, expires_at",
        )
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to cancel pool entry",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error cancelling pool entry",
        cause: result.error,
      });
    }

    if (!result.data) {
      return null;
    }

    let parsedRow: z.infer<typeof poolRowSchema>;
    try {
      parsedRow = poolRowSchema.parse(result.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed pool row",
        cause: err,
      });
    }

    return mapPoolRow(parsedRow);
  }

  async cleanupExpired(now: ISOTimestamp): Promise<number> {
    if (!isoTimestampSchema.safeParse(now).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid timestamp format",
      });
    }

    let result;
    try {
      result = await this.client
        .from("study_group_pool")
        .update({ status: "expired" })
        .eq("status", "waiting")
        .lt("expires_at", now)
        .select("id");
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to cleanup expired pool entries",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error cleaning up expired pool entries",
        cause: result.error,
      });
    }

    if (Array.isArray(result.data)) {
      return result.data.length;
    }

    if (typeof result.count === "number") {
      return result.count;
    }

    return 0;
  }
}
