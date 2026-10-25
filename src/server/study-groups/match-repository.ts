import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import { confidenceSchema } from "../../contracts/mastery.js";
import { mapPostgrestError } from "../platform/index.js";
import type { MatchProfile } from "./matchmaker.js";

const conceptNodeRowSchema = z.object({
  id: uuidSchema,
});

const studentRowSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
});

const masteryRowSchema = z.object({
  student_id: uuidSchema,
  concept_id: uuidSchema,
  confidence: confidenceSchema,
});

export class MatchRepository {
  private readonly client: Pick<SupabaseClient, "from" | "rpc">;

  constructor(client: Pick<SupabaseClient, "from" | "rpc">) {
    this.client = client;
  }

  async getCourseConceptIds(
    courseId: UUID,
    conceptIds: UUID[],
  ): Promise<UUID[]> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    if (conceptIds.length === 0) {
      return [];
    }

    for (const c of conceptIds) {
      if (!uuidSchema.safeParse(c).success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid concept ID format",
        });
      }
    }

    let result;
    try {
      result = await this.client
        .from("concept_nodes")
        .select("id")
        .eq("course_id", courseId)
        .in("id", conceptIds);
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query course concepts",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(
        result.error,
        "Database error querying course concepts",
      );
    }

    if (!Array.isArray(result.data)) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed concept nodes data",
      });
    }

    try {
      const parsed = z.array(conceptNodeRowSchema).parse(result.data);
      return parsed.map((r) => r.id);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid concept row structure",
        cause: err,
      });
    }
  }

  async getProfiles(
    courseId: UUID,
    studentIds: UUID[],
    conceptIds: UUID[],
  ): Promise<Map<UUID, MatchProfile>> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    if (studentIds.length === 0 || conceptIds.length === 0) {
      return new Map();
    }

    for (const s of studentIds) {
      if (!uuidSchema.safeParse(s).success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid student ID format",
        });
      }
    }

    for (const c of conceptIds) {
      if (!uuidSchema.safeParse(c).success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid concept ID format",
        });
      }
    }

    // 1. Fetch students belonging to this course
    let studentsResult;
    try {
      studentsResult = await this.client
        .from("students")
        .select("id, name")
        .eq("course_id", courseId)
        .in("id", studentIds);
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query students for match profiles",
        cause: err,
      });
    }

    if (studentsResult.error) {
      throw mapPostgrestError(
        studentsResult.error,
        "Database error querying students",
      );
    }

    if (!Array.isArray(studentsResult.data)) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed students data",
      });
    }

    let parsedStudents: Array<z.infer<typeof studentRowSchema>>;
    try {
      parsedStudents = z.array(studentRowSchema).parse(studentsResult.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid student row structure",
        cause: err,
      });
    }

    if (parsedStudents.length === 0) {
      return new Map();
    }

    const verifiedStudentIds = parsedStudents.map((s) => s.id);

    // 2. Fetch student_mastery for verified students and requested concepts
    let masteryResult;
    try {
      masteryResult = await this.client
        .from("student_mastery")
        .select("student_id, concept_id, confidence")
        .in("student_id", verifiedStudentIds)
        .in("concept_id", conceptIds);
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query mastery records for match profiles",
        cause: err,
      });
    }

    if (masteryResult.error) {
      throw mapPostgrestError(
        masteryResult.error,
        "Database error querying student mastery",
      );
    }

    if (!Array.isArray(masteryResult.data)) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed student mastery data",
      });
    }

    let parsedMastery: Array<z.infer<typeof masteryRowSchema>>;
    try {
      parsedMastery = z.array(masteryRowSchema).parse(masteryResult.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid student mastery row structure",
        cause: err,
      });
    }

    // Group confidences by studentId
    const confidencesByStudent = new Map<UUID, Map<UUID, number>>();
    for (const m of parsedMastery) {
      let map = confidencesByStudent.get(m.student_id);
      if (!map) {
        map = new Map();
        confidencesByStudent.set(m.student_id, map);
      }
      map.set(m.concept_id, m.confidence);
    }

    const profiles = new Map<UUID, MatchProfile>();
    for (const s of parsedStudents) {
      profiles.set(s.id, {
        studentId: s.id,
        name: s.name,
        confidences: confidencesByStudent.get(s.id) ?? new Map(),
      });
    }

    return profiles;
  }

  async claimMatch(
    courseId: UUID,
    studentA: UUID,
    studentB: UUID,
    conceptIds: UUID[],
  ): Promise<UUID | null> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }
    if (
      !uuidSchema.safeParse(studentA).success ||
      !uuidSchema.safeParse(studentB).success
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid student ID format",
      });
    }

    if (studentA === studentB) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Cannot match student with themselves",
      });
    }

    if (
      !Array.isArray(conceptIds) ||
      conceptIds.length < 1 ||
      conceptIds.length > 3
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Match requires between 1 and 3 concepts",
      });
    }

    for (const c of conceptIds) {
      if (!uuidSchema.safeParse(c).success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid concept ID format",
        });
      }
    }

    let result;
    try {
      result = await this.client.rpc("claim_and_create_match", {
        p_course_id: courseId,
        p_student_a: studentA,
        p_student_b: studentB,
        p_concept_ids: conceptIds,
      });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Study group matchmaking is unavailable",
        cause: err,
      });
    }

    if (result.error) {
      const errObj = result.error as { code?: string; message?: string };
      // Missing-function errors (PGRST202 or SQL 42883)
      if (
        errObj.code === "PGRST202" ||
        errObj.code === "42883" ||
        errObj.message?.includes("claim_and_create_match")
      ) {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Study group matchmaking is unavailable",
          cause: result.error,
        });
      }

      // 55000: 'Pool entries are not both waiting and unexpired' (contention / lost claim / cancelled / expired)
      if (
        errObj.code === "55000" ||
        errObj.message?.includes(
          "Pool entries are not both waiting and unexpired",
        )
      ) {
        return null;
      }

      throw mapPostgrestError(
        result.error,
        "Database error executing claim_and_create_match",
      );
    }

    if (result.data === null || result.data === undefined) {
      return null;
    }

    const parsedId = uuidSchema.safeParse(result.data);
    if (!parsedId.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid match ID format",
      });
    }

    return parsedId.data;
  }
}
