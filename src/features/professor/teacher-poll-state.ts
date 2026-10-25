import type { UUID, ISOTimestamp } from "@/contracts/common";
import type {
  PollQuestion,
  TeacherPollSnapshot,
  TeacherPollSummary,
} from "@/contracts/classroom";
import type { CourseHeatmapSnapshot } from "@/contracts/mastery";
import type {
  PollResponseCountEvent,
  PollNewQuestionEvent,
  PollClosedEvent,
  HeatmapUpdatedEvent,
  LectureEndedEvent,
} from "@/contracts/realtime";
import {
  pollResponseCountEventSchema,
  pollNewQuestionEventSchema,
  pollClosedEventSchema,
  heatmapUpdatedEventSchema,
  lectureEndedEventSchema,
} from "@/contracts/realtime";
import { courseHeatmapSnapshotSchema } from "@/contracts/mastery";
import { teacherPollSnapshotSchema } from "@/contracts/classroom";

export interface TeacherPollState {
  courseId: UUID;
  lectureId: UUID | null;
  polls: TeacherPollSnapshot | null;
  heatmap: CourseHeatmapSnapshot | null;
  counts: ReadonlyMap<UUID, number>;
  eventRevision: number;
  seenEventIds: ReadonlySet<UUID>;
  closedPollIds: ReadonlySet<UUID>;
  announcedActivePollId: UUID | null;
  lastHeatmapAt: ReadonlyMap<UUID, ISOTimestamp>;
}

export type TeacherPollAction =
  | { type: "reset"; courseId: UUID; lectureId: UUID | null }
  | { type: "snapshot"; payload: TeacherPollSnapshot; requestedAtRevision: number }
  | { type: "heatmap:snapshot"; payload: CourseHeatmapSnapshot; requestedAtRevision: number }
  | { type: "poll:confirmed"; payload: PollQuestion }
  | { type: "poll:response-count"; payload: PollResponseCountEvent }
  | { type: "poll:new-question"; payload: PollNewQuestionEvent }
  | { type: "poll:closed"; payload: PollClosedEvent }
  | { type: "heatmap:updated"; payload: HeatmapUpdatedEvent }
  | { type: "lecture:ended"; payload: LectureEndedEvent };

export function createTeacherPollState(
  courseId: UUID,
  lectureId: UUID | null
): TeacherPollState {
  return {
    courseId,
    lectureId,
    polls: null,
    heatmap: null,
    counts: new Map<UUID, number>(),
    eventRevision: 0,
    seenEventIds: new Set<UUID>(),
    closedPollIds: new Set<UUID>(),
    announcedActivePollId: null,
    lastHeatmapAt: new Map<UUID, ISOTimestamp>(),
  };
}

export function getEffectiveResponseCount(
  summary: TeacherPollSummary | null | undefined,
  counts: ReadonlyMap<UUID, number>
): number {
  if (!summary) return 0;
  const recorded = counts.get(summary.poll.id) ?? 0;
  return Math.max(summary.responseCount, recorded);
}

