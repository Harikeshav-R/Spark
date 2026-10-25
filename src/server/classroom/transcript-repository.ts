import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TranscriptChunk } from "../../contracts/classroom.js";
import { transcriptChunkSchema } from "../../contracts/classroom.js";
import type { UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
export interface LectureTranscriptChunk {
  text: string;
  timestampSec: number;
}

const candidateConceptRowSchema = z.object({
  id: uuidSchema,
  label: z.string().min(1),
});

const transcriptChunkRowSchema = z.object({
  id: uuidSchema,
  lecture_id: uuidSchema,
  text: z.string().min(1),
  timestamp_sec: z.union([z.number(), z.string()]).transform((val) => Number(val)),
  speaker_name: z.string().nullable().optional(),
  is_simulated: z.boolean().nullable().optional(),
  created_at: z.string().min(1),
});

export interface TranscriptSelectQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: string): this;
  gte(column: string, value: number): this;
  lte(column: string, value: number): this;
  order(column: string, options: { ascending: boolean }): this;
  range(from: number, to: number): this;
}

export interface TranscriptDatabaseClientPort {
  from(table: string): {
    select(columns?: string): TranscriptSelectQuery;
    insert(values: unknown): {
      select(columns?: string): {
        single(): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
}

const recentTranscriptRowSchema = z.object({
  id: uuidSchema,
  text: z.string().min(1),
  timestamp_sec: z
    .union([z.number(), z.string()])
    .transform((val) => Number(val))
    .refine((val) => Number.isFinite(val) && val >= 0, {
      message: "timestamp_sec must be a finite non-negative number",
    }),
});

export class TranscriptRepository {
  private readonly client: TranscriptDatabaseClientPort;
  constructor(
    client: SupabaseClient | Pick<SupabaseClient, "from"> | TranscriptDatabaseClientPort,
  ) {
    this.client = client as unknown as TranscriptDatabaseClientPort;
  }
  async getCandidateConcepts(courseId: UUID): Promise<{ id: UUID; label: string }[]> {
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
        .from("concept_nodes")
        .select("id, label")
        .eq("course_id", courseId);
    } catch (err: unknown) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Database service unavailable while fetching candidate concepts",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error querying candidate concepts",
        cause: result.error,
      });
    }

    if (!result.data || !Array.isArray(result.data)) {
      return [];
    }

