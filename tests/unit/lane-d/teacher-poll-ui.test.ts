import React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import type {
  PollQuestion,
  TeacherPollSnapshot,
} from "@/contracts/classroom";
import type { CourseHeatmapSnapshot } from "@/contracts/mastery";
import {
  createTeacherPollState,
  reduceTeacherPollState,
  getEffectiveResponseCount,
} from "@/features/professor/teacher-poll-state";
import { PollPanel } from "@/features/professor/poll-panel";
import { ClassHeatmap } from "@/features/professor/class-heatmap";
import type { UseTeacherPollsResult } from "@/features/professor/use-teacher-polls";

describe("P4-D-01: Teacher Poll Dashboard UI & Mastery Heatmap Checkpoint", () => {
  const courseId: UUID = "11111111-1111-4111-8111-111111111111";
  const lectureId: UUID = "22222222-2222-4222-8222-222222222222";
  const pollAId: UUID = "33333333-3333-4333-8333-333333333333";
  const pollBId: UUID = "44444444-4444-4444-8444-444444444444";
  const concept1: UUID = "55555555-5555-4555-8555-555555555555";
  const concept2: UUID = "66666666-6666-4666-8666-666666666666";
  const timestamp = "2026-10-23T14:00:00.000Z";

  const draftPollA: PollQuestion = {
    id: pollAId,
    lectureId,
    conceptId: concept1,
    question: "What is gradient descent optimization?",
    expectedAnswer: "An iterative first-order optimization algorithm.",
    status: "draft",
    generatedAt: timestamp,
  };

  const activePollA: PollQuestion = {
    ...draftPollA,
    status: "active",
    activatedAt: timestamp,
  };

  const closedPollA: PollQuestion = {
    ...activePollA,
    status: "closed",
    closedAt: "2026-10-23T14:10:00.000Z",
  };

  describe("1. Pure Teacher Poll Reducer Transitions", () => {
    it("generated draft plus successful activation produces active poll with count 0", () => {
      let state = createTeacherPollState(courseId, lectureId);

      // Confirm generated draft
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: draftPollA,
      });

      expect(state.polls?.draft?.poll.id).toBe(pollAId);
      expect(state.polls?.active).toBeNull();
      expect(state.eventRevision).toBe(1);

      // Confirm activation response
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: activePollA,
      });

      expect(state.polls?.draft).toBeNull();
      expect(state.polls?.active?.poll.id).toBe(pollAId);
      expect(state.polls?.active?.poll.status).toBe("active");
      expect(getEffectiveResponseCount(state.polls?.active, state.counts)).toBe(0);
      expect(state.eventRevision).toBe(2);
    });

    it("count events 1, 1, 0 produce monotonic displayed count of 1", () => {
      let state = createTeacherPollState(courseId, lectureId);
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: activePollA,
      });

      // Count event 1
      state = reduceTeacherPollState(state, {
        type: "poll:response-count",
        payload: {
          eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
          occurredAt: "2026-10-23T14:02:00.000Z",
          lectureId,
          pollId: pollAId,
          responseCount: 1,
        },
      });
      expect(getEffectiveResponseCount(state.polls?.active, state.counts)).toBe(1);

      // Duplicate count event 1 (different eventId)
      state = reduceTeacherPollState(state, {
        type: "poll:response-count",
        payload: {
          eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
          occurredAt: "2026-10-23T14:03:00.000Z",
          lectureId,
          pollId: pollAId,
          responseCount: 1,
        },
      });
      expect(getEffectiveResponseCount(state.polls?.active, state.counts)).toBe(1);

      // Delayed / out-of-order count 0
      state = reduceTeacherPollState(state, {
        type: "poll:response-count",
        payload: {
          eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
          occurredAt: "2026-10-23T14:01:00.000Z",
          lectureId,
          pollId: pollAId,
          responseCount: 0,
        },
      });
      expect(getEffectiveResponseCount(state.polls?.active, state.counts)).toBe(1);
    });

    it("terminal closure of poll A prevents a delayed new-question event from reopening A", () => {
      let state = createTeacherPollState(courseId, lectureId);
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: activePollA,
      });

      // Poll closed
      state = reduceTeacherPollState(state, {
        type: "poll:closed",
        payload: {
          eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
          occurredAt: "2026-10-23T14:10:00.000Z",
          lectureId,
          pollId: pollAId,
          status: "closed",
          closedAt: "2026-10-23T14:10:00.000Z",
        },
      });

      expect(state.polls?.active).toBeNull();
      expect(state.polls?.closed?.poll.id).toBe(pollAId);
      expect(state.closedPollIds.has(pollAId)).toBe(true);

      // Stale delayed new-question event for poll A
      state = reduceTeacherPollState(state, {
        type: "poll:new-question",
        payload: {
          eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
          occurredAt: "2026-10-23T14:05:00.000Z",
          lectureId,
          pollId: pollAId,
          conceptId: concept1,
          question: "What is gradient descent optimization?",
          status: "active",
          activatedAt: "2026-10-23T14:05:00.000Z",
        },
      });

      expect(state.announcedActivePollId).toBeNull();
      expect(state.polls?.active).toBeNull();
      expect(state.polls?.closed?.poll.id).toBe(pollAId);
    });

    it("ignores unrelated lecture events and preserves isolation", () => {
      const otherLectureId: UUID = "99999999-9999-4999-8999-999999999999";
      let state = createTeacherPollState(courseId, lectureId);
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: activePollA,
      });

      const beforeRevision = state.eventRevision;

      // Event for other lecture
      state = reduceTeacherPollState(state, {
        type: "poll:response-count",
        payload: {
          eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6",
          occurredAt: timestamp,
          lectureId: otherLectureId,
          pollId: pollAId,
          responseCount: 10,
        },
      });

      expect(state.eventRevision).toBe(beforeRevision);
      expect(getEffectiveResponseCount(state.polls?.active, state.counts)).toBe(0);
    });

    it("resets state completely on reset action", () => {
      let state = createTeacherPollState(courseId, lectureId);
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: activePollA,
      });

      const resetState = reduceTeacherPollState(state, {
        type: "reset",
        courseId,
        lectureId: null,
      });

      expect(resetState.polls).toBeNull();
      expect(resetState.lectureId).toBeNull();
      expect(resetState.counts.size).toBe(0);
      expect(resetState.eventRevision).toBe(0);
    });

    it("drops stale in-flight snapshot invalidated by newer local revision", () => {
      let state = createTeacherPollState(courseId, lectureId);

      // Local event happens: revision becomes 1
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: draftPollA,
      });
      expect(state.eventRevision).toBe(1);

      // In-flight snapshot was requested at revision 0
      const staleSnapshot: TeacherPollSnapshot = {
        lectureId,
        draft: null,
        active: null,
        closed: null,
      };

      const newState = reduceTeacherPollState(state, {
        type: "snapshot",
        payload: staleSnapshot,
        requestedAtRevision: 0,
      });

      // Snapshot ignored: draft remains present
      expect(newState.polls?.draft?.poll.id).toBe(pollAId);
    });

    it("replaces known concept counts and averageConfidence on heatmap:updated while preserving metadata", () => {
      let state = createTeacherPollState(courseId, lectureId);

      const initialHeatmap: CourseHeatmapSnapshot = {
        courseId,
        totalStudents: 4,
        concepts: [
          {
            conceptId: concept1,
            label: "Gradient Descent",
            category: "Optimization",
            distribution: { gray: 4, red: 0, yellow: 0, green: 0 },
            averageConfidence: 0.0,
          },
          {
            conceptId: concept2,
            label: "Backpropagation",
            category: "Deep Learning",
            distribution: { gray: 4, red: 0, yellow: 0, green: 0 },
            averageConfidence: 0.0,
          },
        ],
      };

      state = reduceTeacherPollState(state, {
        type: "heatmap:snapshot",
        payload: initialHeatmap,
        requestedAtRevision: 0,
      });

      // Update concept 1
      state = reduceTeacherPollState(state, {
        type: "heatmap:updated",
        payload: {
          eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7",
          occurredAt: "2026-10-23T14:15:00.000Z",
          courseId,
          totalStudents: 4,
          conceptId: concept1,
          distribution: { gray: 2, red: 1, yellow: 0, green: 1 },
          averageConfidence: 0.45,
        },
      });

      const updatedConcept1 = state.heatmap?.concepts.find((c) => c.conceptId === concept1);
      expect(updatedConcept1?.label).toBe("Gradient Descent");
      expect(updatedConcept1?.category).toBe("Optimization");
      expect(updatedConcept1?.distribution).toEqual({ gray: 2, red: 1, yellow: 0, green: 1 });
      expect(updatedConcept1?.averageConfidence).toBe(0.45);

      // Concept 2 unchanged
      const concept2Node = state.heatmap?.concepts.find((c) => c.conceptId === concept2);
      expect(concept2Node?.distribution).toEqual({ gray: 4, red: 0, yellow: 0, green: 0 });
    });
  });

  describe("2. Controlled Views & Server Rendering", () => {
    function createMockHook(overrides?: Partial<UseTeacherPollsResult>): UseTeacherPollsResult {
      return {
        state: createTeacherPollState(courseId, lectureId),
        pollsLoading: false,
        pollsError: null,
        heatmapLoading: false,
        heatmapError: null,
        actionPending: false,
        actionError: null,
        activeDraftEdits: {
          question: "Draft question?",
          expectedAnswer: "Draft rubric.",
          isDirty: false,
        },
        refresh: async () => {},
        refreshPolls: async () => {},
        refreshHeatmap: async () => {},
        handleEvent: () => {},
        updateDraftField: () => {},
        generatePoll: async () => draftPollA,
        saveDraft: async () => draftPollA,
        activatePoll: async () => activePollA,
        closePoll: async () => closedPollA,
        clearActionError: () => {},
        ...overrides,
      };
    }

    it("renders prompt to start live lecture when not live", () => {
      const hook = createMockHook();
      const html = renderToString(
        React.createElement(PollPanel, { isLive: false, concepts: [], hook })
      );

      expect(html).toContain("Start or resume a live lecture to generate a poll.");
      expect(html).toContain("Session Ended");
    });

    it("renders active poll with live response count and close button", () => {
      let state = createTeacherPollState(courseId, lectureId);
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: activePollA,
      });
      state = reduceTeacherPollState(state, {
        type: "poll:response-count",
        payload: {
          eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8",
          occurredAt: timestamp,
          lectureId,
          pollId: pollAId,
          responseCount: 3,
        },
      });

      const hook = createMockHook({ state });
      const html = renderToString(
        React.createElement(PollPanel, { isLive: true, concepts: [], hook })
      );

      expect(html).toContain("What is gradient descent optimization?");
      expect(html).toContain("3 responses received");
      expect(html).toContain("Close poll");
    });

    it("blocks activation of draft when an active poll already exists", () => {
      let state = createTeacherPollState(courseId, lectureId);
      // Active poll A
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: activePollA,
      });
      // Draft poll B
      state = reduceTeacherPollState(state, {
        type: "poll:confirmed",
        payload: {
          id: pollBId,
          lectureId,
          conceptId: concept2,
          question: "Question B for draft?",
          expectedAnswer: "Rubric B.",
          status: "draft",
          generatedAt: timestamp,
        },
      });

      const hook = createMockHook({
        state,
        activeDraftEdits: {
          question: "Question B for draft?",
          expectedAnswer: "Rubric B.",
          isDirty: false,
        },
      });

      const html = renderToString(
        React.createElement(PollPanel, { isLive: true, concepts: [], hook })
      );

      expect(html).toContain("Close the active poll before activating another.");
      expect(html).toContain("What is gradient descent optimization?");
      expect(html).toContain("Question B for draft?");
    });

    it("renders 4 bands at 25% each for total 4 students (1 each), and 0% with 0 students", () => {
      // 1. Equal distribution across 4 students
      const equalHeatmap: CourseHeatmapSnapshot = {
        courseId,
        totalStudents: 4,
        concepts: [
          {
            conceptId: concept1,
            label: "Gradient Descent",
            category: "Optimization",
            distribution: { gray: 1, red: 1, yellow: 1, green: 1 },
            averageConfidence: 0.5,
          },
        ],
      };

      const htmlEqual = renderToString(
        React.createElement(ClassHeatmap, { heatmap: equalHeatmap })
      );
      expect(htmlEqual).toContain("Course mastery");
      expect(htmlEqual).toContain("Unassessed: 1 (25.0%)");
      expect(htmlEqual).toContain("Needs practice: 1 (25.0%)");
      expect(htmlEqual).toContain("Developing: 1 (25.0%)");
      expect(htmlEqual).toContain("Mastered: 1 (25.0%)");

      // 2. Zero students: shows 0% and 'No enrolled students yet.' without NaN
      const zeroHeatmap: CourseHeatmapSnapshot = {
        courseId,
        totalStudents: 0,
        concepts: [
          {
            conceptId: concept1,
            label: "Gradient Descent",
            category: "Optimization",
            distribution: { gray: 0, red: 0, yellow: 0, green: 0 },
            averageConfidence: 0.0,
          },
        ],
      };

      const htmlZero = renderToString(
        React.createElement(ClassHeatmap, { heatmap: zeroHeatmap })
      );
      expect(htmlZero).toContain("No enrolled students yet.");
      expect(htmlZero).toContain("Unassessed: 0 (0%)");
      expect(htmlZero).toContain("Needs practice: 0 (0%)");
      expect(htmlZero).toContain("Developing: 0 (0%)");
      expect(htmlZero).toContain("Mastered: 0 (0%)");
      expect(htmlZero).not.toContain("NaN");
    });
  });
});
