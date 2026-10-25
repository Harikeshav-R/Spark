import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { uuidSchema, type UUID } from "../../contracts/common.js";
import {
  conceptLearningPageSchema,
  type ConceptLearningPage,
} from "../../contracts/learning.js";
import { generatedLearningPageSchema } from "../../contracts/ai.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";
const learningPageRowSchema = z.object({
  id: uuidSchema,
  concept_id: uuidSchema,
  content: z.string(),
  created_at: z
    .union([z.string(), z.date()])
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid created_at timestamp",
    })
    .transform((val) =>
      val instanceof Date ? val.toISOString() : new Date(val).toISOString()
    ),
});
export interface QueryResult<T = unknown> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

export interface LearningPageDatabaseClientPort {
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

export interface LearningPageRepositoryPort {
  get(conceptId: UUID): Promise<ConceptLearningPage | null>;
  insert(conceptId: UUID, content: string): Promise<ConceptLearningPage>;
}

export class LearningPageRepository implements LearningPageRepositoryPort {
  private readonly client: LearningPageDatabaseClientPort;

  constructor(
    client:
      | Pick<SupabaseClient, "from">
      | LearningPageDatabaseClientPort
  ) {
    this.client = client as unknown as LearningPageDatabaseClientPort;
  }

  async get(conceptId: UUID): Promise<ConceptLearningPage | null> {
    const parsedId = uuidSchema.safeParse(conceptId);
    if (!parsedId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid learning page record",
        cause: parsedId.error,
      });
    }

    let result: QueryResult;
    try {
      result = await this.client
        .from("concept_learning_pages")
        .select("id, concept_id, content, created_at")
        .eq("concept_id", parsedId.data)
        .maybeSingle();
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Learning page database service unavailable",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing learning page",
        cause: result.error,
      });
    }

    if (!result.data) {
      return null;
    }

    const parsedRow = learningPageRowSchema.safeParse(result.data);
    if (!parsedRow.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed learning page",
        cause: parsedRow.error,
      });
    }

    const mapped: ConceptLearningPage = {
      id: parsedRow.data.id,
      conceptId: parsedRow.data.concept_id,
      content: parsedRow.data.content,
      createdAt: parsedRow.data.created_at,
    };

    const validated = conceptLearningPageSchema.safeParse(mapped);
    if (!validated.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed learning page",
        cause: validated.error,
      });
    }

    return validated.data;
  }

  async insert(conceptId: UUID, content: string): Promise<ConceptLearningPage> {
    const parsedId = uuidSchema.safeParse(conceptId);
    const parsedContent = generatedLearningPageSchema.safeParse({ content });

    if (!parsedId.success || !parsedContent.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid learning page record",
        cause: !parsedId.success ? parsedId.error : parsedContent.error,
      });
    }

    const row = {
      concept_id: parsedId.data,
      content: parsedContent.data.content,
    };

    let result: QueryResult;
    try {
      result = await this.client
        .from("concept_learning_pages")
        .insert(row)
        .select("id, concept_id, content, created_at")
        .single();
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Learning page database service unavailable",
        cause: err,
      });
    }

    if (result.error) {
      if (result.error.code === "23505") {
        const existing = await this.get(parsedId.data);
        if (!existing) {
          throw new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: "Duplicate learning page was not found",
          });
        }
        return existing;
      }

      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing learning page",
        cause: result.error,
      });
    }

    const parsedRow = learningPageRowSchema.safeParse(result.data);
    if (!parsedRow.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed learning page",
        cause: parsedRow.error,
      });
    }

    const mapped: ConceptLearningPage = {
      id: parsedRow.data.id,
      conceptId: parsedRow.data.concept_id,
      content: parsedRow.data.content,
      createdAt: parsedRow.data.created_at,
    };

    const validated = conceptLearningPageSchema.safeParse(mapped);
    if (!validated.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed learning page",
        cause: validated.error,
      });
    }

    return validated.data;
  }
}
