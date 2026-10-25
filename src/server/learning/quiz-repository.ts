import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { uuidSchema, type UUID } from "../../contracts/common.js";
import {
  conceptQuizQuestionSchema,
  type ConceptQuizQuestion,
} from "../../contracts/learning.js";
import {
  generatedQuizQuestionSchema,
  type GeneratedQuizQuestion,
} from "../../contracts/ai.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";

const conceptQuizQuestionRowSchema = z.object({
  id: uuidSchema,
  concept_id: uuidSchema,
  question: z.string().min(1),
  option_a: z.string().min(1),
  option_b: z.string().min(1),
  option_c: z.string().min(1),
  option_d: z.string().min(1),
  correct_answer: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
  question_order: z.number().int().nonnegative(),
  created_at: z
    .union([z.string(), z.date()])
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid created_at timestamp",
    })
    .transform((val) =>
      val instanceof Date ? val.toISOString() : new Date(val).toISOString()
    ),
});

const quizAttemptRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  concept_id: uuidSchema,
  score: z.number().min(0).max(1),
  correct_count: z.number().int().min(0).max(5),
  total_questions: z.literal(5),
  submitted_at: z
    .union([z.string(), z.date()])
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid submitted_at timestamp",
    })
    .transform((val) =>
      val instanceof Date ? val.toISOString() : new Date(val).toISOString()
    ),
});

export interface QuizAttemptRecord {
  id: UUID;
  studentId: UUID;
  conceptId: UUID;
  score: number;
  correctCount: number;
  totalQuestions: 5;
  submittedAt: string;
}

export interface QuizQueryResult<T = unknown> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

export interface QuizSelectFilterBuilder {
  eq(column: string, value: string): QuizSelectFilterBuilder;
  in(column: string, values: string[]): QuizSelectFilterBuilder;
  order(column: string, options?: { ascending?: boolean }): QuizSelectFilterBuilder;
  limit(count: number): PromiseLike<QuizQueryResult<unknown[]>>;
  then: PromiseLike<QuizQueryResult<unknown[]>>["then"];
}

export interface QuizInsertBuilder {
  select(columns?: string): {
    single(): PromiseLike<QuizQueryResult<unknown>>;
  };
  then: PromiseLike<QuizQueryResult<unknown>>["then"];
}

export interface QuizDatabaseClientPort {
  from(table: string): {
    select(columns?: string): QuizSelectFilterBuilder;
    insert(values: unknown): QuizInsertBuilder;
  };
}

export interface QuizRepositoryPort {
  getQuestions(conceptId: UUID): Promise<ConceptQuizQuestion[]>;
  insertQuestions(conceptId: UUID, questions: GeneratedQuizQuestion[]): Promise<void>;
  getQuestionsByIds(conceptId: UUID, questionIds: UUID[]): Promise<ConceptQuizQuestion[]>;
  insertAttempt(input: {
    studentId: UUID;
    conceptId: UUID;
    score: number;
    correctCount: number;
    totalQuestions: 5;
    submittedAnswers: { questionId: UUID; selectedOption: number; correct: boolean }[];
  }): Promise<QuizAttemptRecord>;
}

const QUESTION_SELECT_COLUMNS =
  "id, concept_id, question, option_a, option_b, option_c, option_d, correct_answer, explanation, question_order, created_at";

export class QuizRepository implements QuizRepositoryPort {
  private readonly client: QuizDatabaseClientPort;

  constructor(client: Pick<SupabaseClient, "from"> | QuizDatabaseClientPort) {
    this.client = client as unknown as QuizDatabaseClientPort;
  }

