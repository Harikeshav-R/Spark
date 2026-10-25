import type { UUID, ActorContext } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type { ConceptNode } from "../../contracts/course.js";
import type { LearningService } from "../../contracts/learning.js";
import { generatedLearningPageSchema } from "../../contracts/ai.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";
import type { GraphRepository } from "../core/index.js";
import { sanitizeLearningMarkdown } from "../ai/markdown/sanitize-learning-markdown.js";
import type { LearningPageRepositoryPort } from "./learning-page-repository.js";

export interface LearningPageServiceDependencies {
  courseId: UUID;
  topology: Pick<GraphRepository, "getTopology">;
  repository: LearningPageRepositoryPort;
  ai: {
    generateLearningPage(
      concept: ConceptNode,
      prerequisiteAncestors?: ConceptNode[]
    ): Promise<string>;
  };
}

export class LearningPageService implements Pick<LearningService, "getLearningPage"> {
  constructor(private readonly deps: LearningPageServiceDependencies) {}

  async getLearningPage(actor: ActorContext, conceptId: UUID): Promise<string> {
    const parsedCourseId = uuidSchema.safeParse(this.deps.courseId);
    const parsedConceptId = uuidSchema.safeParse(conceptId);

    if (!parsedCourseId.success || !parsedConceptId.success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid learning page identifier",
        cause: !parsedCourseId.success ? parsedCourseId.error : parsedConceptId.error,
      });
    }

    const courseId = parsedCourseId.data;
    const targetId = parsedConceptId.data;

    // 1. Authorize actor and load topology
    const topology = await this.deps.topology.getTopology(actor, courseId);

    // 2. Verify target concept exists in authorized course topology
    const targetConcept = topology.nodes.find((n) => n.id === targetId);
    if (!targetConcept) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Concept not found in authorized course",
      });
    }

    // 3. Check persistent cache
    const cached = await this.deps.repository.get(targetId);
    if (cached) {
      const sanitized = sanitizeLearningMarkdown(cached.content);
      const validated = generatedLearningPageSchema.safeParse({ content: sanitized });
      if (!validated.success) {
        throw new AppError({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Database returned malformed learning page",
          cause: validated.error,
        });
      }
      return validated.data.content;
    }

    // 4. Cache miss: traverse incoming prerequisite edges to collect transitive ancestors
    const incomingEdges = new Map<UUID, UUID[]>();
    for (const edge of topology.edges) {
      if (edge.relationship === "prerequisite") {
        const list = incomingEdges.get(edge.targetId) ?? [];
        list.push(edge.sourceId);
        incomingEdges.set(edge.targetId, list);
      }
    }

    const nodeMap = new Map<UUID, ConceptNode>();
    for (const node of topology.nodes) {
      nodeMap.set(node.id, node);
    }

    const visited = new Set<UUID>();
    const queue: UUID[] = incomingEdges.get(targetId) ? [...(incomingEdges.get(targetId) ?? [])] : [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId) || currentId === targetId) {
        continue;
      }
      visited.add(currentId);
      const parents = incomingEdges.get(currentId) ?? [];
      for (const parentId of parents) {
        if (!visited.has(parentId)) {
          queue.push(parentId);
        }
      }
    }

    const ancestors: ConceptNode[] = [];
    for (const ancestorId of visited) {
      const node = nodeMap.get(ancestorId);
      if (node) {
        ancestors.push(node);
      }
    }
    ancestors.sort((a, b) => a.id.localeCompare(b.id));

    // 5. Generate content via AI capability
    const generatedRaw = await this.deps.ai.generateLearningPage(targetConcept, ancestors);
    const sanitized = sanitizeLearningMarkdown(generatedRaw);
    const validated = generatedLearningPageSchema.safeParse({ content: sanitized });
    if (!validated.success) {
      throw new AppError({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
        message: "Learning page content is invalid after sanitization",
        cause: validated.error,
      });
    }

    // 6. Persist to cache and return persisted row content
    const persisted = await this.deps.repository.insert(targetId, validated.data.content);
    const sanitizedPersisted = sanitizeLearningMarkdown(persisted.content);
    const validatedPersisted = generatedLearningPageSchema.safeParse({ content: sanitizedPersisted });
    if (!validatedPersisted.success) {
      throw new AppError({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database returned malformed learning page",
        cause: validatedPersisted.error,
      });
    }

    return validatedPersisted.data.content;
  }
}
