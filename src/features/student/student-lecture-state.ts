import type { z } from "zod";
import type { UUID } from "@/contracts/common";
import type {
  LectureSession,
  TranscriptChunk,
  LectureSnapshot,
  PublicPollQuestion,
  PollResponseResult,
} from "@/contracts/classroom";
import type {
  TranscriptChunkEvent,
  ConceptDetectedEvent,
  LectureEndedEvent,
  PollNewQuestionEvent,
  PollClosedEvent,
  MasteryUpdatedEvent,
} from "@/contracts/realtime";
import type { courseGraphResponseSchema } from "@/contracts/course";
import { mergeTranscriptChunks } from "@/features/professor/teacher-lecture-state";
import { getPollOutcomeMood, type SparkMood } from "@/features/mascot/spark-moods";
export type StudentPollQuestion = Pick<
  PublicPollQuestion,
  "id" | "lectureId" | "conceptId" | "question" | "activatedAt"
>;

export type StudentPollSubmission =
  | { status: "idle" }
  | { status: "submitting"; submittedAnswer: string }
  | { status: "evaluated"; submittedAnswer: string; result: PollResponseResult }
  | { status: "error"; submittedAnswer: string; code: string; message: string };

export interface StudentPollState {
  question: StudentPollQuestion | null;
  isActive: boolean;
  isOpen: boolean;
  answer: string;
  submission: StudentPollSubmission;
  closedPollIds: ReadonlySet<UUID>;
  lastActivatedAt: string | null;
}

export interface StudentLectureState {
  lecture: LectureSession;
  chunks: TranscriptChunk[];
  activeConceptIds: UUID[];
  lastConceptOccurredAt: string | null;
  seenEventIds: ReadonlySet<UUID>;
  eventRevision: number;
  poll: StudentPollState;
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
    }
  | { type: "poll:new-question"; payload: PollNewQuestionEvent }
  | { type: "poll:closed"; payload: PollClosedEvent }
  | { type: "poll:answer-changed"; pollId: UUID; answer: string }
  | { type: "poll:open"; pollId: UUID }
  | { type: "poll:dismiss"; pollId: UUID }
  | { type: "poll:submit-start"; pollId: UUID; answer: string }
  | { type: "poll:submit-success"; pollId: UUID; result: PollResponseResult }
  | { type: "poll:submit-error"; pollId: UUID; code: string; message: string };
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

  const hasMatchingActivePoll =
    !isCompleted &&
    Boolean(snapshot.activePoll) &&
    snapshot.activePoll?.lectureId === snapshot.lecture.id;

  const poll: StudentPollState = {
    question:
      hasMatchingActivePoll && snapshot.activePoll
        ? {
            id: snapshot.activePoll.id,
            lectureId: snapshot.activePoll.lectureId,
            conceptId: snapshot.activePoll.conceptId,
            question: snapshot.activePoll.question,
            activatedAt: snapshot.activePoll.activatedAt,
          }
        : null,
    isActive: hasMatchingActivePoll,
    isOpen: hasMatchingActivePoll,
    answer: "",
    submission: { status: "idle" },
    closedPollIds: new Set<UUID>(),
    lastActivatedAt: hasMatchingActivePoll ? snapshot.activePoll?.activatedAt ?? null : null,
  };

  return {
    lecture: snapshot.lecture,
    chunks: mergeTranscriptChunks([], snapshot.recentChunks),
    activeConceptIds,
    lastConceptOccurredAt: null,
    seenEventIds: new Set<UUID>(),
    eventRevision: 0,
    poll,
  };
}