  async getQuestions(conceptId: UUID): Promise<ConceptQuizQuestion[]> {
    const parsedConceptId = uuidSchema.safeParse(conceptId);
    if (!parsedConceptId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid quiz concept ID",
        cause: parsedConceptId.error,
      });
    }

    let result: QuizQueryResult<unknown[]>;
    try {
      result = await this.client
        .from("concept_quiz_questions")
        .select(QUESTION_SELECT_COLUMNS)
        .eq("concept_id", parsedConceptId.data)
        .order("created_at", { ascending: true })
        .order("question_order", { ascending: true })
        .order("id", { ascending: true })
        .limit(5);
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Quiz database service unavailable",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing quiz",
        cause: result.error,
      });
    }

    const rows = result.data ?? [];
    return this.parseAndMapQuestions(rows);
  }

  async insertQuestions(
    conceptId: UUID,
    questions: GeneratedQuizQuestion[]
  ): Promise<void> {
    const parsedConceptId = uuidSchema.safeParse(conceptId);
    if (!parsedConceptId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid quiz concept ID",
        cause: parsedConceptId.error,
      });
    }

    if (!Array.isArray(questions) || questions.length !== 5) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid quiz questions to insert",
      });
    }

    for (const q of questions) {
      const parsedQ = generatedQuizQuestionSchema.safeParse(q);
      if (!parsedQ.success) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid quiz questions to insert",
          cause: parsedQ.error,
        });
      }
    }

    const rows = questions.map((q, idx) => ({
      concept_id: parsedConceptId.data,
      question: q.question,
      option_a: q.optionA,
      option_b: q.optionB,
      option_c: q.optionC,
      option_d: q.optionD,
      correct_answer: q.correctAnswer,
      explanation: q.explanation,
      question_order: idx,
    }));

    let result: QuizQueryResult<unknown>;
    try {
      result = await this.client.from("concept_quiz_questions").insert(rows);
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Quiz database service unavailable",
        cause: err,
      });
    }

    if (result && result.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing quiz",
        cause: result.error,
      });
    }
  }

  async getQuestionsByIds(
    conceptId: UUID,
    questionIds: UUID[]
  ): Promise<ConceptQuizQuestion[]> {
    const parsedConceptId = uuidSchema.safeParse(conceptId);
    if (!parsedConceptId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid quiz concept ID",
        cause: parsedConceptId.error,
      });
    }

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return [];
    }

    const validQuestionIds: string[] = [];
    for (const qid of questionIds) {
      const parsedQid = uuidSchema.safeParse(qid);
      if (!parsedQid.success) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid quiz question IDs",
          cause: parsedQid.error,
        });
      }
      validQuestionIds.push(parsedQid.data);
    }

    let result: QuizQueryResult<unknown[]>;
    try {
      result = await this.client
        .from("concept_quiz_questions")
        .select(QUESTION_SELECT_COLUMNS)
        .eq("concept_id", parsedConceptId.data)
        .in("id", validQuestionIds);
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Quiz database service unavailable",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing quiz",
        cause: result.error,
      });
    }

    const rows = result.data ?? [];
    const questions = this.parseAndMapQuestions(rows);

    for (const q of questions) {
      if (q.conceptId !== parsedConceptId.data) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Database returned malformed quiz data",
        });
      }
    }

    return questions;
  }

  async insertAttempt(input: {
    studentId: UUID;
    conceptId: UUID;
    score: number;
    correctCount: number;
    totalQuestions: 5;
    submittedAnswers: { questionId: UUID; selectedOption: number; correct: boolean }[];
  }): Promise<QuizAttemptRecord> {
    const studentIdParsed = uuidSchema.safeParse(input.studentId);
    const conceptIdParsed = uuidSchema.safeParse(input.conceptId);

    if (
      !studentIdParsed.success ||
      !conceptIdParsed.success ||
      typeof input.score !== "number" ||
      !Number.isFinite(input.score) ||
      input.score < 0 ||
      input.score > 1 ||
      !Number.isInteger(input.correctCount) ||
      input.correctCount < 0 ||
      input.correctCount > 5 ||
      input.totalQuestions !== 5 ||
      !Array.isArray(input.submittedAnswers)
    ) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid quiz attempt data to insert",
      });
    }

    const submittedAnswersJson = input.submittedAnswers.map((a) => {
      const qid = uuidSchema.safeParse(a.questionId);
      if (
        !qid.success ||
        !Number.isInteger(a.selectedOption) ||
        a.selectedOption < 0 ||
        a.selectedOption > 3 ||
        typeof a.correct !== "boolean"
      ) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid submitted answer format",
        });
      }
      return {
        question_id: qid.data,
        selected_option: a.selectedOption,
        correct: a.correct,
      };
    });

    const insertPayload = {
      student_id: studentIdParsed.data,
      concept_id: conceptIdParsed.data,
      score: input.score,
      correct_count: input.correctCount,
      total_questions: 5,
      submitted_answers: submittedAnswersJson,
    };

    let result: QuizQueryResult<unknown>;
    try {
      result = await this.client
        .from("quiz_attempts")
        .insert(insertPayload)
        .select("id, student_id, concept_id, score, correct_count, total_questions, submitted_at")
        .single();
    } catch (err: unknown) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Quiz database service unavailable",
        cause: err,
      });
    }

    if (result.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing quiz",
        cause: result.error,
      });
    }

    const parsedRow = quizAttemptRowSchema.safeParse(result.data);
    if (!parsedRow.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed quiz data",
        cause: parsedRow.error,
      });
    }

    const row = parsedRow.data;

    if (
      row.student_id !== studentIdParsed.data ||
      row.concept_id !== conceptIdParsed.data ||
      Math.abs(row.score - input.score) > 1e-5 ||
      row.correct_count !== input.correctCount ||
      row.total_questions !== 5
    ) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed quiz data",
      });
    }

    return {
      id: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      score: row.score,
      correctCount: row.correct_count,
      totalQuestions: 5,
      submittedAt: row.submitted_at,
    };
  }

  private parseAndMapQuestions(rows: unknown[]): ConceptQuizQuestion[] {
    return rows.map((row) => {
      const parsedRow = conceptQuizQuestionRowSchema.safeParse(row);
      if (!parsedRow.success) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Database returned malformed quiz data",
          cause: parsedRow.error,
        });
      }

      const r = parsedRow.data;
      const mapped: ConceptQuizQuestion = {
        id: r.id,
        conceptId: r.concept_id,
        question: r.question,
        optionA: r.option_a,
        optionB: r.option_b,
        optionC: r.option_c,
        optionD: r.option_d,
        correctAnswer: r.correct_answer,
        explanation: r.explanation,
        questionOrder: r.question_order,
        createdAt: r.created_at,
      };

      const parsedMapped = conceptQuizQuestionSchema.safeParse(mapped);
      if (!parsedMapped.success) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Database returned malformed quiz data",
          cause: parsedMapped.error,
        });
      }

      return parsedMapped.data;
    });
  }
}
