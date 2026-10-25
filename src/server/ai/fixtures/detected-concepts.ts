import type { DetectConceptsCandidate, DetectedConcepts } from "../../../contracts/ai.js";
import type { UUID } from "../../../contracts/common.js";

export function fixtureDetectConcepts(
  chunkText: string,
  candidateConcepts: DetectConceptsCandidate[]
): DetectedConcepts {
  const textLower = chunkText.toLowerCase();
  const matchedIds: UUID[] = [];
  const seen = new Set<string>();

  for (const candidate of candidateConcepts) {
    if (candidate.label.length > 0 && textLower.includes(candidate.label.toLowerCase())) {
      if (!seen.has(candidate.id)) {
        seen.add(candidate.id);
        matchedIds.push(candidate.id);
      }
    }
  }

  return { conceptIds: matchedIds };
}
