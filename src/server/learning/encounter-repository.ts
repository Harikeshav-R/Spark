import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type UUID,
  type MasteryBand,
  uuidSchema,
} from "../../contracts/common.js";
import {
  type EncounterSource,
  encounterSourceSchema,
} from "../../contracts/game.js";
import { confidenceToBand } from "../../contracts/mastery.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";
import type { QuizHintTuple, QuizQuestionHints } from "../ai/index.js";

export type OptionPermutation = [number, number, number, number];

export interface EncounterRecord {
  id: UUID;
  studentId: UUID;
  conceptId: UUID;
  source: EncounterSource;
  questId: UUID | null;
  partyQuestId: UUID | null;
  status: "active" | "completed" | "abandoned";
  questionIds: [UUID, UUID, UUID, UUID, UUID];
  optionPermutations: [
    OptionPermutation,
    OptionPermutation,
    OptionPermutation,
    OptionPermutation,
    OptionPermutation,
  ];
  hintsUsed: [number, number, number, number, number];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type NewEncounterRecord = Omit<EncounterRecord, "status" | "version">;

export interface EncounterAttemptRecord {
  id: UUID;
  studentId: UUID;
  conceptId: UUID;
  score: number;
  correctCount: number;
  totalQuestions: 5;
  encounterId: UUID;
  submittedAnswers: {
    questionId: UUID;
    selectedOption: number;
    correct: boolean;
  }[];
  submittedAt: string;
}

export interface NewEncounterAttemptRecord {
  id: UUID;
  studentId: UUID;
  conceptId: UUID;
  score: number;
  correctCount: number;
  totalQuestions: 5;
  encounterId: UUID;
  submittedAnswers: {
    questionId: UUID;
    selectedOption: number;
    correct: boolean;
  }[];
  submittedAt: string;
}

export const optionPermutationSchema = z
  .tuple([
    z.number().int().min(0).max(3),
    z.number().int().min(0).max(3),
    z.number().int().min(0).max(3),
    z.number().int().min(0).max(3),
  ])
  .refine(
    (arr) => new Set(arr).size === 4 && [0, 1, 2, 3].every((n) => arr.includes(n)),
    {
      message: "optionPermutation must contain each integer 0..3 exactly once",
    },
  );

const hintsUsedRecordSchema = z.object({
  "1": z.number().int().min(0).max(3),
  "2": z.number().int().min(0).max(3),
  "3": z.number().int().min(0).max(3),
  "4": z.number().int().min(0).max(3),
  "5": z.number().int().min(0).max(3),
});

const encounterRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  concept_id: uuidSchema,
  source: encounterSourceSchema,
  quest_id: uuidSchema.nullable(),
  party_quest_id: uuidSchema.nullable(),
  status: z.enum(["active", "completed", "abandoned"]),
  question_ids: z.array(uuidSchema).length(5),
  option_permutations: z.object({
    "1": optionPermutationSchema,
    "2": optionPermutationSchema,
    "3": optionPermutationSchema,
    "4": optionPermutationSchema,
    "5": optionPermutationSchema,
  }),
  hints_used: hintsUsedRecordSchema,
  version: z.number().int().positive(),
  created_at: z
    .union([z.string(), z.date()])
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid created_at timestamp",
    })
    .transform((val) =>
      val instanceof Date ? val.toISOString() : new Date(val).toISOString(),
    ),
  updated_at: z
    .union([z.string(), z.date()])
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid updated_at timestamp",
    })
    .transform((val) =>
      val instanceof Date ? val.toISOString() : new Date(val).toISOString(),
    ),
});

const submittedAnswerRowSchema = z.object({
  question_id: uuidSchema,
  selected_option: z.number().int().min(0).max(3),
  correct: z.boolean(),
});

const encounterAttemptRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  concept_id: uuidSchema,
  score: z.number().min(0).max(1),
  correct_count: z.number().int().min(0).max(5),
  total_questions: z.literal(5),
  submitted_answers: z.array(submittedAnswerRowSchema).length(5),
  encounter_id: uuidSchema,
  submitted_at: z
    .union([z.string(), z.date()])
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid submitted_at timestamp",
    })
    .transform((val) =>
      val instanceof Date ? val.toISOString() : new Date(val).toISOString(),
    ),
});

export interface EncounterQueryResult<T = unknown> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

export interface EncounterSelectFilterBuilder {
  eq(column: string, value: unknown): EncounterSelectFilterBuilder;
  in(column: string, values: readonly string[]): EncounterSelectFilterBuilder;
  is(column: string, value: unknown): EncounterSelectFilterBuilder;
  order(
    column: string,
    options?: { ascending?: boolean },
  ): EncounterSelectFilterBuilder;
  limit(count: number): PromiseLike<EncounterQueryResult<unknown[]>>;
  single(): PromiseLike<EncounterQueryResult<unknown>>;
  maybeSingle(): PromiseLike<EncounterQueryResult<unknown>>;
  then: PromiseLike<EncounterQueryResult<unknown>>["then"];
}

export interface EncounterMutationBuilder {
  eq(column: string, value: unknown): EncounterMutationBuilder;
  is(column: string, value: unknown): EncounterMutationBuilder;
  select(columns?: string): {
    single(): PromiseLike<EncounterQueryResult<unknown>>;
    maybeSingle(): PromiseLike<EncounterQueryResult<unknown>>;
  };
  then: PromiseLike<EncounterQueryResult<unknown>>["then"];
}

export interface EncounterDatabaseClientPort {
  from(table: string): {
    select(columns?: string): EncounterSelectFilterBuilder;
    insert(values: unknown): EncounterMutationBuilder;
    update(values: unknown): EncounterMutationBuilder;
  };
}

export interface EncounterRepositoryPort {
  getQuestionHints(
    conceptId: UUID,
    questionIds: readonly UUID[],
  ): Promise<Map<UUID, QuizHintTuple | null>>;
  storeMissingQuestionHints(
    conceptId: UUID,
    hints: readonly QuizQuestionHints[],
  ): Promise<void>;
  insertEncounter(input: NewEncounterRecord): Promise<EncounterRecord>;
  getEncounter(
    studentId: UUID,
    encounterId: UUID,
  ): Promise<EncounterRecord | null>;
  compareAndSwapEncounter(
    studentId: UUID,
    encounterId: UUID,
    expectedVersion: number,
    patch: {
      hintsUsed?: [number, number, number, number, number];
      status?: "completed";
    },
    updatedAt: string,
  ): Promise<EncounterRecord | null>;
  getAttempt(
    studentId: UUID,
    encounterId: UUID,
  ): Promise<EncounterAttemptRecord | null>;
  insertAttempt(
    input: NewEncounterAttemptRecord,
  ): Promise<EncounterAttemptRecord>;
  getCommittedGrade(
    studentId: UUID,
    conceptId: UUID,
    attemptId: UUID,
  ): Promise<{ newConfidence: number; newBand: MasteryBand } | null>;
  getAttemptXp(
    studentId: UUID,
    conceptId: UUID,
    attemptId: UUID,
    awardDate: string,
  ): Promise<number>;
}

