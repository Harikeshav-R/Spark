import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ISOTimestamp, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import { mapPostgrestError } from "../platform/index.js";

const invitationRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
  inviter_student_id: uuidSchema,
  invitee_student_id: uuidSchema,
  concept_ids: z.array(uuidSchema),
  status: z.enum(["pending", "accepted", "declined", "expired"]),
  resulting_match_id: uuidSchema.nullable(),
  expires_at: z.union([z.string(), z.date()]),
  created_at: z.union([z.string(), z.date()]),
});

const conceptLabelRowSchema = z.object({
  id: uuidSchema,
  label: z.string(),
});

const respondRpcResultSchema = z.object({
  status: z.enum(["accepted", "declined", "expired"]),
  matchId: uuidSchema.nullable().optional(),
  changed: z.boolean(),
});

export interface CreateInvitationInput {
  courseId: UUID;
  inviterStudentId: UUID;
  inviteeStudentId: UUID;
  conceptIds: UUID[];
  expiresAt: ISOTimestamp;
}

export interface RespondRpcResult {
  status: "accepted" | "declined" | "expired";
  matchId?: UUID;
  changed: boolean;
}

export class InvitationsRepository {
  private readonly client: Pick<SupabaseClient, "from" | "rpc">;

  constructor(client: Pick<SupabaseClient, "from" | "rpc">) {
    this.client = client;
  }

  async createInvitation(
    input: CreateInvitationInput,
  ): Promise<{ invitationId: UUID; expiresAt: ISOTimestamp }> {
    let result;
    try {
      result = await this.client
        .from("study_group_invitations")
        .insert({
          course_id: input.courseId,
          inviter_student_id: input.inviterStudentId,
          invitee_student_id: input.inviteeStudentId,
          concept_ids: input.conceptIds,
          status: "pending",
          expires_at: input.expiresAt,
        })
        .select("id, expires_at")
        .single();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to persist study group invitation",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(
        result.error,
        "Database error persisting study group invitation",
      );
    }

    const row = result.data as { id: string; expires_at: string | Date };
    return {
      invitationId: row.id,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  async respondToInvitation(
    actorAuthId: UUID,
    invitationId: UUID,
    decision: "accepted" | "declined",
  ): Promise<RespondRpcResult> {
    let result;
    try {
      result = await this.client.rpc("respond_study_group_invitation", {
        p_actor_auth_id: actorAuthId,
        p_invitation_id: invitationId,
        p_decision: decision,
      });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Study group invitation response service is unavailable",
        cause: err,
      });
    }

    if (result.error) {
      const err = result.error as { code?: string; message?: string };
      if (err.code === "42501") {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: err.message || "Forbidden invitation response",
          cause: err,
        });
      }
      if (err.code === "55000") {
        throw new AppError({
          code: "CONFLICT",
          statusCode: 409,
          message: err.message || "Invitation conflict",
          cause: err,
        });
      }
      if (err.code === "22023") {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: err.message || "Invalid invitation response parameter",
          cause: err,
        });
      }
      if (err.code === "P0002") {
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: err.message || "Invitation not found",
          cause: err,
        });
      }

      throw mapPostgrestError(
        result.error,
        "Database error responding to study group invitation",
      );
    }

    const parsed = respondRpcResultSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse invitation response RPC outcome",
        cause: parsed.error,
      });
    }

    return {
      status: parsed.data.status,
      matchId: parsed.data.matchId ?? undefined,
      changed: parsed.data.changed,
    };
  }

  async getConceptLabels(
    courseId: UUID,
    conceptIds: UUID[],
  ): Promise<Map<UUID, string>> {
    if (conceptIds.length === 0) {
      return new Map();
    }

    let result;
    try {
      result = await this.client
        .from("concept_nodes")
        .select("id, label")
        .eq("course_id", courseId)
        .in("id", conceptIds);
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query concept labels",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(
        result.error,
        "Database error querying concept labels",
      );
    }

    const parsed = z.array(conceptLabelRowSchema).safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse concept labels",
        cause: parsed.error,
      });
    }

    const map = new Map<UUID, string>();
    for (const row of parsed.data) {
      map.set(row.id, row.label);
    }
    return map;
  }

  async getInvitationById(invitationId: UUID) {
    let result;
    try {
      result = await this.client
        .from("study_group_invitations")
        .select("*")
        .eq("id", invitationId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query invitation",
        cause: err,
      });
    }

    if (result.error) {
      throw mapPostgrestError(result.error, "Database error querying invitation");
    }

    if (!result.data) {
      return null;
    }

    const parsed = invitationRowSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to parse invitation record",
        cause: parsed.error,
      });
    }

    return parsed.data;
  }
}
