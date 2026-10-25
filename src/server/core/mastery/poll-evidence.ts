import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActorContext, UUID, MasteryBand } from "../../../contracts/common.js";
import { uuidSchema } from "../../../contracts/common.js";
import type { CourseService } from "../../../contracts/course.js";
import type { MasteryService } from "../../../contracts/mastery.js";
import { evaluatedPollResponseSchema } from "../../../contracts/ai.js";
import { AppError } from "../../../contracts/errors.js";
import { mapPostgrestError } from "../../platform/index.js";
export interface PollEvidenceResult {
  responseId: UUID;
  studentId: UUID;
  conceptId: UUID;
  confidence: number;
  band: MasteryBand;
  attempts: number;
  version: number;
}

const pollResponseRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  status: z.enum(["pending", "evaluated", "failed"]),
  evaluation: z.unknown(),
  question: z.object({
    concept_id: uuidSchema,
    lecture: z.object({
      course_id: uuidSchema,
    }),
    concept: z.object({
      course_id: uuidSchema,
    }),
  }),
  student: z.object({
    id: uuidSchema,
    auth_id: uuidSchema,
    course_id: uuidSchema,
  }),
});


export class PollEvidenceService {
  constructor(
    private readonly client: Pick<SupabaseClient, "from">,
    private readonly courses: Pick<CourseService, "getCourse">,
    private readonly mastery: Pick<MasteryService, "applyEvidence">,
  ) {}

  async applyResponse(
    actor: ActorContext,
    courseId: UUID,
    responseId: UUID,
  ): Promise<PollEvidenceResult> {
    // 1. Validate courseId and responseId
    const courseIdParsed = uuidSchema.safeParse(courseId);
    const responseIdParsed = uuidSchema.safeParse(responseId);

    if (!courseIdParsed.success || !responseIdParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid UUID parameter provided for poll evidence",
      });
    }

    const validCourseId = courseIdParsed.data;
    const validResponseId = responseIdParsed.data;

    // 2. Await courses.getCourse(actor, courseId)
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

    // 3. Read one response with course-scoped inner-join query
    let query = this.client
      .from("poll_responses")
      .select(
        "id,student_id,status,evaluation," +
        "question:poll_questions!inner(" +
          "concept_id," +
          "lecture:lecture_sessions!inner(course_id)," +
          "concept:concept_nodes!inner(course_id)" +
        ")," +
        "student:students!inner(id,auth_id,course_id)",
      )
      .eq("id", validResponseId)
      .eq("question.lecture.course_id", validCourseId)
      .eq("question.concept.course_id", validCourseId)
      .eq("student.course_id", validCourseId);

    if (actor.role === "student") {
      query = query.eq("student.auth_id", actor.authId);
    }

    let queryResult: { data: unknown; error: unknown };
    try {
      queryResult = await query.maybeSingle();
    } catch (err: unknown) {
      throw mapPostgrestError(err, "Failed to load poll response", "poll");
    }

    if (queryResult.error) {
      throw mapPostgrestError(queryResult.error, "Failed to load poll response", "poll");
    }

    if (!queryResult.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll response not found for this course",
      });
    }

    // 4. Parse returned database value with local Zod schema
    const parsedRow = pollResponseRowSchema.safeParse(queryResult.data);
    if (!parsedRow.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed poll response record in database",
        cause: parsedRow.error,
      });
    }

    const row = parsedRow.data;

    // Reject inconsistent IDs or course relationships
    if (
      row.id !== validResponseId ||
      row.student.id !== row.student_id ||
      row.question.lecture.course_id !== validCourseId ||
      row.question.concept.course_id !== validCourseId ||
      row.student.course_id !== validCourseId
    ) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed poll response record in database",
      });
    }

    // 5. Require status === "evaluated"
    if (row.status !== "evaluated") {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Poll response has not been evaluated",
      });
    }

    // 6. Parse evaluation with evaluatedPollResponseSchema
    const evalParsed = evaluatedPollResponseSchema.safeParse(row.evaluation);
    if (!evalParsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed poll response evaluation in database",
        cause: evalParsed.error,
      });
    }
    const evaluation = evalParsed.data;

    // 7. Call existing mastery writer once
    let result: Awaited<ReturnType<MasteryService["applyEvidence"]>>;
    try {
      result = await this.mastery.applyEvidence(
        actor,
        row.student_id,
        row.question.concept_id,
        {
          type: "poll",
          outcome: evaluation.outcome,
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
        message: "Failed to apply poll evidence",
        cause: err,
      });
    }

    return {
      responseId: row.id,
      studentId: row.student_id,
      conceptId: row.question.concept_id,
      confidence: result.confidence,
      band: result.band,
      attempts: result.attempts,
      version: result.version,
    };
  }
}