export function reduceStudentLectureState(
  state: StudentLectureState,
  action: StudentLectureAction,
  knownConceptIds: ReadonlySet<UUID>
): StudentLectureState {
  // A completed lecture is terminal: no events or snapshots can mutate or revive it
  if (state.lecture.status === "completed") {
    // Allow in-flight response settlements to complete after lecture ended
    if (action.type !== "poll:submit-success" && action.type !== "poll:submit-error") {
      return state;
    }
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
        poll: {
          ...state.poll,
          isActive: false,
          isOpen: false,
        },
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
          poll: {
            ...state.poll,
            isActive: false,
            isOpen: false,
          },
        };
      }

      // Live snapshot
      let activeConceptIds = state.activeConceptIds;
      if (restoreActiveConcepts && requestedAtRevision === state.eventRevision) {
        activeConceptIds = filterKnownConcepts(payload.activeConceptIds, knownConceptIds);
      }

      let nextPoll = state.poll;
      if (requestedAtRevision === state.eventRevision) {
        if (!payload.activePoll) {
          // Authoritative null activePoll closes the dialog without erasing pending/evaluated response data
          nextPoll = {
            ...state.poll,
            isActive: false,
            isOpen: false,
          };
        } else if (payload.activePoll.lectureId === state.lecture.id) {
          const snapshotPoll = payload.activePoll;
          if (state.poll.closedPollIds.has(snapshotPoll.id)) {
            // Do not allow a tombstoned poll to reopen
            nextPoll = {
              ...state.poll,
              isActive: false,
              isOpen: false,
            };
          } else if (state.poll.question?.id === snapshotPoll.id) {
            // Duplicate activation/same-poll snapshot preserves current answer, dismissal, in-flight state, and result
            nextPoll = state.poll;
          } else {
            // Genuinely new poll: check stale activation
            const isStale =
              state.poll.lastActivatedAt !== null &&
              Boolean(snapshotPoll.activatedAt) &&
              new Date(snapshotPoll.activatedAt!).getTime() <
                new Date(state.poll.lastActivatedAt).getTime();

            if (!isStale) {
              nextPoll = {
                question: {
                  id: snapshotPoll.id,
                  lectureId: snapshotPoll.lectureId,
                  conceptId: snapshotPoll.conceptId,
                  question: snapshotPoll.question,
                  activatedAt: snapshotPoll.activatedAt,
                },
                isActive: true,
                isOpen: true,
                answer: "",
                submission: { status: "idle" },
                closedPollIds: state.poll.closedPollIds,
                lastActivatedAt: snapshotPoll.activatedAt ?? state.poll.lastActivatedAt,
              };
            }
          }
        }
      }

      return {
        ...state,
        lecture: payload.lecture,
        chunks: mergedChunks,
        activeConceptIds,
        poll: nextPoll,
      };
    }
    case "poll:new-question": {
      const { payload } = action;
      if (payload.lectureId !== state.lecture.id) {
        return state;
      }
      if (state.seenEventIds.has(payload.eventId)) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(payload.eventId);

      // Ignore tombstoned poll
      if (state.poll.closedPollIds.has(payload.pollId)) {
        return {
          ...state,
          seenEventIds: nextSeen,
          eventRevision: state.eventRevision + 1,
        };
      }

      // Stale activation check
      if (state.poll.lastActivatedAt !== null) {
        const prevTime = new Date(state.poll.lastActivatedAt).getTime();
        const currTime = new Date(payload.activatedAt).getTime();
        if (!isNaN(prevTime) && !isNaN(currTime) && currTime < prevTime) {
          return {
            ...state,
            seenEventIds: nextSeen,
            eventRevision: state.eventRevision + 1,
          };
        }
      }

      // Duplicate activation of current poll preserves current answer, dismissal, in-flight state, and result
      if (state.poll.question?.id === payload.pollId) {
        return {
          ...state,
          seenEventIds: nextSeen,
          eventRevision: state.eventRevision + 1,
        };
      }

      return {
        ...state,
        poll: {
          question: {
            id: payload.pollId,
            lectureId: payload.lectureId,
            conceptId: payload.conceptId,
            question: payload.question,
            activatedAt: payload.activatedAt,
          },
          isActive: true,
          isOpen: true,
          answer: "",
          submission: { status: "idle" },
          closedPollIds: state.poll.closedPollIds,
          lastActivatedAt: payload.activatedAt,
        },
        seenEventIds: nextSeen,
        eventRevision: state.eventRevision + 1,
      };
    }

    case "poll:closed": {
      const { payload } = action;
      if (payload.lectureId !== state.lecture.id) {
        return state;
      }
      if (state.seenEventIds.has(payload.eventId)) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(payload.eventId);

      const nextClosed = new Set(state.poll.closedPollIds);
      nextClosed.add(payload.pollId);

      const isCurrentPoll = state.poll.question?.id === payload.pollId;

      return {
        ...state,
        poll: {
          ...state.poll,
          isActive: isCurrentPoll ? false : state.poll.isActive,
          isOpen: isCurrentPoll ? false : state.poll.isOpen,
          closedPollIds: nextClosed,
        },
        seenEventIds: nextSeen,
        eventRevision: state.eventRevision + 1,
      };
    }

    case "poll:answer-changed": {
      if (state.poll.question?.id !== action.pollId || !state.poll.isActive) {
        return state;
      }
      if (state.poll.submission.status !== "idle") {
        return state;
      }
      return {
        ...state,
        poll: {
          ...state.poll,
          answer: action.answer,
        },
      };
    }

    case "poll:open": {
      if (state.poll.question?.id !== action.pollId || !state.poll.isActive) {
        return state;
      }
      return {
        ...state,
        poll: {
          ...state.poll,
          isOpen: true,
        },
      };
    }

    case "poll:dismiss": {
      if (state.poll.question?.id !== action.pollId) {
        return state;
      }
      return {
        ...state,
        poll: {
          ...state.poll,
          isOpen: false,
        },
      };
    }

    case "poll:submit-start": {
      if (state.poll.question?.id !== action.pollId || !state.poll.isActive) {
        return state;
      }
      if (action.answer.trim().length === 0) {
        return state;
      }
      if (
        state.poll.submission.status === "submitting" ||
        state.poll.submission.status === "evaluated"
      ) {
        return state;
      }
      return {
        ...state,
        poll: {
          ...state.poll,
          submission: {
            status: "submitting",
            submittedAnswer: action.answer,
          },
        },
      };
    }

    case "poll:submit-success": {
      if (state.poll.question?.id !== action.pollId) {
        return state;
      }
      if (state.poll.submission.status !== "submitting") {
        return state;
      }
      return {
        ...state,
        poll: {
          ...state.poll,
          submission: {
            status: "evaluated",
            submittedAnswer: state.poll.submission.submittedAnswer,
            result: action.result,
          },
        },
      };
    }

    case "poll:submit-error": {
      if (state.poll.question?.id !== action.pollId) {
        return state;
      }
      if (state.poll.submission.status !== "submitting") {
        return state;
      }
      return {
        ...state,
        poll: {
          ...state.poll,
          submission: {
            status: "error",
            submittedAnswer: state.poll.submission.submittedAnswer,
            code: action.code,
            message: action.message,
          },
        },
      };
    }
  }
}

