import { describe, it, expect, beforeEach } from "vitest";
import {
  // classroom schemas & types
  lectureStatusSchema,
  lectureSessionSchema,
  transcriptChunkSchema,
  pollStatusSchema,
  pollQuestionSchema,
  pollResponseOutcomeSchema,
  pollResponseEvaluationSchema,
  pollResponseResultSchema,
  publicPollQuestionSchema,
  pollDraftInputSchema,
  teacherPollSummarySchema,
  teacherPollSnapshotSchema,
  lectureSnapshotSchema,
  courseHeatmapSnapshotSchema,
  transcriptIngestResponseSchema,
  studyGroupOptInResponseSchema,
  timeIntervalSchema,
  studyGroupMessageSchema,
  // realtime event schemas & types
  transcriptChunkEventSchema,
  conceptDetectedEventSchema,
  pollNewQuestionEventSchema,
  pollClosedEventSchema,
  pollResponseCountEventSchema,
  heatmapUpdatedEventSchema,
  lectureEndedEventSchema,
  lectureSummaryReadyEventSchema,
  studyGroupMatchedEventSchema,
  studyGroupMessageEventSchema,
  studyGroupUpdatedEventSchema,
  lectureJoinPayloadSchema,
  lectureLeavePayloadSchema,
  studyGroupJoinPayloadSchema,
  studyGroupLeavePayloadSchema,
  socketAckResponseSchema,
  // common & mastery
  masteryUpdatedEventSchema,
  AppError,
} from "../../../src/contracts/index.js";
import {
  FIXTURE_LECTURE_ID,
  FIXTURE_COURSE_ID,
  FIXTURE_TEACHER_ID,
  FIXTURE_STUDENT_ID,
  FIXTURE_CONCEPT_ID_1,
  FIXTURE_CONCEPT_ID_2,
  FIXTURE_POLL_ID,
  FIXTURE_CHUNK_ID,
  FIXTURE_MATCH_ID,
  FIXTURE_LIVE_LECTURE,
  FIXTURE_ACTIVE_POLL,
  FIXTURE_POLL_NEW_QUESTION_PAYLOAD,
  FIXTURE_MASTERY_UPDATED_PAYLOAD,
  FIXTURE_STUDY_GROUP_UPDATED_PAYLOAD,
  FIXTURE_TRANSCRIPT_INGEST_RESPONSE,
  FIXTURE_POLL_RESPOND_RESPONSE,
  FIXTURE_STUDY_GROUP_OPT_IN_RESPONSE,
  toPollNewQuestionEvent,
  assertPollOmitsExpectedAnswer,
  FakeRealtimePublisher,
  FakeClassroomService,
} from "../../fixtures/classroom.fixture.js";
import type { ActorContext } from "../../../src/contracts/index.js";

