import type { UUID } from "../../../contracts/common.js";
import type { EclipseDTO, EclipseTargetDTO } from "../../../contracts/game.js";
import { confidenceToBand } from "../../../contracts/mastery.js";
import type { EdgeLike, NodeLike } from "./daily-quest-generator.js";
import { isConceptReady } from "./daily-quest-generator.js";

export interface EclipseCalculationInput {
  studentId: UUID;
  nodes: readonly NodeLike[];
  edges: readonly EdgeLike[];
  masteries: ReadonlyMap<UUID, number>;
  examAt: string | null;
}

/**
 * INV-XP07: Computes Eclipse review pressure toward upcoming exams across target concepts T.
 * 1. Target Selection: up to 3 lowest-confidence ready concepts where c < 0.70,
 *    sorted by confidence ascending, then UUID lexicographical ascending.
 * 2. Strength Calculation:
 *    strength = 0 if n = 0, else round(100 * sum(max(0, 0.70 - c_i)) / (n * 0.70)).
 */
export function calculateEclipse(input: EclipseCalculationInput): EclipseDTO {
  const { studentId, nodes, edges, masteries, examAt } = input;

  const candidateTargets: Array<{ id: UUID; confidence: number }> = [];

  for (const node of nodes) {
    const ready = isConceptReady(node.id, edges, masteries);
    if (!ready) {
      continue;
    }

    const confidence = masteries.get(node.id) ?? 0.0;
    if (confidence < 0.7) {
      candidateTargets.push({
        id: node.id,
        confidence,
      });
    }
  }

  // Sort by confidence ascending, then UUID ascending
  candidateTargets.sort((a, b) => {
    if (Math.abs(a.confidence - b.confidence) > 1e-6) {
      return a.confidence - b.confidence;
    }
    return a.id.localeCompare(b.id);
  });

  const selectedTargets = candidateTargets.slice(0, 3);
  const n = selectedTargets.length;

  let strength = 0;
  if (n > 0) {
    let sumDeficit = 0;
    for (const target of selectedTargets) {
      sumDeficit += Math.max(0, 0.7 - target.confidence);
    }
    const rawStrength = Math.round((100 * sumDeficit) / (n * 0.7));
    strength = Math.min(100, Math.max(0, rawStrength));
  }

  const targets: EclipseTargetDTO[] = selectedTargets.map((t) => ({
    conceptId: t.id,
    confidence: t.confidence,
    band: confidenceToBand(t.confidence),
  }));

  return {
    studentId,
    strength,
    targets,
    examAt,
  };
}
