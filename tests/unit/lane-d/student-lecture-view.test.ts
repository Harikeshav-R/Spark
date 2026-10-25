import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import type { LectureSnapshot, LectureSession, TranscriptChunk } from "@/contracts/classroom";
import type {
  TranscriptChunkEvent,
  ConceptDetectedEvent,
  LectureEndedEvent,
} from "@/contracts/realtime";
import {
  createStudentLectureState,
  reduceStudentLectureState,
} from "@/features/student/student-lecture-state";
import { ActiveConceptOverlay } from "@/features/graph/active-concept-overlay";
import { KnowledgeGraph } from "@/features/graph/knowledge-graph";
import type { GraphData, PositionedNode } from "@/features/graph/d3-force-layout";

describe("Lane D: Student Live Lecture View and Active Concept Overlay (P3-D-02)", () => {
  const LECTURE_ID: UUID = "11111111-1111-4111-8111-111111111111";
  const COURSE_ID: UUID = "22222222-2222-4222-8222-222222222222";
  const CONCEPT_A: UUID = "33333333-3333-4333-8333-333333333331";
  const CONCEPT_B: UUID = "33333333-3333-4333-8333-333333333332";
  const UNKNOWN_CONCEPT: UUID = "99999999-9999-4999-8999-999999999999";

  const KNOWN_CONCEPTS = new Set<UUID>([CONCEPT_A, CONCEPT_B]);

  const baseLecture: LectureSession = {
    id: LECTURE_ID,
    courseId: COURSE_ID,
    title: "Deep Learning Foundations",
    status: "live",
    startedAt: "2026-03-30T10:00:00.000Z",
  };

  const baseSnapshot: LectureSnapshot = {
    lecture: baseLecture,
    activePoll: null,
    recentChunks: [],
    activeConceptIds: [CONCEPT_A],
  };

  describe("createStudentLectureState", () => {
    it("initializes state from live snapshot, filtering only known concept IDs", () => {
      const snapshot: LectureSnapshot = {
        ...baseSnapshot,
        activeConceptIds: [CONCEPT_A, UNKNOWN_CONCEPT],
      };
      const state = createStudentLectureState(snapshot, KNOWN_CONCEPTS);

      expect(state.lecture.id).toBe(LECTURE_ID);
      expect(state.activeConceptIds).toEqual([CONCEPT_A]);
      expect(state.chunks).toEqual([]);
      expect(state.eventRevision).toBe(0);
      expect(state.seenEventIds.size).toBe(0);
    });

    it("initializes activeConceptIds as empty if snapshot lecture is completed", () => {
      const completedSnapshot: LectureSnapshot = {
        ...baseSnapshot,
        lecture: {
          ...baseLecture,
          status: "completed",
          endedAt: "2026-03-30T11:00:00.000Z",
        },
        activeConceptIds: [CONCEPT_A],
      };
      const state = createStudentLectureState(completedSnapshot, KNOWN_CONCEPTS);

      expect(state.lecture.status).toBe("completed");
      expect(state.activeConceptIds).toEqual([]);
    });
  });

  describe("reduceStudentLectureState transitions", () => {
    it("matching detection selects only known IDs and updates revision", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);
      const event: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444441",
        occurredAt: "2026-03-30T10:05:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [CONCEPT_B, UNKNOWN_CONCEPT, CONCEPT_B],
      };

      const nextState = reduceStudentLectureState(
        state,
        { type: "lecture:concept-detected", payload: event },
        KNOWN_CONCEPTS
      );

      expect(nextState.activeConceptIds).toEqual([CONCEPT_B]);
      expect(nextState.lastConceptOccurredAt).toBe("2026-03-30T10:05:00.000Z");
      expect(nextState.eventRevision).toBe(1);
      expect(nextState.seenEventIds.has(event.eventId)).toBe(true);
    });

    it("a newer event replaces the prior selection", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);
      const event1: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444441",
        occurredAt: "2026-03-30T10:05:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [CONCEPT_A],
      };
      const event2: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444442",
        occurredAt: "2026-03-30T10:07:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [CONCEPT_B],
      };

      const state1 = reduceStudentLectureState(
        state,
        { type: "lecture:concept-detected", payload: event1 },
        KNOWN_CONCEPTS
      );
      const state2 = reduceStudentLectureState(
        state1,
        { type: "lecture:concept-detected", payload: event2 },
        KNOWN_CONCEPTS
      );

      expect(state2.activeConceptIds).toEqual([CONCEPT_B]);
      expect(state2.lastConceptOccurredAt).toBe("2026-03-30T10:07:00.000Z");
    });

    it("empty detection clears active concept selection", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);
      const clearEvent: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444443",
        occurredAt: "2026-03-30T10:10:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [],
      };

      const nextState = reduceStudentLectureState(
        state,
        { type: "lecture:concept-detected", payload: clearEvent },
        KNOWN_CONCEPTS
      );

      expect(nextState.activeConceptIds).toEqual([]);
      expect(nextState.lastConceptOccurredAt).toBe("2026-03-30T10:10:00.000Z");
    });

    it("wrong-lecture, duplicate, and older events cannot change active concepts", () => {
      const initial = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);
      const validEvent: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444441",
        occurredAt: "2026-03-30T10:10:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [CONCEPT_A],
      };
      const state = reduceStudentLectureState(
        initial,
        { type: "lecture:concept-detected", payload: validEvent },
        KNOWN_CONCEPTS
      );

      // Wrong lecture
      const wrongLectureEvent: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444499",
        occurredAt: "2026-03-30T10:12:00.000Z",
        lectureId: "99999999-9999-4999-8999-999999999999",
        conceptIds: [CONCEPT_B],
      };
      expect(
        reduceStudentLectureState(
          state,
          { type: "lecture:concept-detected", payload: wrongLectureEvent },
          KNOWN_CONCEPTS
        )
      ).toBe(state);

      // Duplicate event
      expect(
        reduceStudentLectureState(
          state,
          { type: "lecture:concept-detected", payload: validEvent },
          KNOWN_CONCEPTS
        )
      ).toBe(state);

      // Older event (occurredAt earlier than current lastConceptOccurredAt)
      const olderEvent: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444440",
        occurredAt: "2026-03-30T10:05:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [CONCEPT_B],
      };
      const afterOlder = reduceStudentLectureState(
        state,
        { type: "lecture:concept-detected", payload: olderEvent },
        KNOWN_CONCEPTS
      );
      // Active concepts MUST NOT be overwritten by the older event
      expect(afterOlder.activeConceptIds).toEqual([CONCEPT_A]);
      expect(afterOlder.lastConceptOccurredAt).toBe("2026-03-30T10:10:00.000Z");
    });

    it("transcript and snapshot interleaving retains newer speech", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);
      const chunkEvent: TranscriptChunkEvent = {
        eventId: "55555555-5555-4555-8555-555555555551",
        occurredAt: "2026-03-30T10:01:00.000Z",
        chunkId: "66666666-6666-4666-8666-666666666661",
        lectureId: LECTURE_ID,
        text: "Today we explore computational graphs.",
        timestampSec: 60,
        speakerName: "Dr. Turing",
      };

      const stateWithChunk = reduceStudentLectureState(
        state,
        { type: "transcript:chunk", payload: chunkEvent },
        KNOWN_CONCEPTS
      );

      const olderSnapshotChunk: TranscriptChunk = {
        id: "66666666-6666-4666-8666-666666666660",
        lectureId: LECTURE_ID,
        text: "Welcome to class.",
        timestampSec: 10,
        speakerName: "Dr. Turing",
        detectedConceptIds: [],
        createdAt: "2026-03-30T10:00:10.000Z",
      };

      const snapshot: LectureSnapshot = {
        ...baseSnapshot,
        recentChunks: [olderSnapshotChunk],
      };

      const reconciledState = reduceStudentLectureState(
        stateWithChunk,
        {
          type: "snapshot",
          payload: snapshot,
          requestedAtRevision: 0,
          restoreActiveConcepts: false,
        },
        KNOWN_CONCEPTS
      );

      expect(reconciledState.chunks).toHaveLength(2);
      expect(reconciledState.chunks[0].text).toBe("Welcome to class.");
      expect(reconciledState.chunks[1].text).toBe("Today we explore computational graphs.");
    });

    it("stale snapshots cannot restore old concepts", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);

      // Event arrives, incrementing revision to 1
      const event: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444441",
        occurredAt: "2026-03-30T10:05:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [CONCEPT_B],
      };
      const stateAfterEvent = reduceStudentLectureState(
        state,
        { type: "lecture:concept-detected", payload: event },
        KNOWN_CONCEPTS
      );

      expect(stateAfterEvent.eventRevision).toBe(1);
      expect(stateAfterEvent.activeConceptIds).toEqual([CONCEPT_B]);

      // Stale snapshot requested at revision 0 finishes arriving with CONCEPT_A
      const staleSnapshot: LectureSnapshot = {
        ...baseSnapshot,
        activeConceptIds: [CONCEPT_A],
      };
      const stateAfterStale = reduceStudentLectureState(
        stateAfterEvent,
        {
          type: "snapshot",
          payload: staleSnapshot,
          requestedAtRevision: 0,
          restoreActiveConcepts: true,
        },
        KNOWN_CONCEPTS
      );

      // Newer event-selected active concepts MUST be preserved
      expect(stateAfterStale.activeConceptIds).toEqual([CONCEPT_B]);
    });

    it("annotation-only snapshots with unchanged revision still cannot replace latest targets with cumulative union", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);

      // Active target is CONCEPT_B
      const event: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444441",
        occurredAt: "2026-03-30T10:05:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [CONCEPT_B],
      };
      const stateAfterEvent = reduceStudentLectureState(
        state,
        { type: "lecture:concept-detected", payload: event },
        KNOWN_CONCEPTS
      );

      // Authoritative annotation refresh snapshot requested with restoreActiveConcepts: false
      const annotationSnapshot: LectureSnapshot = {
        ...baseSnapshot,
        activeConceptIds: [CONCEPT_A, CONCEPT_B], // cumulative union
      };
      const stateAfterAnnotation = reduceStudentLectureState(
        stateAfterEvent,
        {
          type: "snapshot",
          payload: annotationSnapshot,
          requestedAtRevision: stateAfterEvent.eventRevision,
          restoreActiveConcepts: false,
        },
        KNOWN_CONCEPTS
      );

      // Must remain only CONCEPT_B, NOT cumulative union [CONCEPT_A, CONCEPT_B]
      expect(stateAfterAnnotation.activeConceptIds).toEqual([CONCEPT_B]);
    });

    it("reconnect snapshots restore the declared union when no newer event exists", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);
      const reconnectSnapshot: LectureSnapshot = {
        ...baseSnapshot,
        activeConceptIds: [CONCEPT_A, CONCEPT_B],
      };

      const restoredState = reduceStudentLectureState(
        state,
        {
          type: "snapshot",
          payload: reconnectSnapshot,
          requestedAtRevision: 0,
          restoreActiveConcepts: true,
        },
        KNOWN_CONCEPTS
      );

      expect(restoredState.activeConceptIds).toEqual([CONCEPT_A, CONCEPT_B]);
    });

    it("completion is terminal and uses endedAt", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);
      const endedEvent: LectureEndedEvent = {
        eventId: "77777777-7777-4777-8777-777777777771",
        occurredAt: "2026-03-30T11:00:05.000Z",
        lectureId: LECTURE_ID,
        endedAt: "2026-03-30T11:00:00.000Z",
      };

      const completedState = reduceStudentLectureState(
        state,
        { type: "lecture:ended", payload: endedEvent },
        KNOWN_CONCEPTS
      );

      expect(completedState.lecture.status).toBe("completed");
      expect(completedState.lecture.endedAt).toBe("2026-03-30T11:00:00.000Z");
      expect(completedState.activeConceptIds).toEqual([]);

      // Attempted mutation after completion is completely rejected
      const lateEvent: ConceptDetectedEvent = {
        eventId: "44444444-4444-4444-8444-444444444499",
        occurredAt: "2026-03-30T11:01:00.000Z",
        lectureId: LECTURE_ID,
        conceptIds: [CONCEPT_A],
      };
      expect(
        reduceStudentLectureState(
          completedState,
          { type: "lecture:concept-detected", payload: lateEvent },
          KNOWN_CONCEPTS
        )
      ).toBe(completedState);

      const liveSnapshotAttempt: LectureSnapshot = {
        ...baseSnapshot,
        lecture: baseLecture, // trying to revive to live
      };
      expect(
        reduceStudentLectureState(
          completedState,
          {
            type: "snapshot",
            payload: liveSnapshotAttempt,
            requestedAtRevision: completedState.eventRevision,
            restoreActiveConcepts: true,
          },
          KNOWN_CONCEPTS
        )
      ).toBe(completedState);
    });
  });

  describe("ActiveConceptOverlay rendering and motion reduction", () => {
    const positionedNodes = new Map<string, PositionedNode>([
      [CONCEPT_A, { id: CONCEPT_A, level: 0, x: 120, y: 150 }],
      [CONCEPT_B, { id: CONCEPT_B, level: 1, x: 260, y: 300 }],
    ]);

    it("renders null when activeConceptIds is empty or contains no positioned nodes", () => {
      const html1 = renderToString(
        React.createElement("svg", null,
          React.createElement(ActiveConceptOverlay, {
            activeConceptIds: [],
            positionedNodes,
            reducedMotion: false,
          })
        )
      );
      expect(html1).not.toContain("active-concept-overlay-layer");

      const html2 = renderToString(
        React.createElement("svg", null,
          React.createElement(ActiveConceptOverlay, {
            activeConceptIds: [UNKNOWN_CONCEPT],
            positionedNodes,
            reducedMotion: false,
          })
        )
      );
      expect(html2).not.toContain("active-concept-overlay-layer");
    });

    it("renders steady ring and pulsing ring when reducedMotion is false", () => {
      const html = renderToString(
        React.createElement("svg", null,
          React.createElement(ActiveConceptOverlay, {
            activeConceptIds: [CONCEPT_A],
            positionedNodes,
            reducedMotion: false,
          })
        )
      );

      expect(html).toContain('data-concept-id="' + CONCEPT_A + '"');
      expect(html).toContain('transform="translate(120, 150)"');
      // Contains circles with r="38"
      expect(html).toContain('r="38"');
      // Two concentric circles (steady + pulsing motion.circle)
      const matches = html.match(/<circle[^>]*r="38"/g);
      expect(matches?.length).toBe(2);
    });

    it("retains the exact steady ring and omits repeating motion element when reducedMotion is true", () => {
      const html = renderToString(
        React.createElement("svg", null,
          React.createElement(ActiveConceptOverlay, {
            activeConceptIds: [CONCEPT_A],
            positionedNodes,
            reducedMotion: true,
          })
        )
      );

      expect(html).toContain('data-concept-id="' + CONCEPT_A + '"');
      expect(html).toContain('transform="translate(120, 150)"');
      // Only one steady ring
      const matches = html.match(/<circle[^>]*r="38"/g);
      expect(matches?.length).toBe(1);
    });
  });

  describe("KnowledgeGraph activeConceptIds integration", () => {
    const testGraph: GraphData = {
      nodes: [
        { id: CONCEPT_A, label: "Concept A", description: "First", category: "Core", difficulty: 1 },
        { id: CONCEPT_B, label: "Concept B", description: "Second", category: "Core", difficulty: 2 },
      ],
      edges: [
        { id: "e1", source: CONCEPT_A, target: CONCEPT_B, relationship: "prerequisite" },
      ],
    };

    it("accepts activeConceptIds without errors and renders SSR view", () => {
      const html = renderToString(
        React.createElement(KnowledgeGraph, {
          graph: testGraph,
          activeConceptIds: [CONCEPT_A],
        })
      );

      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("Preparing knowledge graph…");
      expect(html).toContain("Concept A");
    });

    it("renders clean KnowledgeGraph SSR view when activeConceptIds is omitted", () => {
      const html = renderToString(
        React.createElement(KnowledgeGraph, { graph: testGraph })
      );

      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("Preparing knowledge graph…");
      expect(html).toContain("Concept A");
    });
  });
});
