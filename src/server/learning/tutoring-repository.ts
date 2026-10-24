import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActorContext, UUID, ISOTimestamp } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type { ConceptNode } from "../../contracts/course.js";
import type { TutoringMessage } from "../../contracts/learning.js";
import { tutoringMessageSchema } from "../../contracts/learning.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";

export interface TutoringSessionRecord {
  id: UUID;
  studentId: UUID;
  courseId: UUID;
  targetConcepts: UUID[];
  startedAt: ISOTimestamp;
  endedAt: ISOTimestamp | null;
}

export interface TutoringRepositoryPort {
  createSession(
    actor: ActorContext,
    sessionId: UUID,
    studentId: UUID,
    conceptIds: UUID[],
    startedAt: ISOTimestamp
  ): Promise<TutoringSessionRecord>;

  getSession(actor: ActorContext, sessionId: UUID): Promise<TutoringSessionRecord>;

  getConcept(actor: ActorContext, studentId: UUID, conceptId: UUID): Promise<ConceptNode>;

  listMessages(actor: ActorContext, sessionId: UUID): Promise<TutoringMessage[]>;

  insertMessage(actor: ActorContext, message: TutoringMessage): Promise<TutoringMessage>;

  getMessage(actor: ActorContext, sessionId: UUID, messageId: UUID): Promise<TutoringMessage>;
}

const sessionRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  target_concepts: z.array(uuidSchema),
  started_at: z.string().min(1),
  ended_at: z.string().nullable().optional(),
});

const messageRowSchema = z.object({
  id: uuidSchema,
  session_id: uuidSchema,
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  concept_id: uuidSchema.nullable().optional(),
  understanding_detected: z.boolean(),
  created_at: z.string().min(1),
});

const conceptRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
  label: z.string().min(1),
  description: z.string(),
  category: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  created_at: z.string().min(1),
});

const studentRowSchema = z.object({
  id: uuidSchema,
  auth_id: uuidSchema,
  course_id: uuidSchema,
});

// Any query builder shape compatible with SupabaseClient
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GenericDatabaseClient = any;

export class TutoringRepository implements TutoringRepositoryPort {
  private readonly client: GenericDatabaseClient;

  constructor(client: Pick<SupabaseClient, "from"> | GenericDatabaseClient) {
    this.client = client;
  }

