import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { UUID } from "../../../contracts/common.js";
import { uuidSchema } from "../../../contracts/common.js";
import { AppError } from "../../../contracts/errors.js";
import { mapPostgrestError } from "../../platform/index.js";

const PAGE_SIZE = 500;

export interface DailyQuestRecord {
  id: UUID;
  studentId: UUID;
  questDate: string; // YYYY-MM-DD
  conceptIds: UUID[];
  completedIds: UUID[];
  clearedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudentRecord {
  id: UUID;
  authId: UUID;
  courseId: UUID;
  createdAt: string;
}

export interface PracticeRewardRpcResult {
  xpAwarded: number;
  quest: DailyQuestRecord | null;
  changed: boolean;
  updatedAt: string;
}

const dailyQuestRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  quest_date: z.string().min(1),
  concept_ids: z.array(uuidSchema),
  completed_ids: z.array(uuidSchema),
  cleared_at: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

const studentRowSchema = z.object({
  id: uuidSchema,
  auth_id: uuidSchema,
  course_id: uuidSchema,
  created_at: z.string().min(1),
});

const courseExamAtRowSchema = z.object({
  exam_at: z.string().nullable(),
});

const masteryEvidenceRowSchema = z.object({
  concept_id: uuidSchema,
  created_at: z.string().min(1),
});

const xpEventRowSchema = z.object({
  amount: z.number().int().positive(),
  created_at: z.string().min(1),
});

const rpcResponseSchema = z.object({
  xp_awarded: z.number().int().nonnegative(),
  quest: dailyQuestRowSchema.nullable(),
  changed: z.boolean(),
  updated_at: z.string().min(1),
});

function mapRpcError(errUnknown: unknown): AppError {
  const err = (errUnknown ?? {}) as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  const code = err.code ?? "";
  const message = err.message ?? "Database RPC error";

  if (code === "22023" || code === "22P02") {
    return new AppError({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message,
      cause: err,
    });
  }

  if (code === "P0002") {
    return new AppError({
      code: "NOT_FOUND",
      statusCode: 404,
      message,
      cause: err,
    });
  }

  if (code === "42501") {
    return new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message,
      cause: err,
    });
  }

  return mapPostgrestError(errUnknown, "Failed to execute progression RPC");
}

