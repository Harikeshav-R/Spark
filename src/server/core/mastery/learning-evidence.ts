import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActorContext, UUID, MasteryBand } from "../../../contracts/common.js";
import { uuidSchema } from "../../../contracts/common.js";
import type { CourseService } from "../../../contracts/course.js";
import type { MasteryService } from "../../../contracts/mastery.js";
import { AppError } from "../../../contracts/errors.js";
import { mapPostgrestError } from "../../platform/index.js";

export interface LearningEvidenceResult {
  sourceId: UUID;
  studentId: UUID;
  conceptId: UUID;
  confidence: number;
  band: MasteryBand;
  attempts: number;
  version: number;
}

const quizAttemptRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  concept_id: uuidSchema,
  score: z.number().finite().min(0).max(1),
  correct_count: z.number().int().min(0).max(5),
  total_questions: z.literal(5),
  student: z.object({
    id: uuidSchema,
    auth_id: uuidSchema,
    course_id: uuidSchema,
  }),
  concept: z.object({
    course_id: uuidSchema,
  }),
});

const tutoringMessageRowSchema = z.object({
  id: uuidSchema,
  session_id: uuidSchema,
  role: z.string(),
  concept_id: uuidSchema.nullable(),
  understanding_detected: z.boolean(),
  session: z.object({
    id: uuidSchema,
    student_id: uuidSchema,
    target_concepts: z.array(uuidSchema),
    student: z.object({
      id: uuidSchema,
      auth_id: uuidSchema,
      course_id: uuidSchema,
    }),
  }),
  concept: z.object({
    course_id: uuidSchema,
  }),
});

export class LearningEvidenceService {
  constructor(
    private readonly client: Pick<SupabaseClient, "from">,
    private readonly courses: Pick<CourseService, "getCourse">,
    private readonly mastery: Pick<MasteryService, "applyEvidence">,
  ) {}

