import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActorContext,
  ISOTimestamp,
  UUID,
} from "../../contracts/common.js";
import {
  uuidSchema,
} from "../../contracts/common.js";
import {
  pollQuestionSchema,
  publicPollQuestionSchema,
  pollDraftInputSchema,
  type PollQuestion,
  type PublicPollQuestion,
  type PollDraftInput,
  type TeacherPollSnapshot,
  type LectureStatus,
} from "../../contracts/classroom.js";
import type { EvaluatedPollResponse } from "../../contracts/ai.js";
import type { PollEvidenceResult } from "../core/index.js";
import { AppError } from "../../contracts/errors.js";

export type PollDatabaseClientPort = Pick<SupabaseClient, "from" | "rpc">;

export interface PollContext {
  poll: PollQuestion;
  courseId: UUID;
  lectureStatus: LectureStatus;
}

export type StoredPollMastery = Pick<
  PollEvidenceResult,
  "confidence" | "band" | "attempts" | "version"
>;

export interface StoredPollResponse {
  id: UUID;
  questionId: UUID;
  studentId: UUID;
  answer: string;
  status: "pending" | "evaluated" | "failed";
  evaluation: (EvaluatedPollResponse & { mastery?: StoredPollMastery }) | null;
  answeredAt: ISOTimestamp;
}

const storedPollMasterySchema = z.object({
  confidence: z.number().min(0.0).max(1.0),
  band: z.enum(["gray", "red", "yellow", "green"]),
  attempts: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});

const storedPollEvaluationSchema = z.object({
  outcome: z.enum(["correct", "partial", "wrong"]),
  feedback: z.string(),
  mastery: storedPollMasterySchema.optional(),
});

function mapDatabaseError(err: { code?: string; message?: string; details?: string }): AppError {
  const code = err.code ?? "";
  const msg = err.message ?? "";
  const details = err.details ?? "";
  const combined = `${msg} ${details}`;

  if (code === "P0002") {
    return new AppError({ code: "NOT_FOUND", statusCode: 404, message: "Poll not found" });
  }
  if (code === "42501") {
    return new AppError({ code: "FORBIDDEN", statusCode: 403, message: "Forbidden" });
  }
  if (code === "22023") {
    return new AppError({ code: "VALIDATION_ERROR", statusCode: 400, message: msg || "Invalid input parameters" });
  }
  if (code === "P0001") {
    if (combined.includes("ACTIVE_POLL_EXISTS")) {
      return new AppError({
        code: "ACTIVE_POLL_EXISTS",
        statusCode: 409,
        message: "Another poll is already active in this lecture",
      });
    }
    if (combined.includes("RESPONSE_ALREADY_SUBMITTED")) {
      return new AppError({
        code: "RESPONSE_ALREADY_SUBMITTED",
        statusCode: 409,
        message: "A different response has already been submitted for this poll",
      });
    }
    if (combined.includes("INVALID_POLL_STATUS")) {
      return new AppError({
        code: "INVALID_POLL_STATUS",
        statusCode: 400,
        message: msg || "Poll is not in a valid state for this action",
      });
    }
    if (combined.includes("INVALID_LECTURE_STATUS")) {
      return new AppError({
        code: "INVALID_LECTURE_STATUS",
        statusCode: 400,
        message: msg || "Lecture is not live",
      });
    }
  }
  if (code === "23505" && combined.includes("idx_poll_questions_single_active")) {
    return new AppError({
      code: "ACTIVE_POLL_EXISTS",
      statusCode: 409,
      message: "Another poll is already active in this lecture",
    });
  }
  if (code === "PGRST202" || code === "ECONNREFUSED" || code === "PGRST301") {
    return new AppError({ code: "SERVICE_UNAVAILABLE", statusCode: 503, message: "Database service unavailable" });
  }
  return new AppError({ code: "INTERNAL_SERVER_ERROR", statusCode: 500, message: msg || "Internal database error" });
}

function mapPollQuestion(data: Record<string, unknown>): PollQuestion {
  const rawPoll = {
    id: data.id,
    lectureId: data.lecture_id,
    conceptId: data.concept_id,
    question: data.question,
    expectedAnswer: data.expected_answer,
    status: data.status,
    generatedAt: data.generated_at ? new Date(String(data.generated_at)).toISOString() : undefined,
    activatedAt: data.activated_at ? new Date(String(data.activated_at)).toISOString() : undefined,
    closedAt: data.closed_at ? new Date(String(data.closed_at)).toISOString() : undefined,
  };
  const parsed = pollQuestionSchema.safeParse(rawPoll);
  if (!parsed.success) {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Malformed poll database row",
    });
  }
  return parsed.data;
}

