import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  ActorContext,
  UUID,
} from "../../../contracts/common";
import { uuidSchema } from "../../../contracts/common";
import type {
  ConceptEdge,
  ConceptNode,
} from "../../../contracts/course";
import {
  conceptEdgeSchema,
  conceptNodeSchema,
} from "../../../contracts/course";
import { AppError } from "../../../contracts/errors";
import type { CourseRepository } from "../courses/course-repository";
import type { GraphNodeInput } from "./graph-validator";

export type GraphTopology = {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
};

const commitResultRowSchema = z.object({
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
});

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export class GraphRepository {
  constructor(
    private readonly client: Pick<SupabaseClient, "from" | "rpc">,
    private readonly courses: Pick<CourseRepository, "getCourse">,
  ) {}

  private mapDatabaseError(errUnknown: unknown, defaultMessage: string): AppError {
    const err = (errUnknown ?? {}) as PostgrestErrorLike;
    const code = err.code ?? "";
    const message = err.message ?? defaultMessage;

    if (code === "P0001") {
      if (message.includes("GRAPH_ALREADY_EXISTS")) {
        return new AppError({
          code: "GRAPH_ALREADY_EXISTS",
          statusCode: 409,
          message: "Course already has a committed knowledge graph",
          cause: err,
        });
      }
      if (message.startsWith("INVALID_GRAPH:")) {
        return new AppError({
          code: "UNPROCESSABLE_ENTITY",
          statusCode: 422,
          message,
          cause: err,
        });
      }
    }

    if (code === "P0002") {
      return new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: message || "Course or resource not found",
        cause: err,
      });
    }

    if (code === "42501") {
      return new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: message || "Permission denied",
        cause: err,
      });
    }

    if (code === "22023" || code === "22P02") {
      return new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: message || "Invalid input parameters",
        cause: err,
      });
    }

    if (code === "PGRST000" || code === "PGRST001" || code === "PGRST002") {
      return new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Database service unavailable",
        cause: err,
      });
    }

    return new AppError({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: message || defaultMessage,
      cause: err,
    });
  }

  async commitKnowledgeGraph(
    actor: ActorContext,
    courseId: UUID,
    nodes: GraphNodeInput[],
    edges: [string, string][],
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    if (actor.role !== "teacher") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can commit knowledge graphs",
      });
    }

    // Live authorization and ownership check
    await this.courses.getCourse(actor, courseId);

    let result: { data: unknown; error: unknown };
    try {
      result = await this.client.rpc("commit_knowledge_graph", {
        p_actor_auth_id: actor.authId,
        p_course_id: courseId,
        p_nodes: nodes,
        p_edges: edges,
      });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Database service unavailable during graph commit",
        cause: err,
      });
    }

    if (result.error) {
      throw this.mapDatabaseError(result.error, "Failed to commit knowledge graph");
    }

    const rows = Array.isArray(result.data) ? result.data : [result.data];
    if (rows.length !== 1 || !rows[0]) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database did not return inserted counts",
      });
    }

    const parsed = commitResultRowSchema.safeParse(rows[0]);
    if (!parsed.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid commit result format",
        cause: parsed.error,
      });
    }

    return {
      nodeCount: parsed.data.node_count,
      edgeCount: parsed.data.edge_count,
    };
  }

  async getTopology(actor: ActorContext, courseId: UUID): Promise<GraphTopology> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    // Authorize actor for this course
    await this.courses.getCourse(actor, courseId);

    let nodesResult;
    try {
      nodesResult = await this.client
        .from("concept_nodes")
        .select("id,course_id,label,description,category,difficulty,x,y,created_at")
        .eq("course_id", courseId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query concept nodes",
        cause: err,
      });
    }

    if (nodesResult.error) {
      throw this.mapDatabaseError(nodesResult.error, "Failed to fetch concept nodes");
    }

    if (!nodesResult.data || nodesResult.data.length === 0) {
      return { nodes: [], edges: [] };
    }

    const nodes: ConceptNode[] = nodesResult.data.map((row: Record<string, unknown>) => {
      const nodePayload: Record<string, unknown> = {
        id: row.id,
        courseId: row.course_id,
        label: row.label,
        description: row.description,
        category: row.category,
        difficulty: row.difficulty,
        createdAt: new Date(String(row.created_at)).toISOString(),
      };
      if (row.x !== null && row.x !== undefined) {
        nodePayload.x = Number(row.x);
      }
      if (row.y !== null && row.y !== undefined) {
        nodePayload.y = Number(row.y);
      }
      return conceptNodeSchema.parse(nodePayload);
    });

    let edgesResult;
    try {
      edgesResult = await this.client
        .from("concept_edges")
        .select("id,course_id,source_id,target_id,relationship,created_at")
        .eq("course_id", courseId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
    } catch (err) {
      throw new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to query concept edges",
        cause: err,
      });
    }

    if (edgesResult.error) {
      throw this.mapDatabaseError(edgesResult.error, "Failed to fetch concept edges");
    }

    const edges: ConceptEdge[] = (edgesResult.data ?? []).map((row: Record<string, unknown>) => {
      return conceptEdgeSchema.parse({
        id: row.id,
        courseId: row.course_id,
        sourceId: row.source_id,
        targetId: row.target_id,
        relationship: row.relationship,
        createdAt: new Date(String(row.created_at)).toISOString(),
      });
    });

    return { nodes, edges };
  }
}
