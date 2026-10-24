import type {
  ActorContext,
  MasteryBand,
  UUID,
} from "../../../contracts/common";
import { uuidSchema } from "../../../contracts/common";
import type {
  ConceptEdge,
  ConceptNode,
  GraphService as GraphServicePort,
} from "../../../contracts/course";
import { AppError } from "../../../contracts/errors";
import type { StudentMastery } from "../../../contracts/mastery";
import { confidenceToBand } from "../../../contracts/mastery";
import type { MasteryRepository } from "../mastery/mastery-repository";
import type { GraphRepository } from "./graph-repository";
import { validateGraph } from "./graph-validator";
import { calculateNodeImportance } from "./importance-calculator";

export class GraphService implements GraphServicePort {
  constructor(
    private readonly actor: ActorContext,
    private readonly repository: Pick<GraphRepository, "getTopology" | "commitKnowledgeGraph">,
    private readonly mastery: Pick<MasteryRepository, "getMastery">,
  ) {}

  private verifyBoundActor(actor: ActorContext): void {
    if (actor.authId !== this.actor.authId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Actor mismatch: service is bound to a different authenticated actor",
      });
    }
  }

  async validateGraph(
    nodes: Omit<ConceptNode, "id" | "courseId" | "createdAt">[],
    edges: [string, string][],
  ): Promise<boolean> {
    return validateGraph(nodes, edges);
  }

  async commitKnowledgeGraph(
    actor: ActorContext,
    courseId: UUID,
    nodes: Omit<ConceptNode, "id" | "courseId" | "createdAt">[],
    edges: [string, string][],
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    this.verifyBoundActor(actor);

    if (this.actor.role !== "teacher") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can commit knowledge graphs",
      });
    }

    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    // Pre-validate topology, cycle detection, and input bounds
    await this.validateGraph(nodes, edges);

    return this.repository.commitKnowledgeGraph(this.actor, courseId, nodes, edges);
  }

  async calculateImportance(courseId: UUID): Promise<Map<UUID, number>> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    const topology = await this.repository.getTopology(this.actor, courseId);
    return calculateNodeImportance(topology.nodes, topology.edges);
  }

  async getCourseGraph(
    actor: ActorContext,
    courseId: UUID,
  ): Promise<{
    nodes: (ConceptNode & { importance: number; confidence?: number; band?: MasteryBand })[];
    edges: ConceptEdge[];
  }> {
    this.verifyBoundActor(actor);

    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    const topology = await this.repository.getTopology(this.actor, courseId);
    const importanceMap = calculateNodeImportance(topology.nodes, topology.edges);

    if (this.actor.role === "teacher") {
      const teacherNodes = topology.nodes.map((node) => ({
        ...node,
        importance: importanceMap.get(node.id) ?? 0,
      }));
      return { nodes: teacherNodes, edges: topology.edges };
    }

    // Student role projection
    const enrollment = this.actor.enrolledCourses.find((e) => e.courseId === courseId);
    if (!enrollment) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Student is not enrolled in this course",
      });
    }

    const masteryList = await this.mastery.getMastery(this.actor, enrollment.studentId);
    const masteryByConcept = new Map<UUID, StudentMastery>();
    for (const record of masteryList) {
      masteryByConcept.set(record.conceptId, record);
    }

    const studentNodes = topology.nodes.map((node) => {
      const record = masteryByConcept.get(node.id);
      const enriched: ConceptNode & { importance: number; confidence?: number; band?: MasteryBand } = {
        ...node,
        importance: importanceMap.get(node.id) ?? 0,
      };
      if (record !== undefined) {
        enriched.confidence = record.confidence;
        enriched.band = confidenceToBand(record.confidence);
      }
      return enriched;
    });

    return { nodes: studentNodes, edges: topology.edges };
  }
}