    try {
      return result.data.map((row) => {
        const parsed = candidateConceptRowSchema.parse(row);
        return { id: parsed.id, label: parsed.label };
      });
    } catch (err: unknown) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed concept node row",
        cause: err,
      });
    }
  }

  async insertChunk(chunk: TranscriptChunk): Promise<TranscriptChunk> {
    const validated = transcriptChunkSchema.safeParse(chunk);
    if (!validated.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid transcript chunk payload",
        cause: validated.error,
      });
    }

    let insertResult: { data: unknown; error: unknown };
    try {
      insertResult = await this.client
        .from("transcript_chunks")
        .insert({
          id: validated.data.id,
          lecture_id: validated.data.lectureId,
          text: validated.data.text,
          timestamp_sec: validated.data.timestampSec,
          speaker_name: validated.data.speakerName ?? null,
          is_simulated: validated.data.isSimulated ?? null,
          created_at: validated.data.createdAt,
        })
        .select("id, lecture_id, text, timestamp_sec, speaker_name, is_simulated, created_at")
        .single();
    } catch (err: unknown) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Database service unavailable while inserting transcript chunk",
        cause: err,
      });
    }

    if (insertResult.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error inserting transcript chunk",
        cause: insertResult.error,
      });
    }

    if (!insertResult.data) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned no data after transcript chunk insert",
      });
    }

    let parsedRow: z.infer<typeof transcriptChunkRowSchema>;
    try {
      parsedRow = transcriptChunkRowSchema.parse(insertResult.data);
    } catch (err: unknown) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed transcript chunk row",
        cause: err,
      });
    }

    const stored: TranscriptChunk = {
      id: parsedRow.id,
      lectureId: parsedRow.lecture_id,
      text: parsedRow.text,
      timestampSec: parsedRow.timestamp_sec,
      detectedConceptIds: [],
      createdAt: new Date(parsedRow.created_at).toISOString(),
    };
    if (parsedRow.speaker_name !== null && parsedRow.speaker_name !== undefined) {
      stored.speakerName = parsedRow.speaker_name;
    }
    if (parsedRow.is_simulated !== null && parsedRow.is_simulated !== undefined) {
      stored.isSimulated = parsedRow.is_simulated;
    }

    return transcriptChunkSchema.parse(stored);
  }

  async insertConceptLinks(chunkId: UUID, conceptIds: UUID[]): Promise<void> {
    if (!uuidSchema.safeParse(chunkId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid chunk ID format for concept links",
      });
    }

    const validIds = z.array(uuidSchema).safeParse(conceptIds);
    if (!validIds.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid concept IDs array for concept links",
        cause: validIds.error,
      });
    }

    if (conceptIds.length === 0) {
      return;
    }

    const rows = conceptIds.map((conceptId) => ({
      transcript_chunk_id: chunkId,
      concept_id: conceptId,
    }));

    let result: { error?: unknown } | undefined;
    try {
      const insertOp: unknown = this.client.from("transcript_concepts").insert(rows);
      if (
        insertOp !== null &&
        typeof insertOp === "object" &&
        "then" in insertOp &&
        typeof (insertOp as PromiseLike<unknown>).then === "function"
      ) {
        result = (await insertOp) as { error?: unknown };
      } else {
        result = insertOp as { error?: unknown };
      }
    } catch (err: unknown) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Database service unavailable while inserting concept links",
        cause: err,
      });
    }

    if (result && result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error inserting concept links",
        cause: result.error,
      });
    }
  }

  async getRecentTranscriptText(lectureId: UUID, timestampSec: number): Promise<string> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    if (typeof timestampSec !== "number" || !Number.isFinite(timestampSec) || timestampSec < 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Timestamp seconds must be a finite non-negative number",
      });
    }

    const minTimestamp = Math.max(0, timestampSec - 90);
    const maxTimestamp = timestampSec;
    const PAGE_SIZE = 500;
    let offset = 0;
    const allTexts: string[] = [];

    while (true) {
      let result: { data: unknown; error: unknown };
      try {
        result = await this.client
          .from("transcript_chunks")
          .select("id, text, timestamp_sec")
          .eq("lecture_id", lectureId)
          .gte("timestamp_sec", minTimestamp)
          .lte("timestamp_sec", maxTimestamp)
          .order("timestamp_sec", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
      } catch (err: unknown) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Database service unavailable while fetching recent transcript window",
          cause: err,
        });
      }

      if (result.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error querying recent transcript window",
          cause: result.error,
        });
      }

      if (!Array.isArray(result.data)) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned non-array for transcript chunks window",
        });
      }

      for (const rawRow of result.data) {
        const parsed = recentTranscriptRowSchema.safeParse(rawRow);
        if (!parsed.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database returned malformed transcript chunk row in window",
            cause: parsed.error,
          });
        }
        allTexts.push(parsed.data.text);
      }

      if (result.data.length < PAGE_SIZE) {
        break;
      }
      offset += PAGE_SIZE;
    }

    return allTexts.join("\n");
  }

  async getLectureTranscript(
    lectureId: UUID
  ): Promise<{ text: string; timestampSec: number }[]> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    const PAGE_SIZE = 500;
    let offset = 0;
    const allChunks: { text: string; timestampSec: number }[] = [];

    while (true) {
      let result: { data: unknown; error: unknown };
      try {
        result = await this.client
          .from("transcript_chunks")
          .select("id, text, timestamp_sec")
          .eq("lecture_id", lectureId)
          .order("timestamp_sec", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
      } catch (err: unknown) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Database service unavailable while fetching lecture transcript",
          cause: err,
        });
      }

      if (result.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error querying lecture transcript",
          cause: result.error,
        });
      }

      if (!Array.isArray(result.data)) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned non-array for lecture transcript chunks",
        });
      }

      for (const rawRow of result.data) {
        const parsed = recentTranscriptRowSchema.safeParse(rawRow);
        if (!parsed.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database returned malformed transcript chunk row",
            cause: parsed.error,
          });
        }
        allChunks.push({
          text: parsed.data.text,
          timestampSec: parsed.data.timestamp_sec,
        });
      }

      if (result.data.length < PAGE_SIZE) {
        break;
      }
      offset += PAGE_SIZE;
    }

    return allChunks;
  }
}
