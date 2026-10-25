import type { UUID } from "../../../contracts/common.js";
import type { DailyQuestItemDTO } from "../../../contracts/game.js";
import { confidenceToBand } from "../../../contracts/mastery.js";

export const OVERDUE_THRESHOLD_MS = 72 * 60 * 60 * 1000;

export interface EdgeLike {
  readonly sourceId: UUID;
  readonly targetId: UUID;
}

export interface NodeLike {
  readonly id: UUID;
}

export type ReviewState = "unreviewed" | "overdue" | "current";

/**
 * INV-XP03: A concept is ready if and only if all direct prerequisite ancestors
 * are mastered (confidence >= 0.70). Roots (in-degree = 0) are ready by definition.
 */
export function isConceptReady(
  conceptId: UUID,
  edges: readonly EdgeLike[],
  masteries: ReadonlyMap<UUID, number>,
): boolean {
  const directPrereqEdges = edges.filter((e) => e.targetId === conceptId);
  if (directPrereqEdges.length === 0) {
    return true;
  }

  for (const edge of directPrereqEdges) {
    const prereqConfidence = masteries.get(edge.sourceId) ?? 0.0;
    if (prereqConfidence < 0.7) {
      return false;
    }
  }

  return true;
}

/**
 * Computes review state based on latest committed quiz or tutor review.
 * Older than 72 hours => "overdue", exactly 72h or newer => "current", missing => "unreviewed".
 */
export function computeReviewState(
  latestReviewAt: Date | null | undefined,
  now: Date,
): ReviewState {
  if (!latestReviewAt) {
    return "unreviewed";
  }

  const diffMs = now.getTime() - latestReviewAt.getTime();
  if (diffMs > OVERDUE_THRESHOLD_MS) {
    return "overdue";
  }

  return "current";
}

export function hasOverduePriority(reviewState: ReviewState): boolean {
  return reviewState === "unreviewed" || reviewState === "overdue";
}

export interface CandidateConcept {
  id: UUID;
  confidence: number;
  reviewState: ReviewState;
  hasOverduePriority: boolean;
  importance: number;
}

/**
 * INV-XP04: Selects up to 3 candidate concepts for daily quest:
 * - Ready concepts in the course that are either under-confident (c < 0.70) OR overdue/unreviewed.
 * - Deterministic ordering:
 *   1. Review urgency: Overdue-priority first (true precedes false)
 *   2. Confidence ascending: lowest confidence first
 *   3. Graph importance descending: highest prerequisite importance first
 *   4. Lexicographical UUID ascending tie-break
 */
export interface SelectDailyQuestCandidatesInput {
  readonly nodes: readonly NodeLike[];
  readonly edges: readonly EdgeLike[];
  readonly masteries: ReadonlyMap<UUID, number>;
  readonly latestReviews: ReadonlyMap<UUID, Date>;
  readonly importanceMap: ReadonlyMap<UUID, number>;
  readonly now: Date;
}

export function selectDailyQuestCandidates(
  input: SelectDailyQuestCandidatesInput,
): UUID[] {
  const { nodes, edges, masteries, latestReviews, importanceMap, now } = input;
  const candidates: CandidateConcept[] = [];

  for (const node of nodes) {
    const ready = isConceptReady(node.id, edges, masteries);
    if (!ready) {
      continue;
    }

    const confidence = masteries.get(node.id) ?? 0.0;
    const reviewState = computeReviewState(latestReviews.get(node.id), now);
    const overduePriority = hasOverduePriority(reviewState);

    // Candidate set: ready concepts that are either under-confident (c < 0.70) OR overdue
    if (confidence < 0.7 || overduePriority) {
      candidates.push({
        id: node.id,
        confidence,
        reviewState,
        hasOverduePriority: overduePriority,
        importance: importanceMap.get(node.id) ?? 0.5,
      });
    }
  }

  candidates.sort((a, b) => {
    // 1. Review urgency: overdue-priority first
    if (a.hasOverduePriority !== b.hasOverduePriority) {
      return a.hasOverduePriority ? -1 : 1;
    }

    // 2. Confidence ascending
    if (Math.abs(a.confidence - b.confidence) > 1e-6) {
      return a.confidence - b.confidence;
    }

    // 3. Graph importance descending
    if (Math.abs(a.importance - b.importance) > 1e-6) {
      return b.importance - a.importance;
    }

    // 4. UUID ascending
    return a.id.localeCompare(b.id);
  });

  return candidates.slice(0, 3).map((c) => c.id);
}

/**
 * Hydrates persisted daily quest items with current academic state.
 */
export function hydrateDailyQuestItems(
  conceptIds: readonly UUID[],
  completedIds: readonly UUID[],
  masteries: ReadonlyMap<UUID, number>,
  latestReviews: ReadonlyMap<UUID, Date>,
  now: Date,
): DailyQuestItemDTO[] {
  const completedSet = new Set(completedIds);

  return conceptIds.map((conceptId) => {
    const confidence = masteries.get(conceptId) ?? 0.0;
    const band = confidenceToBand(confidence);
    const reviewState = computeReviewState(latestReviews.get(conceptId), now);
    const completed = completedSet.has(conceptId);

    return {
      conceptId,
      confidence,
      band,
      reviewState,
      completed,
    };
  });
}