function mapStoredResponse(data: Record<string, unknown>): StoredPollResponse {
  const rawEvaluation = data.evaluation;
  let parsedEvaluation: (EvaluatedPollResponse & { mastery?: StoredPollMastery }) | null = null;

  if (rawEvaluation !== null && rawEvaluation !== undefined) {
    const evalParsed = storedPollEvaluationSchema.safeParse(rawEvaluation);
    if (!evalParsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed poll response evaluation in database",
      });
    }
    parsedEvaluation = evalParsed.data as EvaluatedPollResponse & { mastery?: StoredPollMastery };
  }

  const id = uuidSchema.safeParse(data.id);
  const questionId = uuidSchema.safeParse(data.question_id);
  const studentId = uuidSchema.safeParse(data.student_id);
  const statusStr = String(data.status);

  if (!id.success || !questionId.success || !studentId.success) {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Malformed poll response identifiers in database",
    });
  }

  if (statusStr !== "pending" && statusStr !== "evaluated" && statusStr !== "failed") {
    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: `Invalid poll response status '${statusStr}' in database`,
    });
  }

  return {
    id: id.data,
    questionId: questionId.data,
    studentId: studentId.data,
    answer: String(data.answer ?? ""),
    status: statusStr,
    evaluation: parsedEvaluation,
    answeredAt: data.answered_at ? new Date(String(data.answered_at)).toISOString() : new Date().toISOString(),
  };
}

export class PollRepository {
  constructor(private readonly client: PollDatabaseClientPort) {}

