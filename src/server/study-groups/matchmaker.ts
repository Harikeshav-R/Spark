import type { UUID } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import type { PoolEntry } from "./pool-repository.js";

export interface MatchProfile {
  studentId: UUID;
  name: string;
  confidences: ReadonlyMap<UUID, number>;
}

export interface ComplementaryCandidate {
  entry: PoolEntry;
  conceptIds: UUID[];
  gap: number;
}

export function findComplementaryCandidates(
  requester: PoolEntry,
  candidates: readonly PoolEntry[],
  profiles: ReadonlyMap<UUID, MatchProfile>,
  now: Date,
): ComplementaryCandidate[] {
  // Check requester eligibility
  const nowMs = now.getTime();
  const requesterExpiryMs = new Date(requester.expiresAt).getTime();
  if (requester.status !== "waiting" || requesterExpiryMs < nowMs) {
    return [];
  }

  const requesterProfile = profiles.get(requester.studentId);
  if (!requesterProfile) {
    return [];
  }

  const requesterConceptSet = new Set(requester.conceptIds);
  const eligible: ComplementaryCandidate[] = [];

  for (const candidate of candidates) {
    // Reject self
    if (
      candidate.id === requester.id ||
      candidate.studentId === requester.studentId
    ) {
      continue;
    }

    // Reject other course
    if (candidate.courseId !== requester.courseId) {
      continue;
    }

    // Reject non-waiting
    if (candidate.status !== "waiting") {
      continue;
    }

    // Reject expired entries (INV-C01: unexpired while expiresAt >= now)
    const candidateExpiryMs = new Date(candidate.expiresAt).getTime();
    if (candidateExpiryMs < nowMs) {
      continue;
    }

    const candidateProfile = profiles.get(candidate.studentId);
    if (!candidateProfile) {
      continue;
    }

    // Intersect unique requested concept IDs
    const candidateConceptSet = new Set(candidate.conceptIds);
    const sharedConcepts: UUID[] = [];
    for (const conceptId of requesterConceptSet) {
      if (candidateConceptSet.has(conceptId)) {
        sharedConcepts.push(conceptId);
      }
    }

    if (sharedConcepts.length === 0) {
      continue;
    }

    // Sort intersection lexicographically
    sharedConcepts.sort();

    // Check confidences for all shared concepts
    let hasAllConfidences = true;
    let totalDiff = 0;

    for (const conceptId of sharedConcepts) {
      const confA = requesterProfile.confidences.get(conceptId);
      const confB = candidateProfile.confidences.get(conceptId);

      // Do not substitute zero for missing mastery: omit pairing if either profile lacks confidence
      if (confA === undefined || confB === undefined) {
        hasAllConfidences = false;
        break;
      }

      // Validate confidence integrity: must be finite number in [0.0, 1.0]
      if (
        typeof confA !== "number" ||
        !Number.isFinite(confA) ||
        confA < 0 ||
        confA > 1 ||
        typeof confB !== "number" ||
        !Number.isFinite(confB) ||
        confB < 0 ||
        confB > 1
      ) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Invalid present confidence encountered in match profile",
        });
      }

      totalDiff += Math.abs(confA - confB);
    }

    if (!hasAllConfidences) {
      continue;
    }

    const gap = totalDiff / sharedConcepts.length;

    // Complementary iff gap >= 0.30; do not round scores before comparison
    if (gap >= 0.30) {
      eligible.push({
        entry: candidate,
        conceptIds: sharedConcepts,
        gap,
      });
    }
  }

  // Return candidates in createdAt ascending, then pool-entry ID ascending order
  eligible.sort((a, b) => {
    const timeA = new Date(a.entry.createdAt).getTime();
    const timeB = new Date(b.entry.createdAt).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return a.entry.id.localeCompare(b.entry.id);
  });

  return eligible;
}