  private async validateAndAuthorizeSource(
    actor: ActorContext,
    courseId: UUID,
    sourceId: UUID,
    evidenceType: "quiz" | "tutor",
  ): Promise<{ courseId: UUID; sourceId: UUID }> {
    const courseIdParsed = uuidSchema.safeParse(courseId);
    const sourceIdParsed = uuidSchema.safeParse(sourceId);

    if (!courseIdParsed.success || !sourceIdParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: `Invalid UUID parameter provided for ${evidenceType} evidence`,
      });
    }

    const validCourseId = courseIdParsed.data;
    const validSourceId = sourceIdParsed.data;

    try {
      await this.courses.getCourse(actor, validCourseId);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to verify course authorization",
        cause: err,
      });
    }

    return { courseId: validCourseId, sourceId: validSourceId };
  }

  async applyQuizAttempt(
    actor: ActorContext,
    courseId: UUID,
    attemptId: UUID,
  ): Promise<LearningEvidenceResult> {
    const { courseId: validCourseId, sourceId: validAttemptId } =
      await this.validateAndAuthorizeSource(actor, courseId, attemptId, "quiz");

    // 3. Query quiz attempt with inner joins on students and concept_nodes
    let query = this.client
      .from("quiz_attempts")
      .select(
        "id,student_id,concept_id,score,correct_count,total_questions," +
        "student:students!inner(id,auth_id,course_id)," +
        "concept:concept_nodes!inner(course_id)",
      )
      .eq("id", validAttemptId)
      .eq("student.course_id", validCourseId)
      .eq("concept.course_id", validCourseId);

    if (actor.role === "student") {
      query = query.eq("student.auth_id", actor.authId);
    }

    let queryResult: { data: unknown; error: unknown };
    try {
      queryResult = await query.maybeSingle();
    } catch (err: unknown) {
      throw mapPostgrestError(err, "Failed to load quiz attempt", "poll");
    }

    if (queryResult.error) {
      throw mapPostgrestError(queryResult.error, "Failed to load quiz attempt", "poll");
    }

    if (!queryResult.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Quiz attempt not found for this course",
      });
    }

    // 4. Validate queryResult with Zod schema
    const parsedRow = quizAttemptRowSchema.safeParse(queryResult.data);
    if (!parsedRow.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed quiz attempt record in database",
        cause: parsedRow.error,
      });
    }

    const row = parsedRow.data;

    // Reject inconsistent IDs, course relationships, or scoring values
    if (
      row.id !== validAttemptId ||
      row.student.id !== row.student_id ||
      row.student.course_id !== validCourseId ||
      row.concept.course_id !== validCourseId ||
      Math.abs(row.score - row.correct_count / row.total_questions) > 1e-5
    ) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed quiz attempt record in database",
      });
    }

    if (actor.role === "student" && row.student.auth_id !== actor.authId) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Quiz attempt not found for this course",
      });
    }

    // 5. Invoke mastery writer
    let result: {
      confidence: number;
      band: MasteryBand;
      attempts: number;
      version: number;
    };
    try {
      result = await this.mastery.applyEvidence(
        actor,
        row.student_id,
        row.concept_id,
        {
          type: "quiz",
          score: row.score,
          sourceId: row.id,
        },
      );
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to apply quiz evidence",
        cause: err,
      });
    }

    return {
      sourceId: row.id,
      studentId: row.student_id,
      conceptId: row.concept_id,
      confidence: result.confidence,
      band: result.band,
      attempts: result.attempts,
      version: result.version,
    };
  }

  async applyTutorMessage(
    actor: ActorContext,
    courseId: UUID,
    messageId: UUID,
  ): Promise<LearningEvidenceResult> {
    const { courseId: validCourseId, sourceId: validMessageId } =
      await this.validateAndAuthorizeSource(actor, courseId, messageId, "tutor");

    // 3. Query tutoring message with inner joins on tutoring_sessions, students, and concept_nodes
    let query = this.client
      .from("tutoring_messages")
      .select(
        "id,session_id,role,concept_id,understanding_detected," +
        "session:tutoring_sessions!inner(" +
          "id,student_id,target_concepts," +
          "student:students!inner(id,auth_id,course_id)" +
        ")," +
        "concept:concept_nodes!inner(course_id)",
      )
      .eq("id", validMessageId)
      .eq("session.student.course_id", validCourseId)
      .eq("concept.course_id", validCourseId);

    if (actor.role === "student") {
      query = query.eq("session.student.auth_id", actor.authId);
    }

    let queryResult: { data: unknown; error: unknown };
    try {
      queryResult = await query.maybeSingle();
    } catch (err: unknown) {
      throw mapPostgrestError(err, "Failed to load tutoring message", "poll");
    }

    if (queryResult.error) {
      throw mapPostgrestError(queryResult.error, "Failed to load tutoring message", "poll");
    }

    if (!queryResult.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Tutoring message not found for this course",
      });
    }

    // 4. Validate queryResult with Zod schema
    const parsedRow = tutoringMessageRowSchema.safeParse(queryResult.data);
    if (!parsedRow.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed tutoring message record in database",
        cause: parsedRow.error,
      });
    }

    const row = parsedRow.data;

    // Reject inconsistent IDs or course relationships
    if (
      row.id !== validMessageId ||
      row.session.id !== row.session_id ||
      row.session.student.id !== row.session.student_id ||
      row.session.student.course_id !== validCourseId ||
      row.concept.course_id !== validCourseId
    ) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed tutoring message record in database",
      });
    }

    if (actor.role === "student" && row.session.student.auth_id !== actor.authId) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Tutoring message not found for this course",
      });
    }

    // 5. Require role === 'assistant', understanding_detected === true, and concept_id in target_concepts
    if (
      row.role !== "assistant" ||
      !row.understanding_detected ||
      !row.concept_id ||
      !row.session.target_concepts.includes(row.concept_id)
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Tutoring message is not eligible for mastery evidence",
      });
    }

    // 6. Invoke mastery writer
    let result: {
      confidence: number;
      band: MasteryBand;
      attempts: number;
      version: number;
    };
    try {
      result = await this.mastery.applyEvidence(
        actor,
        row.session.student_id,
        row.concept_id,
        {
          type: "tutor",
          sourceId: row.id,
        },
      );
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to apply tutor evidence",
        cause: err,
      });
    }

    return {
      sourceId: row.id,
      studentId: row.session.student_id,
      conceptId: row.concept_id,
      confidence: result.confidence,
      band: result.band,
      attempts: result.attempts,
      version: result.version,
    };
  }
}