  async getPoll(actor: ActorContext, pollId: UUID): Promise<PollContext> {
    const idResult = uuidSchema.safeParse(pollId);
    if (!idResult.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid poll ID format",
      });
    }

    if (actor.role === "teacher" && !actor.teacherId) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll not found",
      });
    }

    if (actor.role === "student" && (!actor.enrolledCourses || actor.enrolledCourses.length === 0)) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll not found",
      });
    }

    const query = this.client
      .from("poll_questions")
      .select(`
        id,
        lecture_id,
        concept_id,
        question,
        expected_answer,
        status,
        generated_at,
        activated_at,
        closed_at,
        lecture_sessions (
          id,
          course_id,
          status,
          courses (
            id,
            teacher_id
          )
        )
      `)
      .eq("id", pollId);

    const { data, error } = await query.single();

    if (error || !data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll not found",
      });
    }

    const lectureSessions = data.lecture_sessions as Record<string, unknown> | Array<Record<string, unknown>> | null;
    const lectureSession = Array.isArray(lectureSessions) ? lectureSessions[0] : lectureSessions;
    if (!lectureSession) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll lecture not found",
      });
    }

    const courses = lectureSession.courses as Record<string, unknown> | Array<Record<string, unknown>> | null;
    const course = Array.isArray(courses) ? courses[0] : courses;
    if (!course) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll course not found",
      });
    }

    const courseId = course.id as UUID;
    const lectureStatus = lectureSession.status as LectureStatus;

    if (actor.role === "teacher") {
      if (course.teacher_id !== actor.teacherId) {
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Poll not found",
        });
      }
    } else if (actor.role === "student") {
      const isEnrolled = actor.enrolledCourses.some((e) => e.courseId === courseId);
      if (!isEnrolled) {
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Poll not found",
        });
      }
    }

    const poll = mapPollQuestion(data as Record<string, unknown>);

    return {
      poll,
      courseId,
      lectureStatus,
    };
  }

  async transitionPoll(
    actor: ActorContext,
    pollId: UUID,
    targetStatus: "active" | "closed",
    occurredAt: ISOTimestamp,
  ): Promise<PollQuestion> {
    const { data, error } = await this.client.rpc("transition_poll", {
      p_actor_auth_id: actor.authId,
      p_poll_id: pollId,
      p_target_status: targetStatus,
      p_occurred_at: occurredAt,
    });

    if (error) {
      throw mapDatabaseError(error);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Missing transition result from database",
      });
    }

    return mapPollQuestion(row as Record<string, unknown>);
  }

  async ingestResponse(
    actor: ActorContext,
    pollId: UUID,
    responseId: UUID,
    answer: string,
    answeredAt: ISOTimestamp,
  ): Promise<{ response: StoredPollResponse; inserted: boolean }> {
    const { data, error } = await this.client.rpc("ingest_poll_response", {
      p_actor_auth_id: actor.authId,
      p_poll_id: pollId,
      p_response_id: responseId,
      p_answer: answer,
      p_answered_at: answeredAt,
    });

    if (error) {
      throw mapDatabaseError(error);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.response) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Missing response ingestion result from database",
      });
    }

    const response = mapStoredResponse(row.response as Record<string, unknown>);
    return {
      response,
      inserted: Boolean(row.inserted),
    };
  }

  async storeEvaluation(
    responseId: UUID,
    studentId: UUID,
    evaluation: EvaluatedPollResponse,
  ): Promise<StoredPollResponse> {
    const { data, error } = await this.client
      .from("poll_responses")
      .update({
        status: "evaluated",
        evaluation,
      })
      .eq("id", responseId)
      .eq("student_id", studentId)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error);
    }

    if (!data) {
      throw new AppError({
        code: "POLL_RESPONSE_STATE_CONFLICT",
        statusCode: 409,
        message: "Cannot store evaluation: poll response is not pending",
      });
    }

    return mapStoredResponse(data as Record<string, unknown>);
  }

  async markEvaluationFailed(responseId: UUID, studentId: UUID): Promise<void> {
    const { data, error } = await this.client
      .from("poll_responses")
      .update({
        status: "failed",
      })
      .eq("id", responseId)
      .eq("student_id", studentId)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (error) {
      throw mapDatabaseError(error);
    }

    if (!data) {
      throw new AppError({
        code: "POLL_RESPONSE_STATE_CONFLICT",
        statusCode: 409,
        message: "Cannot mark failed: poll response is not pending",
      });
    }
  }

  async storeMasteryResult(
    responseId: UUID,
    studentId: UUID,
    evaluation: EvaluatedPollResponse,
    mastery: StoredPollMastery,
  ): Promise<{ response: StoredPollResponse; stored: boolean }> {
    const updatedEvaluation = {
      ...evaluation,
      mastery,
    };

    const { data: updated, error: updateErr } = await this.client
      .from("poll_responses")
      .update({
        evaluation: updatedEvaluation,
      })
      .eq("id", responseId)
      .eq("student_id", studentId)
      .eq("status", "evaluated")
      .is("evaluation->mastery", null)
      .select()
      .maybeSingle();

    if (updateErr) {
      throw mapDatabaseError(updateErr);
    }

    if (updated) {
      return {
        response: mapStoredResponse(updated as Record<string, unknown>),
        stored: true,
      };
    }

    // Racing conflict: another request already stored mastery. Read winning row.
    const { data: existing, error: readErr } = await this.client
      .from("poll_responses")
      .select()
      .eq("id", responseId)
      .eq("student_id", studentId)
      .single();

    if (readErr || !existing) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll response not found during mastery resolution",
      });
    }

    return {
      response: mapStoredResponse(existing as Record<string, unknown>),
      stored: false,
    };
  }

  async insertDraft(actor: ActorContext, poll: PollQuestion): Promise<PollQuestion> {
    const validated = pollQuestionSchema.parse(poll);
    if (validated.status !== "draft") {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Initial poll status must be draft",
      });
    }

    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can insert poll drafts",
      });
    }

    const { data: lectureData, error: lectureError } = await this.client
      .from("lecture_sessions")
      .select("id, course_id, status, courses(teacher_id)")
      .eq("id", validated.lectureId)
      .maybeSingle();

    if (lectureError || !lectureData) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Lecture session not found",
      });
    }

    const coursesRaw = (lectureData as Record<string, unknown>).courses;
    const courseObj = Array.isArray(coursesRaw) ? coursesRaw[0] : coursesRaw;
    if (!courseObj || (courseObj as Record<string, unknown>).teacher_id !== actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden lecture access",
      });
    }

    const { data, error } = await this.client
      .from("poll_questions")
      .insert({
        id: validated.id,
        lecture_id: validated.lectureId,
        concept_id: validated.conceptId,
        question: validated.question,
        expected_answer: validated.expectedAnswer,
        status: "draft",
        generated_at: validated.generatedAt,
      })
      .select("id, lecture_id, concept_id, question, expected_answer, status, generated_at, activated_at, closed_at")
      .single();

    if (error || !data) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error inserting poll draft",
        cause: error,
      });
    }

    return mapPollQuestion(data as Record<string, unknown>);
  }

  async updateDraft(actor: ActorContext, pollId: UUID, input: PollDraftInput): Promise<PollQuestion> {
    const validatedInput = pollDraftInputSchema.parse(input);
    const pollContext = await this.getPoll(actor, pollId);

    if (actor.role !== "teacher") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can edit poll drafts",
      });
    }

    if (pollContext.lectureStatus !== "live") {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Lecture is not live",
      });
    }

    if (pollContext.poll.status !== "draft") {
      throw new AppError({
        code: "INVALID_POLL_STATUS",
        statusCode: 400,
        message: "Poll is not in draft status",
      });
    }

    const { data, error } = await this.client
      .from("poll_questions")
      .update({
        question: validatedInput.question,
        expected_answer: validatedInput.expectedAnswer,
      })
      .eq("id", pollId)
      .eq("status", "draft")
      .select("id, lecture_id, concept_id, question, expected_answer, status, generated_at, activated_at, closed_at")
      .maybeSingle();

    if (error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error updating poll draft",
        cause: error,
      });
    }

    if (!data) {
      throw new AppError({
        code: "INVALID_POLL_STATUS",
        statusCode: 400,
        message: "Poll is no longer in draft status",
      });
    }

    return mapPollQuestion(data as Record<string, unknown>);
  }

  async getResponseCount(actor: ActorContext, pollId: UUID): Promise<number> {
    await this.getPoll(actor, pollId);

    const result = await this.client
      .from("poll_responses")
      .select("id", { count: "exact", head: true })
      .eq("question_id", pollId);

    if (result.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error querying poll response count",
        cause: result.error,
      });
    }

    if (typeof result.count === "number" && result.count >= 0) {
      return result.count;
    }

    if (Array.isArray(result.data)) {
      return result.data.length;
    }

    throw new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Database returned invalid response count",
    });
  }

  async getLatestPolls(actor: ActorContext, lectureId: UUID): Promise<TeacherPollSnapshot> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can view teacher poll snapshot",
      });
    }

    const { data: lectureData, error: lectureError } = await this.client
      .from("lecture_sessions")
      .select("id, course_id, courses(teacher_id)")
      .eq("id", lectureId)
      .maybeSingle();

    if (lectureError || !lectureData) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Lecture session not found",
      });
    }

    const coursesRaw = (lectureData as Record<string, unknown>).courses;
    const courseObj = Array.isArray(coursesRaw) ? coursesRaw[0] : coursesRaw;
    if (!courseObj || (courseObj as Record<string, unknown>).teacher_id !== actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden lecture access",
      });
    }

    const { data, error } = await this.client
      .from("poll_questions")
      .select("id, lecture_id, concept_id, question, expected_answer, status, generated_at, activated_at, closed_at")
      .eq("lecture_id", lectureId);

    if (error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error querying lecture polls",
        cause: error,
      });
    }

    const rawRows = Array.isArray(data) ? data : [];
    const allPolls: PollQuestion[] = rawRows.map((r) => mapPollQuestion(r as Record<string, unknown>));

    const drafts = allPolls
      .filter((p) => p.status === "draft")
      .sort((a, b) => {
        const timeCmp = new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime();
        return timeCmp !== 0 ? timeCmp : a.id.localeCompare(b.id);
      });

    const actives = allPolls
      .filter((p) => p.status === "active")
      .sort((a, b) => {
        const timeA = a.activatedAt ? new Date(a.activatedAt).getTime() : 0;
        const timeB = b.activatedAt ? new Date(b.activatedAt).getTime() : 0;
        const timeCmp = timeB - timeA;
        return timeCmp !== 0 ? timeCmp : a.id.localeCompare(b.id);
      });

    const closeds = allPolls
      .filter((p) => p.status === "closed")
      .sort((a, b) => {
        const timeA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const timeB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        const timeCmp = timeB - timeA;
        return timeCmp !== 0 ? timeCmp : a.id.localeCompare(b.id);
      });

    const latestDraft = drafts[0] ?? null;
    const activePoll = actives[0] ?? null;
    const latestClosed = closeds[0] ?? null;

    const [draftCount, activeCount, closedCount] = await Promise.all([
      latestDraft ? this.getResponseCount(actor, latestDraft.id) : Promise.resolve(0),
      activePoll ? this.getResponseCount(actor, activePoll.id) : Promise.resolve(0),
      latestClosed ? this.getResponseCount(actor, latestClosed.id) : Promise.resolve(0),
    ]);

    return {
      lectureId,
      draft: latestDraft ? { poll: latestDraft, responseCount: draftCount } : null,
      active: activePoll ? { poll: activePoll, responseCount: activeCount } : null,
      closed: latestClosed ? { poll: latestClosed, responseCount: closedCount } : null,
    };
  }

  async getActivePoll(actor: ActorContext, lectureId: UUID): Promise<PublicPollQuestion | null> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    const { data: lectureData, error: lectureError } = await this.client
      .from("lecture_sessions")
      .select("id, course_id, courses(teacher_id)")
      .eq("id", lectureId)
      .maybeSingle();

    if (lectureError || !lectureData) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Lecture session not found",
      });
    }

    const courseId = (lectureData as Record<string, unknown>).course_id as UUID;
    const coursesRaw = (lectureData as Record<string, unknown>).courses;
    const courseObj = Array.isArray(coursesRaw) ? coursesRaw[0] : coursesRaw;
    const teacherId = courseObj ? (courseObj as Record<string, unknown>).teacher_id : undefined;

    if (actor.role === "teacher") {
      if (teacherId !== actor.teacherId) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Forbidden lecture access",
        });
      }
    } else if (actor.role === "student") {
      const isEnrolled = (actor.enrolledCourses ?? []).some((e) => e.courseId === courseId);
      if (!isEnrolled) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Forbidden lecture access",
        });
      }
    } else {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden lecture access",
      });
    }

    const { data, error } = await this.client
      .from("poll_questions")
      .select("id, lecture_id, concept_id, question, status, generated_at, activated_at, closed_at")
      .eq("lecture_id", lectureId)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error querying active poll",
        cause: error,
      });
    }

    if (!data) {
      return null;
    }

    const raw = data as Record<string, unknown>;
    const publicPoll: PublicPollQuestion = {
      id: raw.id as UUID,
      lectureId: raw.lecture_id as UUID,
      conceptId: raw.concept_id as UUID,
      question: String(raw.question ?? ""),
      status: raw.status as "active",
      generatedAt: new Date(String(raw.generated_at)).toISOString(),
      ...(raw.activated_at ? { activatedAt: new Date(String(raw.activated_at)).toISOString() } : {}),
      ...(raw.closed_at ? { closedAt: new Date(String(raw.closed_at)).toISOString() } : {}),
    };

    return publicPollQuestionSchema.parse(publicPoll);
  }

  async getEvaluatedResponses(
    actor: ActorContext,
    lectureId: UUID
  ): Promise<Array<{ answer: string; outcome: "correct" | "partial" | "wrong" }>> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can retrieve evaluated poll responses",
      });
    }

    const { data: pollsData, error: pollsErr } = await (
      this.client.from("poll_questions") as unknown as {
        select(cols: string): {
          eq(col: string, val: string): Promise<{ data: unknown; error: unknown }>;
        };
      }
    )
      .select("id")
      .eq("lecture_id", lectureId);

    if (pollsErr) {
      throw mapDatabaseError(pollsErr as { code?: string; message?: string });
    }

    if (!Array.isArray(pollsData) || pollsData.length === 0) {
      return [];
    }

    const pollIds = (pollsData as Array<{ id: string }>).map((p) => p.id);
    const results: Array<{ answer: string; outcome: "correct" | "partial" | "wrong" }> = [];

    for (const pollId of pollIds) {
      const { data: respData, error: respErr } = await (
        this.client.from("poll_responses") as unknown as {
          select(cols: string): {
            eq(col: string, val: string): {
              eq(col: string, val: string): Promise<{ data: unknown; error: unknown }>;
            };
          };
        }
      )
        .select("answer,evaluation")
        .eq("question_id", pollId)
        .eq("status", "evaluated");

      if (respErr) {
        throw mapDatabaseError(respErr as { code?: string; message?: string });
      }

      if (Array.isArray(respData)) {
        for (const row of respData as Array<{
          answer: string;
          evaluation: { outcome?: string } | null;
        }>) {
          const outcome = row.evaluation?.outcome;
          if (outcome === "correct" || outcome === "partial" || outcome === "wrong") {
            results.push({
              answer: row.answer,
              outcome,
            });
          }
        }
      }
    }

    return results;
  }
}
