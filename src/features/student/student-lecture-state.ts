import type { UUID } from "@/contracts/common";
import type { LectureSession, TranscriptChunk, LectureSnapshot } from "@/contracts/classroom";
import type {
  TranscriptChunkEvent,
  ConceptDetectedEvent,
  LectureEndedEvent,
} from "@/contracts/realtime";
import { mergeTranscriptChunks } from "@/features/professor/teacher-lecture-state";

export interface StudentLectureState {
  lecture: LectureSession;
  chunks: TranscriptChunk[];
  activeConceptIds: UUID[];
  lastConceptOccurredAt: string | null;
  seenEventIds: ReadonlySet<UUID>;
  eventRevision: number;
}

export type StudentLectureAction =
  | { type: "transcript:chunk"; payload: TranscriptChunkEvent }
  | { type: "lecture:concept-detected"; payload: ConceptDetectedEvent }
  | { type: "lecture:ended"; payload: LectureEndedEvent }
  | {
      type: "snapshot";
      payload: LectureSnapshot;
      requestedAtRevision: number;
      restoreActiveConcepts: boolean;
    };

function filterKnownConcepts(
  conceptIds: readonly UUID[],
  knownConceptIds: ReadonlySet<UUID>
): UUID[] {
  const result: UUID[] = [];
  const seen = new Set<UUID>();
  for (const id of conceptIds) {
    if (knownConceptIds.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

export function createStudentLectureState(
  snapshot: LectureSnapshot,
  knownConceptIds: ReadonlySet<UUID>
): StudentLectureState {
  const isCompleted = snapshot.lecture.status === "completed";
  const activeConceptIds = isCompleted
    ? []
    : filterKnownConcepts(snapshot.activeConceptIds, knownConceptIds);

  return {
    lecture: snapshot.lecture,
    chunks: mergeTranscriptChunks([], snapshot.recentChunks),
    activeConceptIds,
    lastConceptOccurredAt: null,
    seenEventIds: new Set<UUID>(),
    eventRevision: 0,
  };
}

export function reduceStudentLectureState(
  state: StudentLectureState,
  action: StudentLectureAction,
  knownConceptIds: ReadonlySet<UUID>
): StudentLectureState {
  // A completed lecture is terminal: no events or snapshots can mutate or revive it
  if (state.lecture.status === "completed") {
    return state;
  }

  switch (action.type) {
    case "transcript:chunk": {
      const { payload } = action;
      if (payload.lectureId !== state.lecture.id) {
        return state;
      }
      if (state.seenEventIds.has(payload.eventId)) {
        return state;
      }

      const chunk: TranscriptChunk = {
        id: payload.chunkId,
        lectureId: payload.lectureId,
        text: payload.text,
        timestampSec: payload.timestampSec,
        speakerName: payload.speakerName,
        detectedConceptIds: [],
        isSimulated: payload.isSimulated,
        createdAt: payload.occurredAt,
      };

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(payload.eventId);

      return {
        ...state,
        chunks: mergeTranscriptChunks(state.chunks, [chunk]),
        seenEventIds: nextSeen,
        eventRevision: state.eventRevision + 1,
      };
    }

    case "lecture:concept-detected": {
      const { payload } = action;
      if (payload.lectureId !== state.lecture.id) {
        return state;
      }
      if (state.seenEventIds.has(payload.eventId)) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(payload.eventId);

      // Check if event is strictly older than the last concept event processed
      if (state.lastConceptOccurredAt !== null) {
        const prevTime = new Date(state.lastConceptOccurredAt).getTime();
        const currTime = new Date(payload.occurredAt).getTime();
        if (!isNaN(prevTime) && !isNaN(currTime) && currTime < prevTime) {
          // Out-of-order older event: do not overwrite active concepts
          return {
            ...state,
            seenEventIds: nextSeen,
            eventRevision: state.eventRevision + 1,
          };
        }
      }

      const activeConceptIds = filterKnownConcepts(payload.conceptIds, knownConceptIds);

      return {
        ...state,
        activeConceptIds,
        lastConceptOccurredAt: payload.occurredAt,
        seenEventIds: nextSeen,
        eventRevision: state.eventRevision + 1,
      };
    }

    case "lecture:ended": {
      const { payload } = action;
      if (payload.lectureId !== state.lecture.id) {
        return state;
      }
      if (state.seenEventIds.has(payload.eventId)) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(payload.eventId);

      return {
        ...state,
        lecture: {
          ...state.lecture,
          status: "completed",
          endedAt: payload.endedAt,
        },
        activeConceptIds: [],
        seenEventIds: nextSeen,
        eventRevision: state.eventRevision + 1,
      };
    }

    case "snapshot": {
      const { payload, requestedAtRevision, restoreActiveConcepts } = action;
      if (payload.lecture.id !== state.lecture.id) {
        return state;
      }

      const mergedChunks = mergeTranscriptChunks(state.chunks, payload.recentChunks);

      if (payload.lecture.status === "completed") {
        return {
          ...state,
          lecture: payload.lecture,
          chunks: mergedChunks,
          activeConceptIds: [],
        };
      }

      // Live snapshot
      let activeConceptIds = state.activeConceptIds;
      if (restoreActiveConcepts && requestedAtRevision === state.eventRevision) {
        activeConceptIds = filterKnownConcepts(payload.activeConceptIds, knownConceptIds);
      }

      return {
        ...state,
        lecture: payload.lecture,
        chunks: mergedChunks,
        activeConceptIds,
      };
    }
  }
}
