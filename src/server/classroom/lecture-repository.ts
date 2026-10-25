import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  LectureSession,
  LectureStatus,
} from "../../contracts/classroom.js";
import {
  lectureSessionSchema,
  lectureStatusSchema,
} from "../../contracts/classroom.js";
import type { ISOTimestamp, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";

const lectureRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
  title: z.string().min(1),
  status: lectureStatusSchema,
  started_at: z.string().min(1),
  ended_at: z.string().nullable().optional(),
});

function mapLectureRow(row: z.infer<typeof lectureRowSchema>): LectureSession {
  const lecture: LectureSession = {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    status: row.status,
    startedAt: new Date(row.started_at).toISOString(),
  };
  if (row.ended_at) {
    lecture.endedAt = new Date(row.ended_at).toISOString();
  }
  return lectureSessionSchema.parse(lecture);
}

interface SelectBuilder {
  eq(column: string, value: string): FilterBuilder;
  single(): Promise<{ data: unknown; error: unknown }>;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
}

interface FilterBuilder extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: string): FilterBuilder;
  order(column: string, options?: { ascending?: boolean }): FilterBuilder;
  single(): Promise<{ data: unknown; error: unknown }>;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
}

interface InsertBuilder {
  select(columns?: string): {
    single(): Promise<{ data: unknown; error: unknown }>;
  };
}

interface UpdateFilterBuilder {
  eq(column: string, value: string): UpdateFilterBuilder;
  select(columns?: string): {
    single(): Promise<{ data: unknown; error: unknown }>;
    maybeSingle(): Promise<{ data: unknown; error: unknown }>;
  };
}

interface UpdateBuilder {
  eq(column: string, value: string): UpdateFilterBuilder;
  select(columns?: string): {
    single(): Promise<{ data: unknown; error: unknown }>;
    maybeSingle(): Promise<{ data: unknown; error: unknown }>;
  };
}

export interface LectureDatabaseClientPort {
  from(table: string): {
    select(columns?: string): SelectBuilder;
    insert(values: unknown): InsertBuilder;
    update(values: unknown): UpdateBuilder;
  };
}

export class LectureRepository {
  private readonly client: LectureDatabaseClientPort;

  constructor(
    client: SupabaseClient | Pick<SupabaseClient, "from"> | LectureDatabaseClientPort,
  ) {
    this.client = client as unknown as LectureDatabaseClientPort;
  }

  async insertLecture(lecture: LectureSession): Promise<LectureSession> {
    const validated = lectureSessionSchema.parse(lecture);

    let insertResult;
    try {
      insertResult = await this.client
        .from("lecture_sessions")
        .insert({
          id: validated.id,
          course_id: validated.courseId,
          title: validated.title,
          status: validated.status,
          started_at: validated.startedAt,
        })
        .select("id, course_id, title, status, started_at, ended_at")
        .single();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to insert lecture session",
        cause: err,
      });
    }

    if (insertResult.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error inserting lecture session",
        cause: insertResult.error,
      });
    }

    let parsedRow: z.infer<typeof lectureRowSchema>;
    try {
      parsedRow = lectureRowSchema.parse(insertResult.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed lecture row",
        cause: err,
      });
    }

    return mapLectureRow(parsedRow);
  }

  async getLecture(lectureId: UUID): Promise<LectureSession> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    let result;
    try {
      result = await this.client
        .from("lecture_sessions")
        .select("id, course_id, title, status, started_at, ended_at")
        .eq("id", lectureId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to retrieve lecture session",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error retrieving lecture session",
        cause: result.error,
      });
    }

    if (!result.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Lecture session not found",
      });
    }

    let parsedRow: z.infer<typeof lectureRowSchema>;
    try {
      parsedRow = lectureRowSchema.parse(result.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed lecture row",
        cause: err,
      });
    }

    return mapLectureRow(parsedRow);
  }

  async updateLectureStatus(
    lectureId: UUID,
    status: LectureStatus,
    endedAt?: ISOTimestamp,
  ): Promise<LectureSession> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    if (!lectureStatusSchema.safeParse(status).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture status",
      });
    }

    let result;
    try {
      result = await this.client
        .from("lecture_sessions")
        .update({
          status,
          ended_at: endedAt ?? null,
        })
        .eq("id", lectureId)
        .select("id, course_id, title, status, started_at, ended_at")
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to update lecture session",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error updating lecture session",
        cause: result.error,
      });
    }

    if (!result.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Lecture session not found",
      });
    }

    let parsedRow: z.infer<typeof lectureRowSchema>;
    try {
      parsedRow = lectureRowSchema.parse(result.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed lecture row",
        cause: err,
      });
    }

    return mapLectureRow(parsedRow);
  }

  async listLectures(courseId: UUID): Promise<LectureSession[]> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    let result: { data: unknown; error: unknown };
    try {
      result = await this.client
        .from("lecture_sessions")
        .select("id, course_id, title, status, started_at, ended_at")
        .eq("course_id", courseId)
        .order("started_at", { ascending: false })
        .order("id", { ascending: true });
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to list lecture sessions",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error listing lecture sessions",
        cause: result.error,
      });
    }

    if (!Array.isArray(result.data)) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned non-array for lecture sessions",
      });
    }

    return result.data.map((raw) => {
      let parsedRow: z.infer<typeof lectureRowSchema>;
      try {
        parsedRow = lectureRowSchema.parse(raw);
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned malformed lecture row",
          cause: err,
        });
      }
      return mapLectureRow(parsedRow);
    });
  }
}