  private requireStudentActor(actor: ActorContext): void {
    if (actor.role !== "student") {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Only students are authorized for tutoring operations",
      });
    }
  }

  private async verifyStudentEnrollment(
    actor: ActorContext,
    studentId: UUID
  ): Promise<{ studentId: UUID; courseId: UUID }> {
    this.requireStudentActor(actor);

    if (!uuidSchema.safeParse(studentId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid student ID format",
      });
    }

    const enrollment = actor.enrolledCourses.find((e) => e.studentId === studentId);
    if (!enrollment) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Student is not enrolled or unauthorized",
      });
    }

    let studentCheck;
    try {
      studentCheck = await this.client
        .from("students")
        .select("id, auth_id, course_id")
        .eq("id", studentId)
        .eq("auth_id", actor.authId)
        .eq("course_id", enrollment.courseId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to verify student enrollment",
        cause: err,
      });
    }

    if (studentCheck.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error verifying student enrollment",
        cause: studentCheck.error,
      });
    }

    if (!studentCheck.data) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Student enrollment is no longer valid",
      });
    }

    const parsed = studentRowSchema.safeParse(studentCheck.data);
    if (!parsed.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Malformed student record returned from database",
        cause: parsed.error,
      });
    }

    return { studentId: parsed.data.id, courseId: parsed.data.course_id };
  }

  async getSession(actor: ActorContext, sessionId: UUID): Promise<TutoringSessionRecord> {
    this.requireStudentActor(actor);

    if (!uuidSchema.safeParse(sessionId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid tutoring session ID format",
      });
    }

    if (!actor.enrolledCourses || actor.enrolledCourses.length === 0) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Actor has no active enrollments",
      });
    }

    const enrolledStudentIds = actor.enrolledCourses.map((e) => e.studentId);
    let studentsCheck;
    try {
      studentsCheck = await this.client
        .from("students")
        .select("id, auth_id, course_id")
        .eq("auth_id", actor.authId)
        .in("id", enrolledStudentIds);
    } catch (err) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to query student authorizations",
        cause: err,
      });
    }

    if (studentsCheck.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error verifying candidate student authorizations",
        cause: studentsCheck.error,
      });
    }

    const studentRows = Array.isArray(studentsCheck.data) ? studentsCheck.data : [];
    const studentCourseMap = new Map<UUID, UUID>();
    for (const raw of studentRows) {
      const parsed = studentRowSchema.safeParse(raw);
      if (parsed.success) {
        studentCourseMap.set(parsed.data.id, parsed.data.course_id);
      }
    }

    if (studentCourseMap.size === 0) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "No active verified enrollments found for actor",
      });
    }

    const verifiedStudentIds = Array.from(studentCourseMap.keys());

    let sessionResult;
    try {
      sessionResult = await this.client
        .from("tutoring_sessions")
        .select("id, student_id, target_concepts, started_at, ended_at")
        .eq("id", sessionId)
        .in("student_id", verifiedStudentIds)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to query tutoring session",
        cause: err,
      });
    }

    if (sessionResult.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error fetching tutoring session",
        cause: sessionResult.error,
      });
    }

    if (!sessionResult.data) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Tutoring session not found",
      });
    }

    const parsedSession = sessionRowSchema.safeParse(sessionResult.data);
    if (!parsedSession.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Malformed tutoring session row in database",
        cause: parsedSession.error,
      });
    }

    const row = parsedSession.data;
    const courseId = studentCourseMap.get(row.student_id);
    if (!courseId) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Corrupt session state: student course mapping missing",
      });
    }

    return {
      id: row.id,
      studentId: row.student_id,
      courseId,
      targetConcepts: row.target_concepts,
      startedAt: new Date(row.started_at).toISOString(),
      endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    };
  }

  async createSession(
    actor: ActorContext,
    sessionId: UUID,
    studentId: UUID,
    conceptIds: UUID[],
    startedAt: ISOTimestamp
  ): Promise<TutoringSessionRecord> {
    const { courseId } = await this.verifyStudentEnrollment(actor, studentId);

    if (!uuidSchema.safeParse(sessionId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid session ID format",
      });
    }

    if (!conceptIds || conceptIds.length === 0) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Target concept list cannot be empty",
      });
    }

    for (const cid of conceptIds) {
      if (!uuidSchema.safeParse(cid).success) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: `Invalid concept ID format: ${cid}`,
        });
      }
    }

    // Deduplicate target concepts while preserving first occurrence order
    const distinctConcepts: UUID[] = [];
    const seen = new Set<UUID>();
    for (const cid of conceptIds) {
      if (!seen.has(cid)) {
        seen.add(cid);
        distinctConcepts.push(cid);
      }
    }

    // Verify all concepts exist in this enrolled course
    let conceptsResult;
    try {
      conceptsResult = await this.client
        .from("concept_nodes")
        .select("id")
        .eq("course_id", courseId)
        .in("id", distinctConcepts);
    } catch (err) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to verify concept existence",
        cause: err,
      });
    }

    if (conceptsResult.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error querying target concepts",
        cause: conceptsResult.error,
      });
    }

    const foundConceptRows = Array.isArray(conceptsResult.data) ? conceptsResult.data : [];
    const foundConceptIds = new Set(foundConceptRows.map((r: { id: string }) => r.id));

    for (const cid of distinctConcepts) {
      if (!foundConceptIds.has(cid)) {
        throw new AppError({
          code: DomainErrorCode.NOT_FOUND,
          statusCode: 404,
          message: `Target concept ${cid} not found in authorized course`,
        });
      }
    }

    let insertResult;
    try {
      insertResult = await this.client
        .from("tutoring_sessions")
        .insert({
          id: sessionId,
          student_id: studentId,
          target_concepts: distinctConcepts,
          started_at: startedAt,
          ended_at: null,
        })
        .select("id, student_id, target_concepts, started_at, ended_at")
        .single();
    } catch (err) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to insert tutoring session",
        cause: err,
      });
    }

    if (insertResult.error) {
      const code = insertResult.error.code;
      if (code === "23505") {
        throw new AppError({
          code: DomainErrorCode.CONFLICT,
          statusCode: 409,
          message: "Tutoring session already exists",
          cause: insertResult.error,
        });
      }
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error creating tutoring session",
        cause: insertResult.error,
      });
    }

    const parsedSession = sessionRowSchema.safeParse(insertResult.data);
    if (!parsedSession.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Malformed created tutoring session record",
        cause: parsedSession.error,
      });
    }

    const row = parsedSession.data;
    return {
      id: row.id,
      studentId: row.student_id,
      courseId,
      targetConcepts: row.target_concepts,
      startedAt: new Date(row.started_at).toISOString(),
      endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    };
  }

  async getConcept(
    actor: ActorContext,
    studentId: UUID,
    conceptId: UUID
  ): Promise<ConceptNode> {
    const { courseId } = await this.verifyStudentEnrollment(actor, studentId);

    if (!uuidSchema.safeParse(conceptId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid concept ID format",
      });
    }

    let conceptResult;
    try {
      conceptResult = await this.client
        .from("concept_nodes")
        .select("id, course_id, label, description, category, difficulty, x, y")
        .eq("id", conceptId)
        .eq("course_id", courseId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to query concept node",
        cause: err,
      });
    }

    if (conceptResult.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error fetching concept node",
        cause: conceptResult.error,
      });
    }

    if (!conceptResult.data) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Concept node not found in student enrolled course",
      });
    }

    const parsed = conceptRowSchema.safeParse(conceptResult.data);
    if (!parsed.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Malformed concept record in database",
        cause: parsed.error,
      });
    }

    const row = parsed.data;
    return {
      id: row.id,
      courseId: row.course_id,
      label: row.label,
      description: row.description,
      category: row.category,
      difficulty: row.difficulty,
      x: row.x ?? undefined,
      y: row.y ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async listMessages(actor: ActorContext, sessionId: UUID): Promise<TutoringMessage[]> {
    await this.getSession(actor, sessionId);

    const pageSize = 1000;
    let offset = 0;
    const messages: TutoringMessage[] = [];

    while (true) {
      let pageResult;
      try {
        pageResult = await this.client
          .from("tutoring_messages")
          .select(
            "id, session_id, role, content, concept_id, understanding_detected, created_at"
          )
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
      } catch (err) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Failed to query tutoring messages",
          cause: err,
        });
      }

      if (pageResult.error) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Database error listing tutoring messages",
          cause: pageResult.error,
        });
      }

      const rows = Array.isArray(pageResult.data) ? pageResult.data : [];
      for (const raw of rows) {
        const parsed = messageRowSchema.safeParse(raw);
        if (!parsed.success) {
          throw new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: "Malformed tutoring message row in database",
            cause: parsed.error,
          });
        }
        const m = parsed.data;
        messages.push({
          id: m.id,
          sessionId: m.session_id,
          role: m.role,
          content: m.content,
          conceptId: m.concept_id ?? undefined,
          understandingDetected: m.understanding_detected,
          createdAt: new Date(m.created_at).toISOString(),
        });
      }

      if (rows.length < pageSize) {
        break;
      }
      offset += pageSize;
    }

    return messages;
  }

  async getMessage(
    actor: ActorContext,
    sessionId: UUID,
    messageId: UUID
  ): Promise<TutoringMessage> {
    await this.getSession(actor, sessionId);

    if (!uuidSchema.safeParse(messageId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid message ID format",
      });
    }

    let messageResult;
    try {
      messageResult = await this.client
        .from("tutoring_messages")
        .select(
          "id, session_id, role, content, concept_id, understanding_detected, created_at"
        )
        .eq("id", messageId)
        .eq("session_id", sessionId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to query tutoring message",
        cause: err,
      });
    }

    if (messageResult.error) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error retrieving tutoring message",
        cause: messageResult.error,
      });
    }

    if (!messageResult.data) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Tutoring message not found in session",
      });
    }

    const parsed = messageRowSchema.safeParse(messageResult.data);
    if (!parsed.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Malformed message row in database",
        cause: parsed.error,
      });
    }

    const m = parsed.data;
    return {
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      content: m.content,
      conceptId: m.concept_id ?? undefined,
      understandingDetected: m.understanding_detected,
      createdAt: new Date(m.created_at).toISOString(),
    };
  }

  async insertMessage(
    actor: ActorContext,
    message: TutoringMessage
  ): Promise<TutoringMessage> {
    const session = await this.getSession(actor, message.sessionId);

    const validatedMessage = tutoringMessageSchema.safeParse(message);
    if (!validatedMessage.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid tutoring message payload",
        cause: validatedMessage.error,
      });
    }

    if (message.conceptId) {
      if (!session.targetConcepts.includes(message.conceptId)) {
        throw new AppError({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: `Concept ${message.conceptId} is not in session target concepts`,
        });
      }

      await this.getConcept(actor, session.studentId, message.conceptId);
    }

    let insertResult;
    try {
      insertResult = await this.client
        .from("tutoring_messages")
        .insert({
          id: message.id,
          session_id: message.sessionId,
          role: message.role,
          content: message.content,
          concept_id: message.conceptId ?? null,
          understanding_detected: message.understandingDetected,
          created_at: message.createdAt,
        })
        .select(
          "id, session_id, role, content, concept_id, understanding_detected, created_at"
        )
        .single();
    } catch (err) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Failed to insert tutoring message",
        cause: err,
      });
    }

    if (insertResult.error) {
      const code = insertResult.error.code;
      if (code === "23505") {
        // Check if existing message has identical attributes
        const existing = await this.getMessage(actor, message.sessionId, message.id).catch(
          () => null
        );
        if (
          existing &&
          existing.sessionId === message.sessionId &&
          existing.role === message.role &&
          existing.content === message.content &&
          (existing.conceptId ?? undefined) === (message.conceptId ?? undefined) &&
          existing.understandingDetected === message.understandingDetected
        ) {
          return existing;
        }

        throw new AppError({
          code: DomainErrorCode.CONFLICT,
          statusCode: 409,
          message: "Tutoring message already exists with conflicting attributes",
          cause: insertResult.error,
        });
      }

      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error inserting tutoring message",
        cause: insertResult.error,
      });
    }

    const parsed = messageRowSchema.safeParse(insertResult.data);
    if (!parsed.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Malformed message row returned from database insert",
        cause: parsed.error,
      });
    }

    const m = parsed.data;
    return {
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      content: m.content,
      conceptId: m.concept_id ?? undefined,
      understandingDetected: m.understanding_detected,
      createdAt: new Date(m.created_at).toISOString(),
    };
  }
}