function parseEncounterRow(row: unknown): EncounterRecord {
  const parsed = encounterRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new AppError({
      code: DomainErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: 500,
      message: "Database returned malformed encounter row",
      cause: parsed.error,
    });
  }

  const d = parsed.data;
  const p = d.option_permutations;
  const h = d.hints_used;

  return {
    id: d.id,
    studentId: d.student_id,
    conceptId: d.concept_id,
    source: d.source,
    questId: d.quest_id,
    partyQuestId: d.party_quest_id,
    status: d.status,
    questionIds: [
      d.question_ids[0],
      d.question_ids[1],
      d.question_ids[2],
      d.question_ids[3],
      d.question_ids[4],
    ],
    optionPermutations: [p["1"], p["2"], p["3"], p["4"], p["5"]],
    hintsUsed: [h["1"], h["2"], h["3"], h["4"], h["5"]],
    version: d.version,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

function parseEncounterAttemptRow(row: unknown): EncounterAttemptRecord {
  const parsed = encounterAttemptRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new AppError({
      code: DomainErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: 500,
      message: "Database returned malformed quiz attempt row",
      cause: parsed.error,
    });
  }

  const d = parsed.data;
  return {
    id: d.id,
    studentId: d.student_id,
    conceptId: d.concept_id,
    score: d.score,
    correctCount: d.correct_count,
    totalQuestions: 5,
    encounterId: d.encounter_id,
    submittedAnswers: d.submitted_answers.map((a) => ({
      questionId: a.question_id,
      selectedOption: a.selected_option,
      correct: a.correct,
    })),
    submittedAt: d.submitted_at,
  };
}

export class EncounterRepository implements EncounterRepositoryPort {
  private readonly client: EncounterDatabaseClientPort;

  constructor(
    client: Pick<SupabaseClient, "from"> | EncounterDatabaseClientPort,
  ) {
    this.client = client as unknown as EncounterDatabaseClientPort;
  }