export function applyStudentGraphMastery(
  graph: z.infer<typeof courseGraphResponseSchema>,
  update: Pick<MasteryUpdatedEvent, "studentId" | "conceptId" | "confidence" | "band">,
  studentId: UUID
): z.infer<typeof courseGraphResponseSchema> {
  if (update.studentId !== studentId) {
    return graph;
  }
  const nodeIndex = graph.nodes.findIndex((n) => n.id === update.conceptId);
  if (nodeIndex === -1) {
    return graph;
  }
  const targetNode = graph.nodes[nodeIndex];
  if (targetNode.confidence === update.confidence && targetNode.band === update.band) {
    return graph;
  }
  const nextNodes = [...graph.nodes];
  nextNodes[nodeIndex] = {
    ...targetNode,
    confidence: update.confidence,
    band: update.band,
  };
  return {
    ...graph,
    nodes: nextNodes,
  };
}

/**
 * Derives Spark companion mood on the student live lecture rail.
 * Follows modal reaction lifetime:
 * - While modal is open, evaluated outcome maps to cheer/think/oops and submitting gives think.
 * - When modal is closed (or poll is inactive/dismissed/closed), rail immediately resumes
 *   think when active concepts exist, otherwise calm.
 */
export function deriveStudentSparkMood(
  poll: StudentPollState | null,
  hasActiveConcepts: boolean
): SparkMood {
  if (poll?.isOpen) {
    if (poll.submission.status === "evaluated") {
      return getPollOutcomeMood(poll.submission.result.evaluation.outcome);
    }
    if (poll.submission.status === "submitting") {
      return "think";
    }
  }
  return hasActiveConcepts ? "think" : "calm";
}