function rowToDailyQuestRecord(row: z.infer<typeof dailyQuestRowSchema>): DailyQuestRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    questDate: row.quest_date.slice(0, 10),
    conceptIds: row.concept_ids,
    completedIds: row.completed_ids,
    clearedAt: row.cleared_at ? new Date(row.cleared_at).toISOString() : null,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class GameRepository {
  constructor(private readonly client: Pick<SupabaseClient, "from" | "rpc">) {}

  async getStudent(studentId: UUID): Promise<StudentRecord> {
    const { data, error } = await this.client
      .from("students")
      .select("id, auth_id, course_id, created_at")
      .eq("id", studentId)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to query student");
    }

    if (!data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: `Student not found: ${studentId}`,
      });
    }

    const parsed = studentRowSchema.safeParse(data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed student record returned from database",
        cause: parsed.error,
      });
    }

    return {
      id: parsed.data.id,
      authId: parsed.data.auth_id,
      courseId: parsed.data.course_id,
      createdAt: new Date(parsed.data.created_at).toISOString(),
    };
  }

  async getCourseExamAt(courseId: UUID): Promise<string | null> {
    const { data, error } = await this.client
      .from("courses")
      .select("exam_at")
      .eq("id", courseId)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to query course exam date");
    }

    if (!data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: `Course not found: ${courseId}`,
      });
    }

    const parsed = courseExamAtRowSchema.safeParse(data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed course exam date returned from database",
        cause: parsed.error,
      });
    }

    return parsed.data.exam_at ? new Date(parsed.data.exam_at).toISOString() : null;
  }

  async getLatestCommittedReviews(
    studentId: UUID,
  ): Promise<Map<UUID, Date>> {
    const result = new Map<UUID, Date>();
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.client
        .from("mastery_evidence")
        .select("concept_id, created_at")
        .eq("student_id", studentId)
        .in("evidence_type", ["quiz", "tutor"])
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw mapPostgrestError(error, "Failed to query mastery evidence review history");
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const row of data) {
        const parsed = masteryEvidenceRowSchema.safeParse(row);
        if (!parsed.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Malformed mastery evidence record in database",
            cause: parsed.error,
          });
        }
        if (!result.has(parsed.data.concept_id)) {
          result.set(parsed.data.concept_id, new Date(parsed.data.created_at));
        }
      }

      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    }

    return result;
  }

  async getDailyQuestRow(
    studentId: UUID,
    questDate: string,
  ): Promise<DailyQuestRecord | null> {
    const { data, error } = await this.client
      .from("daily_quests")
      .select("id, student_id, quest_date, concept_ids, completed_ids, cleared_at, version, created_at, updated_at")
      .eq("student_id", studentId)
      .eq("quest_date", questDate)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to query daily quest");
    }

    if (data === null || data === undefined) {
      return null;
    }
    const parsed = dailyQuestRowSchema.safeParse(data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed daily quest row returned from database",
        cause: parsed.error,
      });
    }

    return rowToDailyQuestRecord(parsed.data);
  }

  async persistDailyQuestQueue(
    studentId: UUID,
    questDate: string,
    conceptIds: readonly UUID[],
  ): Promise<DailyQuestRecord> {
    // Attempt insert on conflict do nothing
    const { error: insertError } = await this.client
      .from("daily_quests")
      .insert({
        student_id: studentId,
        quest_date: questDate,
        concept_ids: [...conceptIds],
        completed_ids: [],
      });

    if (insertError) {
      const isObject = typeof insertError === "object" && insertError !== null;
      const errorCode = isObject && "code" in insertError && typeof insertError.code === "string"
        ? insertError.code
        : "";
      if (errorCode !== "23505") {
        throw mapPostgrestError(insertError, "Failed to insert daily quest queue");
      }
    }

    // Always fetch the winning row to guarantee deterministic winner
    const winningRow = await this.getDailyQuestRow(studentId, questDate);
    if (!winningRow) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to load winning daily quest record",
      });
    }

    return winningRow;
  }

  async getAllClearedQuests(
    studentId: UUID,
  ): Promise<DailyQuestRecord[]> {
    const result: DailyQuestRecord[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.client
        .from("daily_quests")
        .select("id, student_id, quest_date, concept_ids, completed_ids, cleared_at, version, created_at, updated_at")
        .eq("student_id", studentId)
        .not("cleared_at", "is", null)
        .order("quest_date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw mapPostgrestError(error, "Failed to query cleared daily quests");
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const row of data) {
        const parsed = dailyQuestRowSchema.safeParse(row);
        if (!parsed.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Malformed cleared daily quest row",
            cause: parsed.error,
          });
        }
        result.push(rowToDailyQuestRecord(parsed.data));
      }

      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    }

    return result;
  }

  async getTotalXpAndLatestTimestamp(
    studentId: UUID,
  ): Promise<{ totalXp: number; latestXpTimestamp: string | null }> {
    let totalXp = 0;
    let latestTimestamp: string | null = null;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.client
        .from("xp_events")
        .select("amount, created_at")
        .eq("student_id", studentId)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw mapPostgrestError(error, "Failed to query xp events");
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const row of data) {
        const parsed = xpEventRowSchema.safeParse(row);
        if (!parsed.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Malformed xp event row",
            cause: parsed.error,
          });
        }
        totalXp += parsed.data.amount;
        if (!latestTimestamp || new Date(parsed.data.created_at) > new Date(latestTimestamp)) {
          latestTimestamp = new Date(parsed.data.created_at).toISOString();
        }
      }

      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    }

    return { totalXp, latestXpTimestamp: latestTimestamp };
  }

  async getLatestQuestTimestamp(studentId: UUID): Promise<string | null> {
    const { data, error } = await this.client
      .from("daily_quests")
      .select("updated_at")
      .eq("student_id", studentId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to query latest quest timestamp");
    }

    return data?.updated_at ? new Date(data.updated_at).toISOString() : null;
  }

  async callRecordPracticeReward(
    actorAuthId: UUID,
    studentId: UUID,
    attemptId: UUID,
    answers: readonly { correct: boolean; hintsUsed: number }[],
    now: Date,
  ): Promise<PracticeRewardRpcResult> {
    const { data, error } = await this.client.rpc("record_practice_reward", {
      p_actor_auth_id: actorAuthId,
      p_student_id: studentId,
      p_attempt_id: attemptId,
      p_answers: answers as unknown as Record<string, unknown>[],
      p_now: now.toISOString(),
    });

    if (error) {
      throw mapRpcError(error);
    }

    const parsed = rpcResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed response returned from record_practice_reward RPC",
        cause: parsed.error,
      });
    }

    return {
      xpAwarded: parsed.data.xp_awarded,
      quest: parsed.data.quest ? rowToDailyQuestRecord(parsed.data.quest) : null,
      changed: parsed.data.changed,
      updatedAt: new Date(parsed.data.updated_at).toISOString(),
    };
  }
}