  async getQuestionHints(
    conceptId: UUID,
    questionIds: readonly UUID[],
  ): Promise<Map<UUID, QuizHintTuple | null>> {
    const parsedConceptId = uuidSchema.safeParse(conceptId);
    if (!parsedConceptId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid concept ID for question hints query",
      });
    }

    let result: EncounterQueryResult<unknown[]>;
    try {
      result = (await this.client
        .from("concept_quiz_questions")
        .select("id, hints")
        .eq("concept_id", parsedConceptId.data)
        .in("id", questionIds)) as EncounterQueryResult<unknown[]>;
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Database service unavailable while fetching question hints",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Database error querying question hints: ${result.error.message ?? "Unknown error"}`,
        cause: result.error,
      });
    }

    const rows = result.data ?? [];
    const resultMap = new Map<UUID, QuizHintTuple | null>();

    for (const r of rows) {
      const rowObj = r as { id?: string; hints?: unknown };
      if (!rowObj.id) continue;
      const qId = rowObj.id as UUID;
      const rawHints = rowObj.hints;

      if (rawHints === null || rawHints === undefined) {
        resultMap.set(qId, null);
        continue;
      }

      if (
        Array.isArray(rawHints) &&
        rawHints.length === 3 &&
        rawHints.every((h) => typeof h === "string" && h.length >= 5 && h.length <= 300)
      ) {
        resultMap.set(qId, [rawHints[0], rawHints[1], rawHints[2]]);
      } else {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: `Malformed non-null hints found on question ${qId}`,
        });
      }
    }

    return resultMap;
  }

  async storeMissingQuestionHints(
    conceptId: UUID,
    hints: readonly QuizQuestionHints[],
  ): Promise<void> {
    for (const item of hints) {
      try {
        const updateRes = (await this.client
          .from("concept_quiz_questions")
          .update({ hints: item.hints })
          .eq("id", item.questionId)
          .eq("concept_id", conceptId)
          .is("hints", null)) as EncounterQueryResult<unknown>;

        if (updateRes.error) {
          throw new AppError({
            code: DomainErrorCode.SERVICE_UNAVAILABLE,
            statusCode: 503,
            message: `Failed to update question hints: ${updateRes.error.message ?? "Unknown error"}`,
            cause: updateRes.error,
          });
        }
      } catch (err: unknown) {
        if (err instanceof AppError) throw err;
        throw new AppError({
          code: DomainErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503,
          message: "Database service unavailable while updating question hints",
          cause: err,
        });
      }
    }

    const questionIds = hints.map((h) => h.questionId);
    const reloaded = await this.getQuestionHints(conceptId, questionIds);

    for (const qId of questionIds) {
      const stored = reloaded.get(qId);
      if (!stored) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: `Question hints missing after store operation for question ${qId}`,
        });
      }
    }
  }

  async insertEncounter(input: NewEncounterRecord): Promise<EncounterRecord> {
    const dbRow = {
      id: input.id,
      student_id: input.studentId,
      concept_id: input.conceptId,
      source: input.source,
      quest_id: input.questId,
      party_quest_id: input.partyQuestId,
      status: "active",
      question_ids: input.questionIds,
      option_permutations: {
        "1": input.optionPermutations[0],
        "2": input.optionPermutations[1],
        "3": input.optionPermutations[2],
        "4": input.optionPermutations[3],
        "5": input.optionPermutations[4],
      },
      hints_used: {
        "1": input.hintsUsed[0],
        "2": input.hintsUsed[1],
        "3": input.hintsUsed[2],
        "4": input.hintsUsed[3],
        "5": input.hintsUsed[4],
      },
      version: 1,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
    };

    let result: EncounterQueryResult<unknown>;
    try {
      result = (await this.client
        .from("encounters")
        .insert(dbRow)
        .select()
        .single()) as EncounterQueryResult<unknown>;
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Database service unavailable while creating encounter",
        cause: err,
      });
    }

    if (result.error || !result.data) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Database error inserting encounter: ${result.error?.message ?? "Unknown error"}`,
        cause: result.error,
      });
    }

    return parseEncounterRow(result.data);
  }

  async getEncounter(
    studentId: UUID,
    encounterId: UUID,
  ): Promise<EncounterRecord | null> {
    let result: EncounterQueryResult<unknown>;
    try {
      result = (await this.client
        .from("encounters")
        .select("*")
        .eq("student_id", studentId)
        .eq("id", encounterId)
        .maybeSingle()) as EncounterQueryResult<unknown>;
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Database service unavailable while fetching encounter",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Database error fetching encounter: ${result.error.message ?? "Unknown error"}`,
        cause: result.error,
      });
    }

    if (!result.data) {
      return null;
    }

    return parseEncounterRow(result.data);
  }

  async compareAndSwapEncounter(
    studentId: UUID,
    encounterId: UUID,
    expectedVersion: number,
    patch: {
      hintsUsed?: [number, number, number, number, number];
      status?: "completed";
    },
    updatedAt: string,
  ): Promise<EncounterRecord | null> {
    const updatePayload: Record<string, unknown> = {
      version: expectedVersion + 1,
      updated_at: updatedAt,
    };

    if (patch.hintsUsed !== undefined) {
      updatePayload.hints_used = {
        "1": patch.hintsUsed[0],
        "2": patch.hintsUsed[1],
        "3": patch.hintsUsed[2],
        "4": patch.hintsUsed[3],
        "5": patch.hintsUsed[4],
      };
    }

    if (patch.status !== undefined) {
      updatePayload.status = patch.status;
    }

    let result: EncounterQueryResult<unknown>;
    try {
      result = (await this.client
        .from("encounters")
        .update(updatePayload)
        .eq("id", encounterId)
        .eq("student_id", studentId)
        .eq("status", "active")
        .eq("version", expectedVersion)
        .select()
        .maybeSingle()) as EncounterQueryResult<unknown>;
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Database service unavailable while updating encounter",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Database error updating encounter: ${result.error.message ?? "Unknown error"}`,
        cause: result.error,
      });
    }

    if (!result.data) {
      return null;
    }

    return parseEncounterRow(result.data);
  }

  async getAttempt(
    studentId: UUID,
    encounterId: UUID,
  ): Promise<EncounterAttemptRecord | null> {
    let result: EncounterQueryResult<unknown>;
    try {
      result = (await this.client
        .from("quiz_attempts")
        .select("*")
        .eq("student_id", studentId)
        .eq("encounter_id", encounterId)
        .maybeSingle()) as EncounterQueryResult<unknown>;
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Database service unavailable while fetching attempt",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Database error fetching attempt: ${result.error.message ?? "Unknown error"}`,
        cause: result.error,
      });
    }

    if (!result.data) {
      return null;
    }

    return parseEncounterAttemptRow(result.data);
  }

  async insertAttempt(
    input: NewEncounterAttemptRecord,
  ): Promise<EncounterAttemptRecord> {
    const dbRow = {
      id: input.id,
      student_id: input.studentId,
      concept_id: input.conceptId,
      score: input.score,
      correct_count: input.correctCount,
      total_questions: input.totalQuestions,
      submitted_answers: input.submittedAnswers.map((a) => ({
        question_id: a.questionId,
        selected_option: a.selectedOption,
        correct: a.correct,
      })),
      encounter_id: input.encounterId,
      submitted_at: input.submittedAt,
    };

    let result: EncounterQueryResult<unknown>;
    try {
      result = (await this.client
        .from("quiz_attempts")
        .insert(dbRow)
        .select()
        .single()) as EncounterQueryResult<unknown>;
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Database service unavailable while inserting quiz attempt",
        cause: err,
      });
    }

    if (result.error) {
      if (result.error.code === "23505") {
        const winning = await this.getAttempt(input.studentId, input.encounterId);
        if (!winning) {
          throw new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: "Unique constraint conflict on attempt, but existing attempt could not be loaded",
            cause: result.error,
          });
        }
        return winning;
      }

      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Database error inserting quiz attempt: ${result.error.message ?? "Unknown error"}`,
        cause: result.error,
      });
    }

    if (!result.data) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Insert attempt succeeded but returned no row",
      });
    }

    return parseEncounterAttemptRow(result.data);
  }

  async getCommittedGrade(
    studentId: UUID,
    conceptId: UUID,
    attemptId: UUID,
  ): Promise<{ newConfidence: number; newBand: MasteryBand } | null> {
    let result: EncounterQueryResult<unknown>;
    try {
      result = (await this.client
        .from("mastery_evidence")
        .select("new_confidence")
        .eq("student_id", studentId)
        .eq("concept_id", conceptId)
        .eq("evidence_type", "quiz")
        .eq("source_id", attemptId)
        .maybeSingle()) as EncounterQueryResult<unknown>;
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Database service unavailable while querying mastery evidence",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Database error querying mastery evidence: ${result.error.message ?? "Unknown error"}`,
        cause: result.error,
      });
    }

    if (!result.data) {
      return null;
    }

    const row = result.data as { new_confidence?: unknown };
    const conf = row.new_confidence;

    if (typeof conf !== "number" || !Number.isFinite(conf) || conf < 0 || conf > 1) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Malformed confidence value stored in mastery evidence",
      });
    }

    return {
      newConfidence: conf,
      newBand: confidenceToBand(conf),
    };
  }

  async getAttemptXp(
    studentId: UUID,
    conceptId: UUID,
    attemptId: UUID,
    awardDate: string,
  ): Promise<number> {
    let result: EncounterQueryResult<unknown>;
    try {
      result = (await this.client
        .from("xp_events")
        .select("amount")
        .eq("student_id", studentId)
        .eq("concept_id", conceptId)
        .eq("reason", "encounter")
        .eq("source_id", attemptId)
        .eq("award_date", awardDate)
        .maybeSingle()) as EncounterQueryResult<unknown>;
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Database service unavailable while querying XP ledger",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Database error querying XP ledger: ${result.error.message ?? "Unknown error"}`,
        cause: result.error,
      });
    }

    if (!result.data) {
      return 0;
    }

    const row = result.data as { amount?: unknown };
    const amt = row.amount;

    if (typeof amt !== "number" || !Number.isInteger(amt) || amt < 0) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Malformed XP amount in ledger",
      });
    }

    return amt;
  }
}
