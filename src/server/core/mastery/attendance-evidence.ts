import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActorContext, UUID, MasteryBand } from "../../../contracts/common.js";
import { uuidSchema } from "../../../contracts/common.js";
import type { CourseService } from "../../../contracts/course.js";
import type { MasteryService } from "../../../contracts/mastery.js";
import { AppError } from "../../../contracts/errors.js";

export interface AttendanceEvidenceResult {
  studentId: UUID;
  conceptId: UUID;
  confidence: number;
  band: MasteryBand;
  attempts: number;
  version: number;
}

const lectureRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
  status: z.string(),
});

const transcriptChunkRowSchema = z.object({
  id: uuidSchema,
  lecture_id: uuidSchema,
});

const transcriptConceptRowSchema = z.object({
  concept_id: uuidSchema,
});

const idRowSchema = z.object({
  id: uuidSchema,
});

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

function mapPostgrestError(errUnknown: unknown, contextMessage: string): AppError {
  if (errUnknown instanceof AppError) {
    return errUnknown;
  }
  const err = (errUnknown ?? {}) as PostgrestErrorLike;
  const code = typeof err.code === "string" ? err.code : "";

  if (code === "PGRST000" || code === "PGRST001" || code === "PGRST002") {
    return new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: `${contextMessage}: Database service unavailable`,
      cause: errUnknown,
    });
  }

  if (code === "42501") {
    return new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: `${contextMessage}: Permission denied`,
      cause: errUnknown,
    });
  }

  if (code === "P0002") {
    return new AppError({
      code: "NOT_FOUND",
      statusCode: 404,
      message: `${contextMessage}: Record not found`,
      cause: errUnknown,
    });
  }

  return new AppError({
    code: "INTERNAL_SERVER_ERROR",
    statusCode: 500,
    message: `${contextMessage}: ${err.message || "Database error"}`,
    cause: errUnknown,
  });
}

export class AttendanceEvidenceService {
  constructor(
    private readonly client: Pick<SupabaseClient, "from">,
    private readonly courses: Pick<CourseService, "getCourse">,
    private readonly mastery: Pick<MasteryService, "applyEvidence">,
  ) {}

