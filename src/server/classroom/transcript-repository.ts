import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TranscriptChunk } from "../../contracts/classroom.js";
import { transcriptChunkSchema } from "../../contracts/classroom.js";
import type { UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";

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
  created_at: z.string().min(1),
});

export interface TranscriptDatabaseClientPort {
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: string): Promise<{ data: unknown; error: unknown }>;
    };
    insert(values: unknown): {
      select(columns?: string): {
        single(): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
}

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
          created_at: validated.data.createdAt,
        })
        .select("id, lecture_id, text, timestamp_sec, speaker_name, created_at")
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
}