export function reduceTeacherPollState(
  state: TeacherPollState,
  action: TeacherPollAction
): TeacherPollState {
  switch (action.type) {
    case "reset": {
      return createTeacherPollState(action.courseId, action.lectureId);
    }

    case "snapshot": {
      // Must match current lecture
      if (state.lectureId !== action.payload.lectureId) {
        return state;
      }

      // Ignore in-flight snapshot invalidated by newer local event or mutation
      if (action.requestedAtRevision < state.eventRevision) {
        return state;
      }

      const validSnapshot = teacherPollSnapshotSchema.safeParse(action.payload);
      if (!validSnapshot.success) {
        return state;
      }

      const incoming = validSnapshot.data;
      const nextCounts = new Map<UUID, number>(state.counts);

      if (incoming.draft) {
        const id = incoming.draft.poll.id;
        nextCounts.set(id, Math.max(nextCounts.get(id) ?? 0, incoming.draft.responseCount));
      }
      if (incoming.active) {
        const id = incoming.active.poll.id;
        nextCounts.set(id, Math.max(nextCounts.get(id) ?? 0, incoming.active.responseCount));
      }
      if (incoming.closed) {
        const id = incoming.closed.poll.id;
        nextCounts.set(id, Math.max(nextCounts.get(id) ?? 0, incoming.closed.responseCount));
      }

      // Reconcile active slot with closed knowledge
      let resolvedActive: TeacherPollSummary | null = incoming.active;
      if (incoming.active && state.closedPollIds.has(incoming.active.poll.id)) {
        resolvedActive = null;
      }

      let nextAnnounced = state.announcedActivePollId;
      if (resolvedActive) {
        nextAnnounced = null;
      } else if (
        state.announcedActivePollId &&
        ((incoming.draft && incoming.draft.poll.id === state.announcedActivePollId) ||
          (incoming.closed && incoming.closed.poll.id === state.announcedActivePollId))
      ) {
        nextAnnounced = null;
      }

      const resolvedPolls: TeacherPollSnapshot = {
        lectureId: incoming.lectureId,
        draft: incoming.draft
          ? {
              poll: incoming.draft.poll,
              responseCount: nextCounts.get(incoming.draft.poll.id) ?? incoming.draft.responseCount,
            }
          : null,
        active: resolvedActive
          ? {
              poll: resolvedActive.poll,
              responseCount: nextCounts.get(resolvedActive.poll.id) ?? resolvedActive.responseCount,
            }
          : null,
        closed: incoming.closed
          ? {
              poll: incoming.closed.poll,
              responseCount: nextCounts.get(incoming.closed.poll.id) ?? incoming.closed.responseCount,
            }
          : null,
      };

      return {
        ...state,
        polls: resolvedPolls,
        counts: nextCounts,
        announcedActivePollId: nextAnnounced,
      };
    }

    case "heatmap:snapshot": {
      if (state.courseId !== action.payload.courseId) {
        return state;
      }

      if (action.requestedAtRevision < state.eventRevision) {
        return state;
      }

      const validHeatmap = courseHeatmapSnapshotSchema.safeParse(action.payload);
      if (!validHeatmap.success) {
        return state;
      }

      return {
        ...state,
        heatmap: validHeatmap.data,
      };
    }

    case "poll:confirmed": {
      const poll = action.payload;
      if (poll.lectureId !== state.lectureId) {
        return state;
      }

      const nextRevision = state.eventRevision + 1;
      const prevPolls = state.polls ?? {
        lectureId: poll.lectureId,
        draft: null,
        active: null,
        closed: null,
      };

      const pollCount = state.counts.get(poll.id) ?? 0;

      if (poll.status === "draft") {
        return {
          ...state,
          eventRevision: nextRevision,
          polls: {
            ...prevPolls,
            draft: { poll, responseCount: pollCount },
            active: prevPolls.active?.poll.id === poll.id ? null : prevPolls.active,
            closed: prevPolls.closed?.poll.id === poll.id ? null : prevPolls.closed,
          },
        };
      }

      if (poll.status === "active") {
        const effectiveCount = Math.max(prevPolls.active?.responseCount ?? 0, pollCount);
        return {
          ...state,
          eventRevision: nextRevision,
          announcedActivePollId: null,
          polls: {
            ...prevPolls,
            draft: prevPolls.draft?.poll.id === poll.id ? null : prevPolls.draft,
            active: { poll, responseCount: effectiveCount },
            closed: prevPolls.closed?.poll.id === poll.id ? null : prevPolls.closed,
          },
        };
      }

      if (poll.status === "closed") {
        const nextClosedIds = new Set(state.closedPollIds);
        nextClosedIds.add(poll.id);
        const effectiveCount = Math.max(prevPolls.closed?.responseCount ?? 0, pollCount);

        return {
          ...state,
          eventRevision: nextRevision,
          closedPollIds: nextClosedIds,
          announcedActivePollId:
            state.announcedActivePollId === poll.id ? null : state.announcedActivePollId,
          polls: {
            ...prevPolls,
            draft: prevPolls.draft?.poll.id === poll.id ? null : prevPolls.draft,
            active: prevPolls.active?.poll.id === poll.id ? null : prevPolls.active,
            closed: { poll, responseCount: effectiveCount },
          },
        };
      }

      return state;
    }

    case "poll:response-count": {
      const event = action.payload;
      if (state.seenEventIds.has(event.eventId)) {
        return state;
      }
      if (event.lectureId !== state.lectureId) {
        return state;
      }
      const valid = pollResponseCountEventSchema.safeParse(event);
      if (!valid.success) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(event.eventId);

      const nextCounts = new Map(state.counts);
      const current = nextCounts.get(event.pollId) ?? 0;
      const updated = Math.max(current, event.responseCount);
      nextCounts.set(event.pollId, updated);

      let nextPolls = state.polls;
      if (state.polls) {
        let changed = false;
        let draft = state.polls.draft;
        let active = state.polls.active;
        let closed = state.polls.closed;

        if (draft && draft.poll.id === event.pollId) {
          draft = { ...draft, responseCount: updated };
          changed = true;
        }
        if (active && active.poll.id === event.pollId) {
          active = { ...active, responseCount: updated };
          changed = true;
        }
        if (closed && closed.poll.id === event.pollId) {
          closed = { ...closed, responseCount: updated };
          changed = true;
        }

        if (changed) {
          nextPolls = {
            ...state.polls,
            draft,
            active,
            closed,
          };
        }
      }

      return {
        ...state,
        eventRevision: state.eventRevision + 1,
        seenEventIds: nextSeen,
        counts: nextCounts,
        polls: nextPolls,
      };
    }

    case "poll:new-question": {
      const event = action.payload;
      if (state.seenEventIds.has(event.eventId)) {
        return state;
      }
      if (event.lectureId !== state.lectureId) {
        return state;
      }
      const valid = pollNewQuestionEventSchema.safeParse(event);
      if (!valid.success) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(event.eventId);

      // A closed poll cannot become active from a delayed event
      if (state.closedPollIds.has(event.pollId)) {
        return {
          ...state,
          eventRevision: state.eventRevision + 1,
          seenEventIds: nextSeen,
        };
      }

      return {
        ...state,
        eventRevision: state.eventRevision + 1,
        seenEventIds: nextSeen,
        announcedActivePollId: event.pollId,
      };
    }

    case "poll:closed": {
      const event = action.payload;
      if (state.seenEventIds.has(event.eventId)) {
        return state;
      }
      if (event.lectureId !== state.lectureId) {
        return state;
      }
      const valid = pollClosedEventSchema.safeParse(event);
      if (!valid.success) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(event.eventId);

      const nextClosedIds = new Set(state.closedPollIds);
      nextClosedIds.add(event.pollId);

      let nextPolls = state.polls;
      if (state.polls && state.polls.active && state.polls.active.poll.id === event.pollId) {
        const closedPoll: PollQuestion = {
          ...state.polls.active.poll,
          status: "closed",
          closedAt: event.closedAt,
        };
        const count = Math.max(
          state.polls.active.responseCount,
          state.counts.get(event.pollId) ?? 0
        );
        nextPolls = {
          ...state.polls,
          active: null,
          closed: { poll: closedPoll, responseCount: count },
        };
      }

      return {
        ...state,
        eventRevision: state.eventRevision + 1,
        seenEventIds: nextSeen,
        closedPollIds: nextClosedIds,
        announcedActivePollId:
          state.announcedActivePollId === event.pollId ? null : state.announcedActivePollId,
        polls: nextPolls,
      };
    }

    case "heatmap:updated": {
      const event = action.payload;
      if (state.seenEventIds.has(event.eventId)) {
        return state;
      }
      if (event.courseId !== state.courseId) {
        return state;
      }
      const valid = heatmapUpdatedEventSchema.safeParse(event);
      if (!valid.success) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(event.eventId);

      // Reject older per-concept timestamps
      const lastAt = state.lastHeatmapAt.get(event.conceptId);
      if (lastAt && new Date(event.occurredAt).getTime() <= new Date(lastAt).getTime()) {
        return {
          ...state,
          seenEventIds: nextSeen,
        };
      }

      if (!state.heatmap || state.heatmap.totalStudents !== event.totalStudents) {
        // Different total students or unhydrated: retain state until full refresh
        return {
          ...state,
          eventRevision: state.eventRevision + 1,
          seenEventIds: nextSeen,
        };
      }

      const conceptIndex = state.heatmap.concepts.findIndex(
        (c) => c.conceptId === event.conceptId
      );
      if (conceptIndex === -1) {
        // Unknown concept: triggers full refresh
        return {
          ...state,
          eventRevision: state.eventRevision + 1,
          seenEventIds: nextSeen,
        };
      }

      const updatedConcepts = [...state.heatmap.concepts];
      const existing = updatedConcepts[conceptIndex]!;
      updatedConcepts[conceptIndex] = {
        ...existing,
        distribution: event.distribution,
        averageConfidence: event.averageConfidence,
      };

      const nextHeatmapAt = new Map(state.lastHeatmapAt);
      nextHeatmapAt.set(event.conceptId, event.occurredAt);

      return {
        ...state,
        eventRevision: state.eventRevision + 1,
        seenEventIds: nextSeen,
        lastHeatmapAt: nextHeatmapAt,
        heatmap: {
          ...state.heatmap,
          concepts: updatedConcepts,
        },
      };
    }

    case "lecture:ended": {
      const event = action.payload;
      if (state.seenEventIds.has(event.eventId)) {
        return state;
      }
      if (event.lectureId !== state.lectureId) {
        return state;
      }
      const valid = lectureEndedEventSchema.safeParse(event);
      if (!valid.success) {
        return state;
      }

      const nextSeen = new Set(state.seenEventIds);
      nextSeen.add(event.eventId);

      let nextPolls = state.polls;
      const nextClosedIds = new Set(state.closedPollIds);

      if (state.polls?.active) {
        nextClosedIds.add(state.polls.active.poll.id);
        const closedPoll: PollQuestion = {
          ...state.polls.active.poll,
          status: "closed",
          closedAt: event.endedAt,
        };
        const count = Math.max(
          state.polls.active.responseCount,
          state.counts.get(state.polls.active.poll.id) ?? 0
        );
        nextPolls = {
          ...state.polls,
          active: null,
          closed: { poll: closedPoll, responseCount: count },
        };
      }

      return {
        ...state,
        eventRevision: state.eventRevision + 1,
        seenEventIds: nextSeen,
        closedPollIds: nextClosedIds,
        announcedActivePollId: null,
        polls: nextPolls,
      };
    }

    default:
      return state;
  }
}
