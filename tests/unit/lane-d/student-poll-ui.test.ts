import React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import type {
  LectureSession,
  LectureSnapshot,
  PublicPollQuestion,
  PollResponseResult,
} from "@/contracts/classroom";
import type {
  PollNewQuestionEvent,
  PollClosedEvent,
  MasteryUpdatedEvent,
} from "@/contracts/realtime";
import type { z } from "zod";
import type { courseGraphResponseSchema } from "@/contracts/course";

type CourseGraphResponse = z.infer<typeof courseGraphResponseSchema>;
import {
  createStudentLectureState,
  reduceStudentLectureState,
  applyStudentGraphMastery,
} from "@/features/student/student-lecture-state";
import { EvaluationCard } from "@/features/student/evaluation-card";
import { ActivePollModal } from "@/features/student/active-poll-modal";

describe("P4-D-02: Student Active Poll Modal & Evaluation Card (Lane D)", () => {
  const LECTURE_ID: UUID = "11111111-1111-4111-8111-111111111111";
  const COURSE_ID: UUID = "22222222-2222-4222-8222-222222222222";
  const STUDENT_ID: UUID = "33333333-3333-4333-8333-333333333333";
  const OTHER_STUDENT_ID: UUID = "44444444-4444-4444-8444-444444444444";
  const CONCEPT_A: UUID = "55555555-5555-4555-8555-555555555551";
  const CONCEPT_B: UUID = "55555555-5555-4555-8555-555555555552";
  const UNKNOWN_CONCEPT: UUID = "99999999-9999-4999-8999-999999999999";
  const POLL_1_ID: UUID = "66666666-6666-4666-8666-666666666661";
  const POLL_2_ID: UUID = "66666666-6666-4666-8666-666666666662";

  const KNOWN_CONCEPTS = new Set<UUID>([CONCEPT_A, CONCEPT_B]);

  const liveLecture: LectureSession = {
    id: LECTURE_ID,
    courseId: COURSE_ID,
    title: "Deep Learning Foundations",
    status: "live",
    startedAt: "2026-10-24T10:00:00.000Z",
  };

  const baseSnapshot: LectureSnapshot = {
    lecture: liveLecture,
    activePoll: null,
    recentChunks: [],
    activeConceptIds: [CONCEPT_A],
  };

  const activePublicPoll: PublicPollQuestion = {
    id: POLL_1_ID,
    lectureId: LECTURE_ID,
    conceptId: CONCEPT_A,
    question: "Why does high learning rate cause loss divergence in SGD?",
    status: "active",
    generatedAt: "2026-10-24T10:05:00.000Z",
    activatedAt: "2026-10-24T10:06:00.000Z",
  };

  const correctResult: PollResponseResult = {
    responseId: "77777777-7777-4777-8777-777777777771",
    status: "evaluated",
    evaluation: {
      outcome: "correct",
      feedback: "Accurate analysis. Overshooting minimum leads to parameter explosion.",
    },
    newConfidence: 0.85,
    newBand: "green",
  };

  const partialResultWithGreenBand: PollResponseResult = {
    responseId: "77777777-7777-4777-8777-777777777772",
    status: "evaluated",
    evaluation: {
      outcome: "partial",
      feedback: "Partially correct. You noted step size but missed oscillation dynamics.",
    },
    newConfidence: 0.72,
    newBand: "green",
  };

  const wrongResult: PollResponseResult = {
    responseId: "77777777-7777-4777-8777-777777777773",
    status: "evaluated",
    evaluation: {
      outcome: "wrong",
      feedback: "Incorrect. The learning rate directly scales the gradient step.",
    },
    newConfidence: 0.2,
    newBand: "red",
  };

  const mockCourseGraph: CourseGraphResponse = {
    nodes: [
      {
        id: CONCEPT_A,
        label: "Gradient Descent",
        description: "Optimization foundations",
        category: "Optimization",
        difficulty: 2,
        importance: 1,
        confidence: 0.35,
        band: "red",
      },
      {
        id: CONCEPT_B,
        label: "Backpropagation",
        description: "Gradient calculation algorithm",
        category: "Neural Networks",
        difficulty: 3,
        importance: 2,
        confidence: 0.75,
        band: "green",
      },
    ],
    edges: [],
  };

  describe("1. Reducer State Transitions (student-lecture-state)", () => {
    it("initial live snapshot with matching activePoll opens the question in idle submission state", () => {
      const snapshot: LectureSnapshot = {
        ...baseSnapshot,
        activePoll: activePublicPoll,
      };

      const state = createStudentLectureState(snapshot, KNOWN_CONCEPTS);

      expect(state.poll.isActive).toBe(true);
      expect(state.poll.isOpen).toBe(true);
      expect(state.poll.question?.id).toBe(POLL_1_ID);
      expect(state.poll.question?.question).toBe(activePublicPoll.question);
      expect(state.poll.answer).toBe("");
      expect(state.poll.submission.status).toBe("idle");
      expect(state.poll.lastActivatedAt).toBe(activePublicPoll.activatedAt);
    });

    it("completed lecture snapshot never opens a poll even if activePoll is present", () => {
      const snapshot: LectureSnapshot = {
        ...baseSnapshot,
        lecture: { ...liveLecture, status: "completed", endedAt: "2026-10-24T11:00:00.000Z" },
        activePoll: activePublicPoll,
      };

      const state = createStudentLectureState(snapshot, KNOWN_CONCEPTS);

      expect(state.poll.isActive).toBe(false);
      expect(state.poll.isOpen).toBe(false);
      expect(state.poll.question).toBeNull();
    });

    it("activation event (poll:new-question) opens a genuinely new poll and resets prior answer", () => {
      let state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);

      const event: PollNewQuestionEvent = {
        eventId: "88888888-8888-4888-8888-888888888881",
        occurredAt: "2026-10-24T10:06:00.000Z",
        pollId: POLL_1_ID,
        lectureId: LECTURE_ID,
        conceptId: CONCEPT_A,
        question: "Explain the vanishing gradient problem.",
        status: "active",
        activatedAt: "2026-10-24T10:06:00.000Z",
      };

      state = reduceStudentLectureState(
        state,
        { type: "poll:new-question", payload: event },
        KNOWN_CONCEPTS
      );

      expect(state.poll.isActive).toBe(true);
      expect(state.poll.isOpen).toBe(true);
      expect(state.poll.question?.id).toBe(POLL_1_ID);
      expect(state.poll.question?.question).toBe(event.question);
      expect(state.poll.submission.status).toBe("idle");
    });

    it("duplicate activation of same poll preserves current answer and dismissal", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );

      // Student drafts an answer and dismisses modal
      state = reduceStudentLectureState(
        state,
        { type: "poll:answer-changed", pollId: POLL_1_ID, answer: "Step is too large" },
        KNOWN_CONCEPTS
      );
      state = reduceStudentLectureState(
        state,
        { type: "poll:dismiss", pollId: POLL_1_ID },
        KNOWN_CONCEPTS
      );

      expect(state.poll.isOpen).toBe(false);
      expect(state.poll.answer).toBe("Step is too large");

      // Duplicate activation arrives
      const duplicateEvent: PollNewQuestionEvent = {
        eventId: "88888888-8888-4888-8888-888888888882",
        occurredAt: "2026-10-24T10:07:00.000Z",
        pollId: POLL_1_ID,
        lectureId: LECTURE_ID,
        conceptId: CONCEPT_A,
        question: activePublicPoll.question,
        status: "active",
        activatedAt: activePublicPoll.activatedAt!,
      };

      state = reduceStudentLectureState(
        state,
        { type: "poll:new-question", payload: duplicateEvent },
        KNOWN_CONCEPTS
      );

      expect(state.poll.isOpen).toBe(false);
      expect(state.poll.answer).toBe("Step is too large");
      expect(state.poll.submission.status).toBe("idle");
    });

    it("stale activation or older snapshot cannot overwrite newer active poll", () => {
      const state = createStudentLectureState(
        {
          ...baseSnapshot,
          activePoll: {
            ...activePublicPoll,
            id: POLL_2_ID,
            activatedAt: "2026-10-24T10:20:00.000Z",
          },
        },
        KNOWN_CONCEPTS
      );

      // Stale activation with earlier timestamp
      const staleEvent: PollNewQuestionEvent = {
        eventId: "88888888-8888-4888-8888-888888888883",
        occurredAt: "2026-10-24T10:10:00.000Z",
        pollId: POLL_1_ID,
        lectureId: LECTURE_ID,
        conceptId: CONCEPT_A,
        question: "Old question",
        status: "active",
        activatedAt: "2026-10-24T10:10:00.000Z",
      };

      const nextState = reduceStudentLectureState(
        state,
        { type: "poll:new-question", payload: staleEvent },
        KNOWN_CONCEPTS
      );

      expect(nextState.poll.question?.id).toBe(POLL_2_ID);
    });

    it("whitespace-only answer cannot enter submitting state", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );

      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "    \n   " },
        KNOWN_CONCEPTS
      );

      expect(state.poll.submission.status).toBe("idle");
    });

    it("submit transitions freeze editing and allow evaluated response settlement", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );

      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "Step overshoots" },
        KNOWN_CONCEPTS
      );

      expect(state.poll.submission.status).toBe("submitting");

      // Attempting to edit answer while submitting is rejected
      state = reduceStudentLectureState(
        state,
        { type: "poll:answer-changed", pollId: POLL_1_ID, answer: "Changed step" },
        KNOWN_CONCEPTS
      );
      expect(state.poll.answer).toBe("");

      // Submitting again while in-flight is rejected
      const submitAgain = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "New submit" },
        KNOWN_CONCEPTS
      );
      expect(submitAgain.poll.submission.status).toBe("submitting");

      // Evaluation completes successfully
      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-success", pollId: POLL_1_ID, result: correctResult },
        KNOWN_CONCEPTS
      );

      expect(state.poll.submission.status).toBe("evaluated");
      if (state.poll.submission.status === "evaluated") {
        expect(state.poll.submission.result.evaluation.outcome).toBe("correct");
        expect(state.poll.submission.result.newConfidence).toBe(0.85);
      }
    });

    it("poll:closed immediately closes modal and disables active state, even while submitting", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );

      // Start submission
      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "Step overshoots" },
        KNOWN_CONCEPTS
      );

      // Instructor closes poll before server evaluation returns
      const closeEvent: PollClosedEvent = {
        eventId: "88888888-8888-4888-8888-888888888884",
        occurredAt: "2026-10-24T10:08:00.000Z",
        pollId: POLL_1_ID,
        lectureId: LECTURE_ID,
        status: "closed",
        closedAt: "2026-10-24T10:08:00.000Z",
      };

      state = reduceStudentLectureState(
        state,
        { type: "poll:closed", payload: closeEvent },
        KNOWN_CONCEPTS
      );

      expect(state.poll.isActive).toBe(false);
      expect(state.poll.isOpen).toBe(false);
      // Submission remains in-flight so late response can settle
      expect(state.poll.submission.status).toBe("submitting");

      // When response settles, it updates submission without reopening dialog
      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-success", pollId: POLL_1_ID, result: correctResult },
        KNOWN_CONCEPTS
      );

      expect(state.poll.isOpen).toBe(false);
      expect(state.poll.submission.status).toBe("evaluated");
    });

    it("lecture completion allows already-started submission to settle into nonmodal result", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );

      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "Step overshoots" },
        KNOWN_CONCEPTS
      );

      // Lecture ended event
      state = reduceStudentLectureState(
        state,
        {
          type: "lecture:ended",
          payload: {
            eventId: "88888888-8888-4888-8888-888888888885",
            occurredAt: "2026-10-24T10:09:00.000Z",
            lectureId: LECTURE_ID,
            endedAt: "2026-10-24T10:09:00.000Z",
          },
        },
        KNOWN_CONCEPTS
      );

      expect(state.lecture.status).toBe("completed");
      expect(state.poll.isOpen).toBe(false);
      expect(state.poll.isActive).toBe(false);

      // In-flight HTTP response finishes after lecture completion
      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-success", pollId: POLL_1_ID, result: correctResult },
        KNOWN_CONCEPTS
      );

      expect(state.poll.isOpen).toBe(false);
      expect(state.poll.submission.status).toBe("evaluated");
    });

    it("tombstoned poll cannot be reopened by subsequent snapshot", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );

      state = reduceStudentLectureState(
        state,
        {
          type: "poll:closed",
          payload: {
            eventId: "88888888-8888-4888-8888-888888888886",
            occurredAt: "2026-10-24T10:08:00.000Z",
            pollId: POLL_1_ID,
            lectureId: LECTURE_ID,
            status: "closed",
            closedAt: "2026-10-24T10:08:00.000Z",
          },
        },
        KNOWN_CONCEPTS
      );

      expect(state.poll.closedPollIds.has(POLL_1_ID)).toBe(true);

      // Reconnect snapshot arriving with cached activePoll
      const reconnectSnapshot: LectureSnapshot = {
        ...baseSnapshot,
        activePoll: activePublicPoll,
      };

      const afterSnapshot = reduceStudentLectureState(
        state,
        {
          type: "snapshot",
          payload: reconnectSnapshot,
          requestedAtRevision: state.eventRevision,
          restoreActiveConcepts: true,
        },
        KNOWN_CONCEPTS
      );

      expect(afterSnapshot.poll.isActive).toBe(false);
      expect(afterSnapshot.poll.isOpen).toBe(false);
    });

    it("server error state captures typed message and stops busy state without reopening", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );

      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "Attempted answer" },
        KNOWN_CONCEPTS
      );

      state = reduceStudentLectureState(
        state,
        {
          type: "poll:submit-error",
          pollId: POLL_1_ID,
          code: "POLL_RESPONSE_PENDING",
          message: "A previous response is still undergoing evaluation.",
        },
        KNOWN_CONCEPTS
      );

      expect(state.poll.submission.status).toBe("error");
      if (state.poll.submission.status === "error") {
        expect(state.poll.submission.code).toBe("POLL_RESPONSE_PENDING");
        expect(state.poll.submission.message).toContain("still undergoing evaluation");
      }
    });
  });

  describe("2. Pure Graph Mastery Patching (applyStudentGraphMastery)", () => {
    it("updates target concept confidence and band for matching student", () => {
      const update: Pick<MasteryUpdatedEvent, "studentId" | "conceptId" | "confidence" | "band"> = {
        studentId: STUDENT_ID,
        conceptId: CONCEPT_A,
        confidence: 0.85,
        band: "green",
      };

      const updatedGraph = applyStudentGraphMastery(mockCourseGraph, update, STUDENT_ID);

      const target = updatedGraph.nodes.find((n) => n.id === CONCEPT_A);
      const other = updatedGraph.nodes.find((n) => n.id === CONCEPT_B);

      expect(target?.confidence).toBe(0.85);
      expect(target?.band).toBe("green");
      expect(other?.confidence).toBe(0.75); // preserved
      expect(other?.band).toBe("green");
    });

    it("returns same graph reference when event is for a different student", () => {
      const update: Pick<MasteryUpdatedEvent, "studentId" | "conceptId" | "confidence" | "band"> = {
        studentId: OTHER_STUDENT_ID,
        conceptId: CONCEPT_A,
        confidence: 0.85,
        band: "green",
      };

      const result = applyStudentGraphMastery(mockCourseGraph, update, STUDENT_ID);
      expect(result).toBe(mockCourseGraph);
    });

    it("returns same graph reference when concept does not exist in graph", () => {
      const update: Pick<MasteryUpdatedEvent, "studentId" | "conceptId" | "confidence" | "band"> = {
        studentId: STUDENT_ID,
        conceptId: UNKNOWN_CONCEPT,
        confidence: 0.85,
        band: "green",
      };

      const result = applyStudentGraphMastery(mockCourseGraph, update, STUDENT_ID);
      expect(result).toBe(mockCourseGraph);
    });
  });

  describe("3. EvaluationCard SSR Rendering", () => {
    it("renders correct outcome with green badge and cheer Spark", () => {
      const html = renderToString(
        React.createElement(EvaluationCard, {
          result: correctResult,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.5,
        })
      );

      expect(html).toContain("Correct");
      expect(html).toContain("Gradient Descent");
      expect(html).toContain("Private to you");
      expect(html).toContain(correctResult.evaluation.feedback);
      expect(html).toContain("Mastered (85%)");
    });

    it("renders partial outcome with yellow badge while preserving green mastery band", () => {
      const html = renderToString(
        React.createElement(EvaluationCard, {
          result: partialResultWithGreenBand,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.6,
        })
      );

      expect(html).toContain("Partially correct");
      expect(html).toContain("Mastered (72%)");
      expect(html).toContain(partialResultWithGreenBand.evaluation.feedback);
    });

    it("renders wrong outcome with red badge and oops Spark mood", () => {
      const html = renderToString(
        React.createElement(EvaluationCard, {
          result: wrongResult,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.2,
        })
      );

      expect(html).toContain("Incorrect");
      expect(html).toContain("Needs Practice (20%)");
      expect(html).toContain(wrongResult.evaluation.feedback);
    });

    it("escapes hostile HTML in feedback safely as text without DOM execution", () => {
      const hostileResult: PollResponseResult = {
        responseId: "77777777-7777-4777-8777-777777777774",
        status: "evaluated",
        evaluation: {
          outcome: "wrong",
          feedback: '<img src="x" onerror="alert(1)" /> Script <script>alert(2)</script>',
        },
        newConfidence: 0.2,
        newBand: "red",
      };

      const html = renderToString(
        React.createElement(EvaluationCard, {
          result: hostileResult,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.1,
        })
      );

      // React escapes HTML entities in SSR
      expect(html).toContain("&lt;img src=");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<img src=");
      expect(html).not.toContain("<script>alert");
    });
  });

  describe("4. ActivePollModal SSR Rendering", () => {
    it("renders idle state with question, textarea, close and submit buttons", () => {
      const state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );

      const html = renderToString(
        React.createElement(ActivePollModal, {
          poll: state.poll,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.4,
          canSubmit: true,
          onAnswerChange: () => {},
          onSubmit: () => {},
          onClose: () => {},
        })
      );

      expect(html).toContain("Lecture poll");
      expect(html).toContain("Gradient Descent");
      expect(html).toContain(activePublicPoll.question);
      expect(html).toContain("Your answer");
      expect(html).toContain("Submit answer");
      expect(html).toContain("Close");
    });

    it("renders submitting state with Evaluating spinner and disabled controls", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );
      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "My answer" },
        KNOWN_CONCEPTS
      );

      const html = renderToString(
        React.createElement(ActivePollModal, {
          poll: state.poll,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.4,
          canSubmit: false,
          onAnswerChange: () => {},
          onSubmit: () => {},
          onClose: () => {},
        })
      );

      expect(html).toContain("Evaluating…");
      expect(html).toContain("Evaluating your answer…");
      expect(html).toContain("disabled");
    });

    it("renders evaluated state with EvaluationCard and Continue lecture button", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );
      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "My answer" },
        KNOWN_CONCEPTS
      );
      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-success", pollId: POLL_1_ID, result: correctResult },
        KNOWN_CONCEPTS
      );

      const html = renderToString(
        React.createElement(ActivePollModal, {
          poll: state.poll,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.8,
          canSubmit: false,
          onAnswerChange: () => {},
          onSubmit: () => {},
          onClose: () => {},
        })
      );

      expect(html).toContain("Continue lecture");
      expect(html).toContain("Correct");
      expect(html).toContain(correctResult.evaluation.feedback);
      expect(html).not.toContain("Submit answer");
    });

    it("renders error state with typed error message and Dismiss button", () => {
      let state = createStudentLectureState(
        { ...baseSnapshot, activePoll: activePublicPoll },
        KNOWN_CONCEPTS
      );
      state = reduceStudentLectureState(
        state,
        { type: "poll:submit-start", pollId: POLL_1_ID, answer: "My answer" },
        KNOWN_CONCEPTS
      );
      state = reduceStudentLectureState(
        state,
        {
          type: "poll:submit-error",
          pollId: POLL_1_ID,
          code: "POLL_RESPONSE_PENDING",
          message: "Evaluation currently in progress.",
        },
        KNOWN_CONCEPTS
      );

      const html = renderToString(
        React.createElement(ActivePollModal, {
          poll: state.poll,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.4,
          canSubmit: false,
          onAnswerChange: () => {},
          onSubmit: () => {},
          onClose: () => {},
        })
      );

      expect(html).toContain("Poll submission error");
      expect(html).toContain("Evaluation currently in progress.");
      expect(html).toContain("Dismiss");
      expect(html).not.toContain("Submit answer");
    });

    it("returns null when poll is not open", () => {
      const state = createStudentLectureState(baseSnapshot, KNOWN_CONCEPTS);

      const html = renderToString(
        React.createElement(ActivePollModal, {
          poll: state.poll,
          conceptLabel: "Gradient Descent",
          skyBrightness: 0.4,
          canSubmit: false,
          onAnswerChange: () => {},
          onSubmit: () => {},
          onClose: () => {},
        })
      );

      expect(html).toBe("");
    });
  });
});