describe("Lane B: Classroom & Collaboration Contracts & Realtime Fixtures (P0-B-01)", () => {
  const teacherActor: ActorContext = {
    userId: FIXTURE_TEACHER_ID,
    authId: "22222222-2222-4222-8222-222222222223",
    email: "teacher@osu.edu",
    name: "Dr. Smith",
    role: "teacher",
    teacherId: FIXTURE_TEACHER_ID,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: FIXTURE_STUDENT_ID,
    authId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    email: "student@osu.edu",
    name: "Hari",
    role: "student",
    enrolledCourses: [
      {
        studentId: FIXTURE_STUDENT_ID,
        courseId: FIXTURE_COURSE_ID,
      },
    ],
  };

  describe("1. Realtime Socket Payloads from docs/contracts/examples.md (CP-P0-B-01)", () => {
    it("validates poll:new-question socket event payload exactly as documented", () => {
      const examplePayload = {
        eventId: "66666666-6666-4666-8666-666666666601",
        occurredAt: "2026-10-20T14:35:10.000Z",
        pollId: "77777777-7777-4777-8777-777777777777",
        lectureId: "88888888-8888-4888-8888-888888888888",
        conceptId: "33333333-3333-4333-8333-333333333317",
        question:
          "What happens to the gradient descent optimization trajectory if the learning rate is chosen too large?",
        status: "active",
        activatedAt: "2026-10-20T14:35:09.500Z",
      };

      const result = pollNewQuestionEventSchema.safeParse(examplePayload);
      expect(result.success).toBe(true);
      expect(pollNewQuestionEventSchema.safeParse(FIXTURE_POLL_NEW_QUESTION_PAYLOAD).success).toBe(true);
    });

    it("validates mastery:updated socket event payload exactly as documented", () => {
      const examplePayload = {
        eventId: "66666666-6666-4666-8666-666666666602",
        occurredAt: "2026-10-20T14:36:02.120Z",
        studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conceptId: "33333333-3333-4333-8333-333333333317",
        confidence: 0.85,
        band: "green",
        evidenceType: "poll",
        attempts: 1,
        version: 2,
      };

      const result = masteryUpdatedEventSchema.safeParse(examplePayload);
      expect(result.success).toBe(true);
      expect(masteryUpdatedEventSchema.safeParse(FIXTURE_MASTERY_UPDATED_PAYLOAD).success).toBe(true);
    });

    it("validates study-group:updated socket event payload exactly as documented", () => {
      const examplePayload = {
        eventId: "66666666-6666-4666-8666-666666666603",
        occurredAt: "2026-10-20T16:12:45.000Z",
        matchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        schedulingStatus: "accepted",
        proposedSlot: {
          startsAt: "2026-10-21T15:00:00.000Z",
          endsAt: "2026-10-21T15:30:00.000Z",
        },
        student1Accepted: true,
        student2Accepted: true,
        zoomLink: "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
        meetingStatus: "created",
      };

      const result = studyGroupUpdatedEventSchema.safeParse(examplePayload);
      expect(result.success).toBe(true);
      expect(studyGroupUpdatedEventSchema.safeParse(FIXTURE_STUDY_GROUP_UPDATED_PAYLOAD).success).toBe(true);
    });

    it("validates POST /api/lectures/:lectureId/transcript response fixture", () => {
      const examplePayload = {
        chunkId: "55555555-5555-4555-8555-555555555555",
        detectedConceptIds: [
          "33333333-3333-4333-8333-333333333316",
          "33333333-3333-4333-8333-333333333317",
        ],
      };

      const result = transcriptIngestResponseSchema.safeParse(examplePayload);
      expect(result.success).toBe(true);
      expect(transcriptIngestResponseSchema.safeParse(FIXTURE_TRANSCRIPT_INGEST_RESPONSE).success).toBe(true);
    });

    it("validates POST /api/polls/:pollId/respond response fixture", () => {
      const examplePayload = {
        responseId: "99999999-9999-4999-8999-999999999999",
        status: "evaluated",
        evaluation: {
          outcome: "correct",
          feedback:
            "Excellent reasoning. You correctly identified that an excessively large learning rate causes the parameters to overshoot the local minimum and diverge.",
        },
        newConfidence: 0.85,
        newBand: "green",
      };

      const result = pollResponseResultSchema.safeParse(examplePayload);
      expect(result.success).toBe(true);
      expect(pollResponseResultSchema.safeParse(FIXTURE_POLL_RESPOND_RESPONSE).success).toBe(true);
    });

    it("validates POST /api/courses/:courseId/study-groups/opt-in response fixture", () => {
      const examplePayload = {
        status: "matched",
        matchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        expiresAt: "2026-10-20T16:05:00.000Z",
      };

      const result = studyGroupOptInResponseSchema.safeParse(examplePayload);
      expect(result.success).toBe(true);
      expect(studyGroupOptInResponseSchema.safeParse(FIXTURE_STUDY_GROUP_OPT_IN_RESPONSE).success).toBe(true);
    });
  });

  describe("2. Server-to-Client Realtime Event Schemas", () => {
    it("validates transcript:chunk events", () => {
      const valid = {
        eventId: "66666666-6666-4666-8666-666666666610",
        occurredAt: "2026-10-20T14:10:00.000Z",
        chunkId: FIXTURE_CHUNK_ID,
        lectureId: FIXTURE_LECTURE_ID,
        text: "Let's review the loss landscape for stochastic gradient descent.",
        timestampSec: 120,
        speakerName: "Dr. Smith",
      };
      expect(transcriptChunkEventSchema.safeParse(valid).success).toBe(true);

      const invalidNegativeTime = { ...valid, timestampSec: -1 };
      expect(transcriptChunkEventSchema.safeParse(invalidNegativeTime).success).toBe(false);

      const invalidEmptyText = { ...valid, text: "" };
      expect(transcriptChunkEventSchema.safeParse(invalidEmptyText).success).toBe(false);
    });

    it("validates transcript:chunk events with explicit isSimulated provenance", () => {
      const validBase = {
        eventId: "66666666-6666-4666-8666-666666666610",
        occurredAt: "2026-10-20T14:10:00.000Z",
        chunkId: FIXTURE_CHUNK_ID,
        lectureId: FIXTURE_LECTURE_ID,
        text: "Gradient descent moves against the gradient vector.",
        timestampSec: 124,
      };

      expect(transcriptChunkEventSchema.safeParse({ ...validBase, isSimulated: true }).success).toBe(true);
      expect(transcriptChunkEventSchema.safeParse({ ...validBase, isSimulated: false }).success).toBe(true);
      expect(transcriptChunkEventSchema.safeParse({ ...validBase, isSimulated: undefined }).success).toBe(true);
      expect(transcriptChunkEventSchema.safeParse(validBase).success).toBe(true);

      // Invalid types for isSimulated
      expect(transcriptChunkEventSchema.safeParse({ ...validBase, isSimulated: "true" }).success).toBe(false);
      expect(transcriptChunkEventSchema.safeParse({ ...validBase, isSimulated: 1 }).success).toBe(false);
    });

    it("validates lecture:concept-detected events", () => {
      const valid = {
        eventId: "66666666-6666-4666-8666-666666666611",
        occurredAt: "2026-10-20T14:10:05.000Z",
        lectureId: FIXTURE_LECTURE_ID,
        conceptIds: [FIXTURE_CONCEPT_ID_1, FIXTURE_CONCEPT_ID_2],
      };
      expect(conceptDetectedEventSchema.safeParse(valid).success).toBe(true);

      const invalidConceptId = { ...valid, conceptIds: ["not-a-uuid"] };
      expect(conceptDetectedEventSchema.safeParse(invalidConceptId).success).toBe(false);
    });

    it("validates poll:closed events", () => {
      const valid = {
        eventId: "66666666-6666-4666-8666-666666666612",
        occurredAt: "2026-10-20T14:38:00.000Z",
        pollId: FIXTURE_POLL_ID,
        lectureId: FIXTURE_LECTURE_ID,
        status: "closed",
        closedAt: "2026-10-20T14:38:00.000Z",
      };
      expect(pollClosedEventSchema.safeParse(valid).success).toBe(true);

      const invalidStatus = { ...valid, status: "active" };
      expect(pollClosedEventSchema.safeParse(invalidStatus).success).toBe(false);
    });

    it("validates heatmap:updated events and enforces confidence bounds", () => {
      const valid = {
        eventId: "66666666-6666-4666-8666-666666666613",
        occurredAt: "2026-10-20T14:36:10.000Z",
        courseId: FIXTURE_COURSE_ID,
        totalStudents: 45,
        conceptId: FIXTURE_CONCEPT_ID_1,
        distribution: {
          gray: 5,
          red: 10,
          yellow: 15,
          green: 15,
        },
        averageConfidence: 0.62,
      };
      expect(heatmapUpdatedEventSchema.safeParse(valid).success).toBe(true);

      const invalidConfidence = { ...valid, averageConfidence: 1.5 };
      expect(heatmapUpdatedEventSchema.safeParse(invalidConfidence).success).toBe(false);

      const nanConfidence = { ...valid, averageConfidence: Number.NaN };
      expect(heatmapUpdatedEventSchema.safeParse(nanConfidence).success).toBe(false);
    });

    it("validates lecture:ended events", () => {
      const valid = {
        eventId: "66666666-6666-4666-8666-666666666614",
        occurredAt: "2026-10-20T15:20:00.000Z",
        lectureId: FIXTURE_LECTURE_ID,
        endedAt: "2026-10-20T15:20:00.000Z",
      };
      expect(lectureEndedEventSchema.safeParse(valid).success).toBe(true);
    });

    it("validates lecture:summary-ready events", () => {
      const valid = {
        eventId: "66666666-6666-4666-8666-666666666615",
        occurredAt: "2026-10-20T15:22:00.000Z",
        lectureId: FIXTURE_LECTURE_ID,
        summary: "This lecture covered gradient descent optimization, learning rates, and divergence.",
        keyConceptsCovered: ["Gradient Descent", "Learning Rate"],
      };
      expect(lectureSummaryReadyEventSchema.safeParse(valid).success).toBe(true);
    });

    it("validates study-group:matched events", () => {
      const valid = {
        eventId: "66666666-6666-4666-8666-666666666616",
        occurredAt: "2026-10-20T16:05:00.000Z",
        matchId: FIXTURE_MATCH_ID,
        courseId: FIXTURE_COURSE_ID,
        conceptIds: [FIXTURE_CONCEPT_ID_1],
        peerName: "Rahul",
      };
      expect(studyGroupMatchedEventSchema.safeParse(valid).success).toBe(true);
    });

    it("validates study-group:message events", () => {
      const valid = {
        eventId: "66666666-6666-4666-8666-666666666617",
        occurredAt: "2026-10-20T16:06:00.000Z",
        messageId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01",
        matchId: FIXTURE_MATCH_ID,
        senderId: FIXTURE_STUDENT_ID,
        content: "Hi Rahul! Are you available to review gradient descent tomorrow at 3pm?",
      };
      expect(studyGroupMessageEventSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe("3. Client-to-Server Event & Ack Schemas", () => {
    it("validates lecture:join and lecture:leave payloads", () => {
      expect(lectureJoinPayloadSchema.safeParse({ lectureId: FIXTURE_LECTURE_ID }).success).toBe(true);
      expect(lectureJoinPayloadSchema.safeParse({ lectureId: "bad-id" }).success).toBe(false);

      expect(lectureLeavePayloadSchema.safeParse({ lectureId: FIXTURE_LECTURE_ID }).success).toBe(true);
      expect(lectureLeavePayloadSchema.safeParse({ lectureId: "bad-id" }).success).toBe(false);
    });

    it("validates study-group:join and study-group:leave payloads", () => {
      expect(studyGroupJoinPayloadSchema.safeParse({ matchId: FIXTURE_MATCH_ID }).success).toBe(true);
      expect(studyGroupLeavePayloadSchema.safeParse({ matchId: FIXTURE_MATCH_ID }).success).toBe(true);
    });

    it("validates socket acknowledgment responses", () => {
      expect(socketAckResponseSchema.safeParse({ success: true }).success).toBe(true);
      expect(socketAckResponseSchema.safeParse({ success: false, error: "FORBIDDEN" }).success).toBe(true);
    });
  });

  describe("4. Security Invariant SC-08: Expected Answer Concealment", () => {
    it("strictly rejects poll:new-question payload containing expectedAnswer", () => {
      const leakedPayload = {
        eventId: "66666666-6666-4666-8666-666666666601",
        occurredAt: "2026-10-20T14:35:10.000Z",
        pollId: FIXTURE_POLL_ID,
        lectureId: FIXTURE_LECTURE_ID,
        conceptId: FIXTURE_CONCEPT_ID_2,
        question: "What happens if learning rate is too large?",
        status: "active",
        activatedAt: "2026-10-20T14:35:09.500Z",
        expectedAnswer: "It diverges and overshoots the minimum.",
      };

      const result = pollNewQuestionEventSchema.safeParse(leakedPayload);
      expect(result.success).toBe(false);
    });

    it("strictly rejects poll:new-question payload containing rubric", () => {
      const leakedPayload = {
        eventId: "66666666-6666-4666-8666-666666666601",
        occurredAt: "2026-10-20T14:35:10.000Z",
        pollId: FIXTURE_POLL_ID,
        lectureId: FIXTURE_LECTURE_ID,
        conceptId: FIXTURE_CONCEPT_ID_2,
        question: "What happens if learning rate is too large?",
        status: "active",
        activatedAt: "2026-10-20T14:35:09.500Z",
        rubric: "Score 1.0 for mention of divergence",
      };

      const result = pollNewQuestionEventSchema.safeParse(leakedPayload);
      expect(result.success).toBe(false);
    });

    it("assertPollOmitsExpectedAnswer helper verifies safe payloads and throws on leak", () => {
      expect(() => assertPollOmitsExpectedAnswer(FIXTURE_POLL_NEW_QUESTION_PAYLOAD)).not.toThrow();

      expect(() =>
        assertPollOmitsExpectedAnswer({
          ...FIXTURE_POLL_NEW_QUESTION_PAYLOAD,
          expectedAnswer: "Secret Answer",
        })
      ).toThrow(/expectedAnswer/);
    });

    it("toPollNewQuestionEvent helper omits expectedAnswer when transforming PollQuestion", () => {
      const event = toPollNewQuestionEvent(FIXTURE_ACTIVE_POLL);
      expect(event).not.toHaveProperty("expectedAnswer");
      expect(pollNewQuestionEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe("5. Classroom Domain Schemas", () => {
    it("validates lecture session schema", () => {
      expect(lectureStatusSchema.safeParse("live").success).toBe(true);
      expect(lectureStatusSchema.safeParse("completed").success).toBe(true);
      expect(lectureStatusSchema.safeParse("pending").success).toBe(false);

      expect(lectureSessionSchema.safeParse(FIXTURE_LIVE_LECTURE).success).toBe(true);
    });

    it("validates poll question schema", () => {
      expect(pollStatusSchema.safeParse("draft").success).toBe(true);
      expect(pollStatusSchema.safeParse("active").success).toBe(true);
      expect(pollStatusSchema.safeParse("closed").success).toBe(true);

      expect(pollQuestionSchema.safeParse(FIXTURE_ACTIVE_POLL).success).toBe(true);
    });

    it("validates lecture snapshot schema and public poll projection", () => {
      const { expectedAnswer: _omitted, ...publicPoll } = FIXTURE_ACTIVE_POLL;
      expect(publicPollQuestionSchema.safeParse(publicPoll).success).toBe(true);

      const snapshot = {
        lecture: FIXTURE_LIVE_LECTURE,
        activePoll: publicPoll,
        recentChunks: [
          {
            id: FIXTURE_CHUNK_ID,
            lectureId: FIXTURE_LECTURE_ID,
            text: "Welcome to today's lecture.",
            timestampSec: 10,
            speakerName: "Dr. Smith",
            detectedConceptIds: [FIXTURE_CONCEPT_ID_1],
            createdAt: "2026-10-20T14:00:10.000Z",
          },
        ],
        activeConceptIds: [FIXTURE_CONCEPT_ID_1],
      };

      expect(lectureSnapshotSchema.safeParse(snapshot).success).toBe(true);
    });

    it("validates teacher poll schemas and response count events", () => {
      const draftInput = {
        question: "What is gradient descent optimization?",
        expectedAnswer: "An iterative first-order optimization algorithm for finding a local minimum.",
      };
      expect(pollDraftInputSchema.safeParse(draftInput).success).toBe(true);

      // Trim and length boundaries
      expect(pollDraftInputSchema.safeParse({ question: "Short?", expectedAnswer: "Too short" }).success).toBe(false);

      const summary = {
        poll: FIXTURE_ACTIVE_POLL,
        responseCount: 5,
      };
      expect(teacherPollSummarySchema.safeParse(summary).success).toBe(true);

      const teacherSnapshot = {
        lectureId: FIXTURE_LECTURE_ID,
        draft: null,
        active: summary,
        closed: null,
      };
      expect(teacherPollSnapshotSchema.safeParse(teacherSnapshot).success).toBe(true);

      const countEvent = {
        eventId: "99999999-9999-4999-8999-999999999999",
        occurredAt: "2026-10-20T14:15:00.000Z",
        lectureId: FIXTURE_LECTURE_ID,
        pollId: FIXTURE_POLL_ID,
        responseCount: 3,
      };
      expect(pollResponseCountEventSchema.safeParse(countEvent).success).toBe(true);

      // Leaking forbidden fields rejected
      expect(
        pollResponseCountEventSchema.safeParse({
          ...countEvent,
          expectedAnswer: "leak",
        }).success
      ).toBe(false);
    });

    it("validates course heatmap snapshot schema and distribution sum invariant", () => {
      const validHeatmap = {
        courseId: FIXTURE_COURSE_ID,
        totalStudents: 4,
        concepts: [
          {
            conceptId: FIXTURE_CONCEPT_ID_1,
            label: "Gradient Descent",
            category: "Optimization",
            distribution: { gray: 1, red: 1, yellow: 1, green: 1 },
            averageConfidence: 0.5,
          },
        ],
      };
      expect(courseHeatmapSnapshotSchema.safeParse(validHeatmap).success).toBe(true);

      const invalidSumHeatmap = {
        courseId: FIXTURE_COURSE_ID,
        totalStudents: 5,
        concepts: [
          {
            conceptId: FIXTURE_CONCEPT_ID_1,
            label: "Gradient Descent",
            category: "Optimization",
            distribution: { gray: 1, red: 1, yellow: 1, green: 1 }, // sum is 4 != 5
            averageConfidence: 0.5,
          },
        ],
      };
      expect(courseHeatmapSnapshotSchema.safeParse(invalidSumHeatmap).success).toBe(false);
    });
    it("validates poll response evaluation and outcome schemas", () => {
      expect(pollResponseOutcomeSchema.safeParse("correct").success).toBe(true);
      expect(pollResponseOutcomeSchema.safeParse("partial").success).toBe(true);
      expect(pollResponseOutcomeSchema.safeParse("wrong").success).toBe(true);
      expect(pollResponseOutcomeSchema.safeParse("unknown").success).toBe(false);

      const evaluation = {
        outcome: "correct",
        feedback: "Great job!",
      };
      expect(pollResponseEvaluationSchema.safeParse(evaluation).success).toBe(true);
    });

    it("validates timeInterval and studyGroupMessage schemas", () => {
      const interval = {
        startsAt: "2026-10-21T15:00:00.000Z",
        endsAt: "2026-10-21T15:30:00.000Z",
      };
      expect(timeIntervalSchema.safeParse(interval).success).toBe(true);

      const message = {
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01",
        senderId: FIXTURE_STUDENT_ID,
        content: "Let's study together",
        createdAt: "2026-10-20T16:06:00.000Z",
      };
      expect(studyGroupMessageSchema.safeParse(message).success).toBe(true);
    });
  });

  describe("6. FakeClassroomService & FakeRealtimePublisher Lifecycle", () => {
    let publisher: FakeRealtimePublisher;
    let classroomService: FakeClassroomService;

    beforeEach(() => {
      publisher = new FakeRealtimePublisher();
      classroomService = new FakeClassroomService(publisher);
    });

    it("starts a lecture session and publishes lecture:started/returns live session", async () => {
      const lecture = await classroomService.startLecture(
        teacherActor,
        FIXTURE_COURSE_ID,
        "Lecture 5: Backpropagation Deep Dive"
      );

      expect(lecture.status).toBe("live");
      expect(lecture.title).toBe("Lecture 5: Backpropagation Deep Dive");
      expect(lecture.courseId).toBe(FIXTURE_COURSE_ID);
      expect(lecture.endedAt).toBeUndefined();
    });

    it("ends an active lecture and throws 409 Conflict if ended again", async () => {
      const lecture = await classroomService.startLecture(
        teacherActor,
        FIXTURE_COURSE_ID,
        "Lecture 5"
      );

      const ended = await classroomService.endLecture(teacherActor, lecture.id);
      expect(ended.status).toBe("completed");
      expect(ended.endedAt).toBeDefined();

      // Ending again must throw 409
      await expect(classroomService.endLecture(teacherActor, lecture.id)).rejects.toThrow(AppError);
    });

    it("ingests transcript chunk and returns detected concepts", async () => {
      const lecture = await classroomService.startLecture(
        teacherActor,
        FIXTURE_COURSE_ID,
        "Lecture 5"
      );

      const chunk = await classroomService.ingestTranscriptChunk(
        teacherActor,
        lecture.id,
        "We use the chain rule to compute gradients with respect to weights.",
        45,
        "Dr. Smith"
      );

      expect(chunk.text).toContain("chain rule");
      expect(chunk.detectedConceptIds.length).toBeGreaterThan(0);
      expect(transcriptChunkSchema.safeParse(chunk).success).toBe(true);
    });

    it("generates poll, activates it, and broadcasts poll:new-question omitting expectedAnswer", async () => {
      const lecture = await classroomService.startLecture(
        teacherActor,
        FIXTURE_COURSE_ID,
        "Lecture 5"
      );

      const poll = await classroomService.generatePoll(teacherActor, lecture.id, FIXTURE_CONCEPT_ID_2);
      expect(poll.status).toBe("draft");
      expect(poll.expectedAnswer).toBeDefined();

      const activated = await classroomService.activatePoll(teacherActor, poll.id);
      expect(activated.status).toBe("active");
      expect(activated.activatedAt).toBeDefined();

      // Verify that publisher emitted poll:new-question to lecture room
      const emission = publisher.lectureEmissions.find(
        (e: { lectureId: string; event: string; payload: unknown }) => e.event === "poll:new-question"
      );
      expect(emission).toBeDefined();
      expect(emission?.lectureId).toBe(lecture.id);

      // SC-08 check: emitted payload MUST NOT have expectedAnswer
      assertPollOmitsExpectedAnswer(emission?.payload);
      expect(pollNewQuestionEventSchema.safeParse(emission?.payload).success).toBe(true);
    });

    it("enforces single active poll per lecture (409 Conflict)", async () => {
      const lecture = await classroomService.startLecture(
        teacherActor,
        FIXTURE_COURSE_ID,
        "Lecture 5"
      );

      const poll1 = await classroomService.generatePoll(teacherActor, lecture.id);
      const poll2 = await classroomService.generatePoll(teacherActor, lecture.id);

      await classroomService.activatePoll(teacherActor, poll1.id);

      // Activating poll2 while poll1 is active must throw 409
      await expect(classroomService.activatePoll(teacherActor, poll2.id)).rejects.toThrow(AppError);
    });

    it("evaluates student response and calculates mastery updates", async () => {
      const lecture = await classroomService.startLecture(
        teacherActor,
        FIXTURE_COURSE_ID,
        "Lecture 5"
      );

      const poll = await classroomService.generatePoll(teacherActor, lecture.id);
      await classroomService.activatePoll(teacherActor, poll.id);

      const result = await classroomService.respondToPoll(
        studentActor,
        poll.id,
        FIXTURE_STUDENT_ID,
        "It causes gradient descent to overshoot the minimum and diverge."
      );

      expect(result.status).toBe("evaluated");
      expect(result.evaluation.outcome).toBe("correct");
      expect(result.newConfidence).toBe(0.85);
      expect(result.newBand).toBe("green");

      // Duplicate response must throw 409
      await expect(
        classroomService.respondToPoll(studentActor, poll.id, FIXTURE_STUDENT_ID, "second try")
      ).rejects.toThrow(AppError);
    });

    it("rejects response to closed poll with 400 Bad Request", async () => {
      const lecture = await classroomService.startLecture(
        teacherActor,
        FIXTURE_COURSE_ID,
        "Lecture 5"
      );

      const poll = await classroomService.generatePoll(teacherActor, lecture.id);
      await classroomService.activatePoll(teacherActor, poll.id);
      await classroomService.closePoll(teacherActor, poll.id);

      await expect(
        classroomService.respondToPoll(studentActor, poll.id, FIXTURE_STUDENT_ID, "my answer")
      ).rejects.toThrow(AppError);
    });

    it("returns lecture snapshot including active poll and recent chunks", async () => {
      const lecture = await classroomService.startLecture(
        teacherActor,
        FIXTURE_COURSE_ID,
        "Lecture 5"
      );

      await classroomService.ingestTranscriptChunk(
        teacherActor,
        lecture.id,
        "Hello students",
        10
      );

      const poll = await classroomService.generatePoll(teacherActor, lecture.id);
      await classroomService.activatePoll(teacherActor, poll.id);

      const snapshot = await classroomService.getLectureSnapshot(studentActor, lecture.id);
      expect(snapshot.lecture.id).toBe(lecture.id);
      expect(snapshot.activePoll?.id).toBe(poll.id);
      expect(snapshot.recentChunks.length).toBe(1);
      expect(snapshot.activeConceptIds.length).toBeGreaterThan(0);
      expect(lectureSnapshotSchema.safeParse(snapshot).success).toBe(true);
    });
  });
});
