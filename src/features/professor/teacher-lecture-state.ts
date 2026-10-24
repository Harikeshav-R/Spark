import type { LectureSession, TranscriptChunk } from "@/contracts/classroom";

/**
 * Merges current and incoming transcript chunks deterministically.
 * - Deduplicates by chunk ID.
 * - Incoming authoritative data wins, but a chunk event with empty detectedConceptIds
 *   will NOT wipe out non-empty concept IDs previously populated from a snapshot.
 * - Result is stably sorted by timestampSec ascending, then createdAt ascending, then ID.
 */
export function mergeTranscriptChunks(
  current: readonly TranscriptChunk[],
  incoming: readonly TranscriptChunk[]
): TranscriptChunk[] {
  const chunkMap = new Map<string, TranscriptChunk>();

  for (const chunk of current) {
    chunkMap.set(chunk.id, chunk);
  }

  for (const chunk of incoming) {
    const existing = chunkMap.get(chunk.id);
    if (!existing) {
      chunkMap.set(chunk.id, chunk);
      continue;
    }

    const detectedConceptIds =
      chunk.detectedConceptIds.length > 0
        ? chunk.detectedConceptIds
        : existing.detectedConceptIds;

    const speakerName = chunk.speakerName ?? existing.speakerName;

    chunkMap.set(chunk.id, {
      ...existing,
      ...chunk,
      speakerName,
      detectedConceptIds,
    });
  }

  return Array.from(chunkMap.values()).sort((a, b) => {
    if (a.timestampSec !== b.timestampSec) {
      return a.timestampSec - b.timestampSec;
    }
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    if (!isNaN(aTime) && !isNaN(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Calculates continuous elapsed seconds for a lecture session.
 * For completed sessions, locks to endedAt; for live sessions, uses current time.
 * Always returns a non-negative finite integer.
 */
export function getElapsedSeconds(lecture: LectureSession, nowMs: number): number {
  const startedMs = new Date(lecture.startedAt).getTime();
  if (isNaN(startedMs)) {
    return 0;
  }

  const endMs =
    lecture.status === "completed" && lecture.endedAt
      ? new Date(lecture.endedAt).getTime()
      : nowMs;

  if (isNaN(endMs)) {
    return 0;
  }

  const elapsedSeconds = Math.floor((endMs - startedMs) / 1000);
  return Math.max(0, elapsedSeconds);
}

/**
 * Formats a non-negative second count into HH:MM:SS with leading zeroes.
 */
export function formatElapsedTimer(totalSeconds: number): string {
  const validSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(validSeconds / 3600);
  const minutes = Math.floor((validSeconds % 3600) / 60);
  const seconds = validSeconds % 60;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
}
