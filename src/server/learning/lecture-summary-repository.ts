import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  lectureTimelineHighlightSchema,
  summarizedLectureSchema,
} from "../../contracts/ai.js";
import type { UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";

export const lectureSummaryRecordSchema = summarizedLectureSchema.extend({
  lectureId: uuidSchema,
  generatedAt: z.string().min(1),
});
export type LectureSummaryRecord = z.infer<typeof lectureSummaryRecordSchema>;

const lectureSummaryRowSchema = z.object({
  lecture_id: uuidSchema,
  summary: z.string().min(100).max(3000),
  key_concepts_covered: z.array(uuidSchema),
  timeline_highlights: z.array(lectureTimelineHighlightSchema),
  generated_at: z
    .union([z.string(), z.date()])
    .transform((val) =>
      val instanceof Date ? val.toISOString() : new Date(val).toISOString()
    )
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid generated_at timestamp",
    }),
});

interface QueryResult<T = unknown> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

export interface LectureSummaryDatabaseClientPort {
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<QueryResult>;
      };
    };
    insert(row: unknown): {
      select(columns?: string): {
        single(): Promise<QueryResult>;
      };
    };
  };
}

export class LectureSummaryRepository {
  private readonly client: LectureSummaryDatabaseClientPort;

  constructor(
    client:
      | Pick<SupabaseClient, "from">
      | LectureSummaryDatabaseClientPort
  ) {
    this.client = client as unknown as LectureSummaryDatabaseClientPort;
  }

  async get(lectureId: UUID): Promise<LectureSummaryRecord | null> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    let result: QueryResult;
    try {
      result = await this.client
        .from("lecture_summaries")
        .select(
          "lecture_id, summary, key_concepts_covered, timeline_highlights, generated_at"
        )
        .eq("lecture_id", lectureId)
        .maybeSingle();
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Summary database service unavailable",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing lecture summary",
        cause: result.error,
      });
    }

    if (!result.data) {
      return null;
    }

    const parsed = lectureSummaryRowSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed lecture summary",
        cause: parsed.error,
      });
    }

    return {
      lectureId: parsed.data.lecture_id,
      summary: parsed.data.summary,
      keyConceptsCovered: parsed.data.key_concepts_covered,
      timelineHighlights: parsed.data.timeline_highlights,
      generatedAt: parsed.data.generated_at,
    };
  }

  async insert(
    record: LectureSummaryRecord
  ): Promise<{ record: LectureSummaryRecord; inserted: boolean }> {
    const validated = lectureSummaryRecordSchema.safeParse(record);
    if (!validated.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid lecture summary record",
        cause: validated.error,
      });
    }

    const row = {
      lecture_id: record.lectureId,
      summary: record.summary,
      key_concepts_covered: record.keyConceptsCovered,
      timeline_highlights: record.timelineHighlights,
      generated_at: record.generatedAt,
    };

    let result: QueryResult;
    try {
      result = await this.client
        .from("lecture_summaries")
        .insert(row)
        .select(
          "lecture_id, summary, key_concepts_covered, timeline_highlights, generated_at"
        )
        .single();
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Summary database service unavailable",
        cause: err,
      });
    }

    if (result.error) {
      if (result.error.code === "23505") {
        const existing = await this.get(record.lectureId);
        if (!existing) {
          throw new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: "Duplicate lecture summary was not found",
          });
        }
        return { record: existing, inserted: false };
      }

      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing lecture summary",
        cause: result.error,
      });
    }

    const parsed = lectureSummaryRowSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed lecture summary",
        cause: parsed.error,
      });
    }

    return {
      record: {
        lectureId: parsed.data.lecture_id,
        summary: parsed.data.summary,
        keyConceptsCovered: parsed.data.key_concepts_covered,
        timelineHighlights: parsed.data.timeline_highlights,
        generatedAt: parsed.data.generated_at,
      },
      inserted: true,
    };
  }
}