  async recordChunkAttendance(
    actor: ActorContext,
    courseId: UUID,
    lectureId: UUID,
    chunkId: UUID,
    studentIds: readonly UUID[],
  ): Promise<AttendanceEvidenceResult[]> {
    // 1. Role verification: owning teacher only
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Teacher actor authorization required for attendance recording",
      });
    }

    // 2. Validate input parameters
    const courseIdParsed = uuidSchema.safeParse(courseId);
    const lectureIdParsed = uuidSchema.safeParse(lectureId);
    const chunkIdParsed = uuidSchema.safeParse(chunkId);
    const studentIdsParsed = z.array(uuidSchema).safeParse(studentIds);

    if (
      !courseIdParsed.success ||
      !lectureIdParsed.success ||
      !chunkIdParsed.success ||
      !studentIdsParsed.success
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid UUID parameter provided for attendance recording",
      });
    }

    const validCourseId = courseIdParsed.data;
    const validLectureId = lectureIdParsed.data;
    const validChunkId = chunkIdParsed.data;
    const uniqueStudentIds = Array.from(new Set(studentIdsParsed.data));

    // 3. Verify course ownership via CourseService
    let course;
    try {
      course = await this.courses.getCourse(actor, validCourseId);
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to verify course authorization",
        cause: err,
      });
    }

    if (course.teacherId !== actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Actor does not own this course",
      });
    }

    // 4. Verify lecture session exists, belongs to course, and status is 'live'
    let lectureRes;
    try {
      lectureRes = await this.client
        .from("lecture_sessions")
        .select("id,course_id,status")
        .eq("id", validLectureId)
        .eq("course_id", validCourseId)
        .maybeSingle();
    } catch (err: unknown) {
      throw mapPostgrestError(err, "Failed to load lecture session");
    }

    if (lectureRes.error) {
      throw mapPostgrestError(lectureRes.error, "Failed to load lecture session");
    }

    if (!lectureRes.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Lecture session not found for this course",
      });
    }

    const lectureParsed = lectureRowSchema.safeParse(lectureRes.data);
    if (!lectureParsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed lecture session record in database",
      });
    }

    if (lectureParsed.data.status !== "live") {
      throw new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Attendance evidence requires a live lecture",
      });
    }

    // 5. Verify transcript chunk exists and belongs to lecture
    let chunkRes;
    try {
      chunkRes = await this.client
        .from("transcript_chunks")
        .select("id,lecture_id")
        .eq("id", validChunkId)
        .eq("lecture_id", validLectureId)
        .maybeSingle();
    } catch (err: unknown) {
      throw mapPostgrestError(err, "Failed to load transcript chunk");
    }

    if (chunkRes.error) {
      throw mapPostgrestError(chunkRes.error, "Failed to load transcript chunk");
    }

    if (!chunkRes.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Transcript chunk not found for this lecture",
      });
    }

    const chunkParsed = transcriptChunkRowSchema.safeParse(chunkRes.data);
    if (!chunkParsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed transcript chunk record in database",
      });
    }

    // 6. Read detected concepts from transcript_concepts
    let conceptsRes;
    try {
      conceptsRes = await this.client
        .from("transcript_concepts")
        .select("concept_id")
        .eq("transcript_chunk_id", validChunkId);
    } catch (err: unknown) {
      throw mapPostgrestError(err, "Failed to load transcript concepts");
    }

    if (conceptsRes.error) {
      throw mapPostgrestError(conceptsRes.error, "Failed to load transcript concepts");
    }

    const rawConcepts = Array.isArray(conceptsRes.data) ? conceptsRes.data : [];
    const conceptIds: UUID[] = [];
    for (const row of rawConcepts) {
      const parsed = transcriptConceptRowSchema.safeParse(row);
      if (!parsed.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Malformed transcript concept record in database",
        });
      }
      conceptIds.push(parsed.data.concept_id);
    }
    const uniqueConceptIds = Array.from(new Set(conceptIds));

    // 7. Check for empty student list or empty concept list
    if (uniqueStudentIds.length === 0 || uniqueConceptIds.length === 0) {
      return [];
    }

    // 8. Batch membership verification (all-or-nothing check before any write)
    let studentsCheckRes;
    try {
      studentsCheckRes = await this.client
        .from("students")
        .select("id")
        .eq("course_id", validCourseId)
        .in("id", uniqueStudentIds);
    } catch (err: unknown) {
      throw mapPostgrestError(err, "Failed to verify student enrollment");
    }

    if (studentsCheckRes.error) {
      throw mapPostgrestError(studentsCheckRes.error, "Failed to verify student enrollment");
    }

    const foundStudentRows = Array.isArray(studentsCheckRes.data) ? studentsCheckRes.data : [];
    const foundStudentIds = new Set(
      foundStudentRows.map((r) => {
        const parsed = idRowSchema.safeParse(r);
        if (!parsed.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Malformed student record returned from database",
          });
        }
        return parsed.data.id;
      }),
    );

    if (foundStudentIds.size !== uniqueStudentIds.length) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "One or more students are not enrolled in this course",
      });
    }

    let conceptsCheckRes;
    try {
      conceptsCheckRes = await this.client
        .from("concept_nodes")
        .select("id")
        .eq("course_id", validCourseId)
        .in("id", uniqueConceptIds);
    } catch (err: unknown) {
      throw mapPostgrestError(err, "Failed to verify concept ownership");
    }

    if (conceptsCheckRes.error) {
      throw mapPostgrestError(conceptsCheckRes.error, "Failed to verify concept ownership");
    }

    const foundConceptRows = Array.isArray(conceptsCheckRes.data) ? conceptsCheckRes.data : [];
    const foundConceptIds = new Set(
      foundConceptRows.map((r) => {
        const parsed = idRowSchema.safeParse(r);
        if (!parsed.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Malformed concept record returned from database",
          });
        }
        return parsed.data.id;
      }),
    );

    if (foundConceptIds.size !== uniqueConceptIds.length) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "One or more concepts do not belong to this course",
      });
    }

    // 9. Apply evidence sequentially for each (student, concept) pair
    const results: AttendanceEvidenceResult[] = [];
    for (const studentId of uniqueStudentIds) {
      for (const conceptId of uniqueConceptIds) {
        let outcome;
        try {
          outcome = await this.mastery.applyEvidence(
            actor,
            studentId,
            conceptId,
            { type: "attendance", sourceId: validChunkId },
          );
        } catch (err: unknown) {
          if (err instanceof AppError) throw err;
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Failed to apply attendance evidence",
            cause: err,
          });
        }

        results.push({
          studentId,
          conceptId,
          confidence: outcome.confidence,
          band: outcome.band,
          attempts: outcome.attempts,
          version: outcome.version,
        });
      }
    }

    return results;
  }
}
