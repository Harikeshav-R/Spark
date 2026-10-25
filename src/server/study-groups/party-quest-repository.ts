import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ISOTimestamp, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import { mapPostgrestError } from "../platform/index.js";

export const partyQuestRowSchema = z.object({
  id: uuidSchema,
  match_id: uuidSchema,
  concept_ids: z.array(uuidSchema),
  status: z.enum(["active", "completed", "cancelled"]),
  version: z.number().int().positive(),
  created_at: z.union([z.string(), z.date()]),
  updated_at: z.union([z.string(), z.date()]),
  completed_at: z.union([z.string(), z.date()]).nullable(),
});

export type PartyQuestRow = z.infer<typeof partyQuestRowSchema>;

export const partyQuestProgressRowSchema = z.object({
  party_quest_id: uuidSchema,
  student_id: uuidSchema,
  concept_id: uuidSchema,
  quiz_attempt_id: uuidSchema,
  completed_at: z.union([z.string(), z.date()]),
});

export type PartyQuestProgressRow = z.infer<typeof partyQuestProgressRowSchema>;

export const matchRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
  student1_id: uuidSchema,
  student2_id: uuidSchema,
  concept_ids: z.array(uuidSchema),
  status: z.enum(["active", "completed", "cancelled"]),
});

export type MatchRow = z.infer<typeof matchRowSchema>;

const recordProgressRpcResultSchema = z.object({
  partyQuestId: uuidSchema,
  matchId: uuidSchema,
  status: z.enum(["active", "completed", "cancelled"]),
  version: z.number().int().positive(),
  completedPairs: z.number().int().nonnegative(),
  totalPairs: z.number().int().positive(),
  occurredAt: z.union([z.string(), z.date()]),
  changed: z.boolean(),
});

export interface RecordProgressRpcResult {
  partyQuestId: UUID;
  matchId: UUID;
  status: "active" | "completed" | "cancelled";
  version: number;
  completedPairs: number;
  totalPairs: number;
  occurredAt: ISOTimestamp;
  changed: boolean;
}

export class PartyQuestRepository {
  private readonly client: Pick<SupabaseClient, "from" | "rpc">;

  constructor(client: Pick<SupabaseClient, "from" | "rpc">) {
    this.client = client;
  }

  async getMatchById(matchId: UUID): Promise<MatchRow | null> {
    let result;
    try {
      result = await this.client
        .from("study_group_matches")
        .select("id, course_id, student1_id, student2_id, concept_ids, status")
        .eq("id", matchId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query study group match",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(
        result.error,
        "Database error querying study group match",
      );
    }

    if (!result.data) {
      return null;
    }

    const parsed = matchRowSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse study group match row",
        cause: parsed.error,
      });
    }

    return parsed.data;
  }

  async createPartyQuest(
    matchId: UUID,
    conceptIds: UUID[],
  ): Promise<{ partyQuestId: UUID; status: "active"; conceptIds: UUID[] }> {
    let result;
    try {
      result = await this.client
        .from("party_quests")
        .insert({
          match_id: matchId,
          concept_ids: conceptIds,
          status: "active",
          version: 1,
        })
        .select("id, status, concept_ids")
        .single();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to create party quest",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(
        result.error,
        "Database error creating party quest",
      );
    }

    const row = result.data as {
      id: string;
      status: "active";
      concept_ids: string[];
    };
    return {
      partyQuestId: row.id,
      status: "active",
      conceptIds: row.concept_ids,
    };
  }

  async getQuestsForMatch(matchId: UUID): Promise<PartyQuestRow[]> {
    let result;
    try {
      result = await this.client
        .from("party_quests")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query party quests",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(
        result.error,
        "Database error querying party quests",
      );
    }

    const parsed = z.array(partyQuestRowSchema).safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse party quest rows",
        cause: parsed.error,
      });
    }

    return parsed.data;
  }

  async getProgressForQuest(
    partyQuestId: UUID,
  ): Promise<PartyQuestProgressRow[]> {
    let result;
    try {
      result = await this.client
        .from("party_quest_progress")
        .select("*")
        .eq("party_quest_id", partyQuestId);
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query party quest progress",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(
        result.error,
        "Database error querying party quest progress",
      );
    }

    const parsed = z.array(partyQuestProgressRowSchema).safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse party quest progress rows",
        cause: parsed.error,
      });
    }

    return parsed.data;
  }

  async getQuestWithMatch(
    partyQuestId: UUID,
  ): Promise<{ quest: PartyQuestRow; match: MatchRow } | null> {
    let questResult;
    try {
      questResult = await this.client
        .from("party_quests")
        .select("*")
        .eq("id", partyQuestId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query party quest",
        cause: err,
      });
    }

    if (questResult.error) {
      throw mapPostgrestError(
        questResult.error,
        "Database error querying party quest",
      );
    }

    if (!questResult.data) {
      return null;
    }

    const questParsed = partyQuestRowSchema.safeParse(questResult.data);
    if (!questParsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse party quest row",
        cause: questParsed.error,
      });
    }

    const match = await this.getMatchById(questParsed.data.match_id);
    if (!match) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Parent match not found for party quest",
      });
    }

    return {
      quest: questParsed.data,
      match,
    };
  }

  async recordPartyProgressRpc(
    actorAuthId: UUID,
    partyQuestId: UUID,
    attemptId: UUID,
  ): Promise<RecordProgressRpcResult> {
    let result;
    try {
      result = await this.client.rpc("record_party_quest_progress", {
        p_actor_auth_id: actorAuthId,
        p_party_quest_id: partyQuestId,
        p_attempt_id: attemptId,
      });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Party quest progress service is unavailable",
        cause: err,
      });
    }

    if (result.error) {
      const err = result.error as { code?: string; message?: string };
      if (err.code === "42501") {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: err.message || "Forbidden party quest progress",
          cause: err,
        });
      }
      if (err.code === "55000") {
        throw new AppError({
          code: "CONFLICT",
          statusCode: 409,
          message: err.message || "Party quest conflict",
          cause: err,
        });
      }
      if (err.code === "22023") {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: err.message || "Invalid party quest progress parameter",
          cause: err,
        });
      }
      if (err.code === "P0002") {
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: err.message || "Party quest progress target not found",
          cause: err,
        });
      }

      throw mapPostgrestError(
        result.error,
        "Database error recording party quest progress",
      );
    }

    const parsed = recordProgressRpcResultSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse party quest progress RPC result",
        cause: parsed.error,
      });
    }

    const d = parsed.data;
    return {
      partyQuestId: d.partyQuestId,
      matchId: d.matchId,
      status: d.status,
      version: d.version,
      completedPairs: d.completedPairs,
      totalPairs: d.totalPairs,
      occurredAt:
        d.occurredAt instanceof Date
          ? d.occurredAt.toISOString()
          : new Date(d.occurredAt).toISOString(),
      changed: d.changed,
    };
  }
}
