import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActorContext, UUID } from "../../../contracts/common.js";
import type { CourseService } from "../../../contracts/course.js";
import type {
  AiService,
  PrerequisiteGraphExtractionResult,
} from "../../../contracts/ai.js";
import { prerequisiteGraphExtractionResultSchema } from "../../../contracts/ai.js";
import { AppError, DomainErrorCode } from "../../../contracts/errors.js";
import { validateGraph } from "../graph/graph-validator.js";
import { assertSyllabusSize, hashSyllabusPdf } from "./pdf-processor.js";

export interface SyllabusGraphExtractor
  extends Pick<AiService, "extractPrerequisiteGraph"> {
  getIntegrationMode(): "fixture" | "live";
}

const cacheEnvelopeSchema = z.object({
  integrationMode: z.enum(["fixture", "live"]),
  extraction: prerequisiteGraphExtractionResultSchema,
});

export class SyllabusIngestionService {
  constructor(
    private readonly client: SupabaseClient | Pick<SupabaseClient, "from">,
    private readonly courses: Pick<CourseService, "getCourse">,
    private readonly ai: SyllabusGraphExtractor,
  ) {}

  async processSyllabusUpload(
    actor: ActorContext,
    courseId: UUID,
    pdfBytes: Buffer,
    filename?: string,
  ): Promise<PrerequisiteGraphExtractionResult> {
    const actualFilename = filename ?? "syllabus.pdf";
    if (
      typeof actualFilename !== "string" ||
      actualFilename.length < 1 ||
      actualFilename.length > 255
    ) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Syllabus filename must contain 1 to 255 characters",
      });
    }

    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Only the owning teacher can upload a syllabus",
      });
    }

    const course = await this.courses.getCourse(actor, courseId);
    if (course.teacherId !== actor.teacherId) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Only the owning teacher can upload a syllabus",
      });
    }

    assertSyllabusSize(pdfBytes);
    const hash = hashSyllabusPdf(pdfBytes);

    let cacheRow: { result: unknown } | null;
    try {
      const { data, error } = await this.client
        .from("pdf_cache")
        .select("result")
        .eq("file_hash", hash)
        .maybeSingle();

      if (error) {
        throw error;
      }
      cacheRow = data;
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to read syllabus extraction cache",
        cause: err,
      });
    }

    if (cacheRow && cacheRow.result !== null && typeof cacheRow.result === "object") {
      if ("integrationMode" in (cacheRow.result as Record<string, unknown>)) {
        const parsedEnvelope = cacheEnvelopeSchema.safeParse(cacheRow.result);
        if (!parsedEnvelope.success) {
          throw new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: "Invalid syllabus extraction cache entry",
            cause: parsedEnvelope.error,
          });
        }

        if (parsedEnvelope.data.integrationMode === this.ai.getIntegrationMode()) {
          const cached = parsedEnvelope.data.extraction;
          const { totalPages, processedPages, truncated } = cached;
          const validPages =
            totalPages > 0 &&
            processedPages === Math.min(totalPages, 10) &&
            truncated === (totalPages > 10);

          if (!validPages) {
            throw new AppError({
              code: DomainErrorCode.INTERNAL_SERVER_ERROR,
              statusCode: 500,
              message: "Invalid syllabus extraction cache entry",
            });
          }

          await validateGraph(cached.concepts, cached.edges);

          return cached;
        }
      }
    }

    const result = await this.ai.extractPrerequisiteGraph(pdfBytes);

    const { totalPages, processedPages, truncated } = result;
    const validPages =
      totalPages > 0 &&
      processedPages === Math.min(totalPages, 10) &&
      truncated === (totalPages > 10);

    if (!validPages) {
      throw new AppError({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
        message: "Invalid syllabus extraction page metadata",
      });
    }

    await validateGraph(result.concepts, result.edges);

    try {
      const { error: upsertError } = await this.client
        .from("pdf_cache")
        .upsert(
          {
            file_hash: hash,
            filename: actualFilename,
            result: {
              integrationMode: this.ai.getIntegrationMode(),
              extraction: result,
            },
          },
          { onConflict: "file_hash", ignoreDuplicates: false },
        );

      if (upsertError) {
        throw upsertError;
      }
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to write syllabus extraction cache",
        cause: err,
      });
    }

    return result;
  }
}
