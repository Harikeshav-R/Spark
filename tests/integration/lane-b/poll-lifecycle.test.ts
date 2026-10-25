import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import express from "express";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../lane-a/supabase-harness.js";
import {
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
  MasteryRepository,
  MasteryService,
  PollEvidenceService,
} from "../../../src/server/core/index.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import {
  createRoomAuthorizer,
  createSocketServer,
} from "../../../src/server/realtime/index.js";
import {
  LectureRepository,
  PollRepository,
  PollService,
} from "../../../src/server/classroom/index.js";
import type {
  PollNewQuestionEvent,
  PollClosedEvent,
  PollResponseCountEvent,
} from "../../../src/contracts/realtime.js";
import type { MasteryUpdatedEvent } from "../../../src/contracts/mastery.js";
import type { Clock } from "../../../src/contracts/common.js";
import { fixturePollEvaluation } from "../../../src/server/ai/fixtures/poll-evaluation.js";

const testClock: Clock = {
  now: () => new Date(),
  nowISO: () => new Date().toISOString(),
};

function connectClient(port: number, token: string): ClientSocket {
  return ioc(`http://127.0.0.1:${port}`, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
    autoConnect: true,
  });
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.once("connect", () => resolve());
  socket.once("connect_error", (err) => reject(err));
  return promise;
}

function emitWithAck<TResponse>(
  socket: ClientSocket,
  event: string,
  data: unknown,
): Promise<TResponse> {
  const { promise, resolve } = Promise.withResolvers<TResponse>();
  socket.emit(event, data, (response: TResponse) => resolve(response));
  return promise;
}

function waitForEvent<TPayload>(socket: ClientSocket, event: string): Promise<TPayload> {
  const { promise, resolve } = Promise.withResolvers<TPayload>();
  socket.once(event, (data: TPayload) => resolve(data));
  return promise;
}

describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
  "P4-B-01: Poll Lifecycle Integration Tests (Real Local Supabase & Socket.IO)",
  () => {
    let harness: SupabaseTestHarness;
    let context: TestContext;
    let httpServer: http.Server | null = null;
    let ioServer: { close: () => void } | null = null;
    const activeSockets: ClientSocket[] = [];

    afterEach(async () => {
      for (const s of activeSockets) {
        if (s.connected) s.disconnect();
      }
      activeSockets.length = 0;

      if (ioServer) {
        ioServer.close();
        ioServer = null;
      }
      if (httpServer) {
        const { promise, resolve } = Promise.withResolvers<void>();
        httpServer.close(() => resolve());
        await promise;
        httpServer = null;
      }
      if (context && harness) {
        await harness.cleanup(context);
      }
    });

    async function setupHarnessAndSockets() {
      harness = new SupabaseTestHarness();
      context = { users: [], teacherIds: [], courseIds: [] };

      const courseCtx = await harness.createTestCourse(context, { conceptCount: 2 });
      const conceptId = courseCtx.conceptIds[0];
      const teacherUser = context.users.find((u) => u.authId === courseCtx.teacherAuthId)!;

      const { data: teacherSignIn, error: teacherSignInErr } =
        await harness.anonClient.auth.signInWithPassword({
          email: teacherUser.email,
          password: "TestPassword123!",
        });
      expect(teacherSignInErr).toBeNull();
      const teacherToken = teacherSignIn.session!.access_token;

      const studentUser = await harness.createTestUser(context, "student");
      const studentId = randomUUID();
      const { error: studentInsertErr } = await harness.serviceClient.from("students").insert({
        id: studentId,
        auth_id: studentUser.authId,
        course_id: courseCtx.courseId,
        name: studentUser.name,
        email: studentUser.email,
      });
      expect(studentInsertErr).toBeNull();

      const { data: studentSignIn, error: studentSignInErr } =
        await harness.anonClient.auth.signInWithPassword({
          email: studentUser.email,
          password: "TestPassword123!",
        });
      expect(studentSignInErr).toBeNull();
      const studentToken = studentSignIn.session!.access_token;

      const lectureId = randomUUID();
      const { error: lectureInsertErr } = await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: courseCtx.courseId,
        title: "Poll Integration Lecture",
        status: "live",
        started_at: new Date().toISOString(),
      });
      expect(lectureInsertErr).toBeNull();

      const authGateway = createAuthGateway(harness.serviceClient, harness.serviceClient);
      const roomAuthorizer = createRoomAuthorizer(harness.serviceClient);
      const lectureRepo = new LectureRepository(harness.serviceClient);
      const pollRepo = new PollRepository(harness.serviceClient);

      const app = express();
      httpServer = http.createServer(app);
      const { io, publisher, presence } = createSocketServer(httpServer, {
        auth: authGateway,
        rooms: roomAuthorizer,
        lectures: lectureRepo,
      });
      ioServer = io;

      const courseRepo = new CourseRepository(harness.serviceClient);
      const idGen = new CryptoIdGenerator();
      const courseService = new CourseService(courseRepo, idGen);
      const masteryRepo = new MasteryRepository(harness.serviceClient);
      const masteryService = new MasteryService(masteryRepo);
      await masteryService.initializeStudentMastery(studentId, courseCtx.courseId);

      const evidenceService = new PollEvidenceService(
        harness.serviceClient,
        courseService,
        masteryService,
      );

      const pollService = new PollService({
        polls: pollRepo,
        rooms: roomAuthorizer,
        presence,
        ai: {
          evaluatePollResponse: async (_q: string, _e: string, ans: string) => fixturePollEvaluation(ans),
        },
        evidence: evidenceService,
        publisher,
        ids: idGen,
        clock: testClock,
      });

      const teacherActor = await authGateway.verifyToken(teacherToken);
      const studentActor = await authGateway.verifyToken(studentToken);

      const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<void>();
      httpServer.listen(0, "127.0.0.1", () => listenResolve());
      await listenPromise;
      const port = (httpServer.address() as AddressInfo).port;

      const teacherSocket = connectClient(port, teacherToken);
      const studentSocket = connectClient(port, studentToken);
      activeSockets.push(teacherSocket, studentSocket);
      await Promise.all([waitForConnect(teacherSocket), waitForConnect(studentSocket)]);
      // Teacher joins lecture room so they receive professor broadcasts
      const teacherJoinRes = await emitWithAck<{ success: boolean }>(teacherSocket, "lecture:join", {
        lectureId,
      });
      expect(teacherJoinRes).toEqual({ success: true });

      // Student joins lecture room so they receive broadcasts and become attending in presence tracker
      const joinRes = await emitWithAck<{ success: boolean }>(studentSocket, "lecture:join", {
        lectureId,
      });
      expect(joinRes).toEqual({ success: true });

      return {
        courseCtx,
        conceptId,
        lectureId,
        studentId,
        teacherActor,
        studentActor,
        pollService,
        pollRepo,
        masteryService,
        evidenceService,
        teacherSocket,
        studentSocket,
      };
    }

    it("executes full poll lifecycle: draft -> active -> student response -> mastery event -> closed", async () => {
      const {
        conceptId,
        lectureId,
        studentId,
        teacherActor,
        studentActor,
        pollService,
        teacherSocket,
        studentSocket,
      } = await setupHarnessAndSockets();

      // 1. Seed draft poll in PostgreSQL
      const pollId = randomUUID();
      const { error: seedErr } = await harness.serviceClient.from("poll_questions").insert({
        id: pollId,
        lecture_id: lectureId,
        concept_id: conceptId,
        question: "Explain why the gradient points in direction of steepest ascent.",
        expected_answer: "Because directional derivative is maximized when cosine of angle with gradient is 1.",
        status: "draft",
      });
      expect(seedErr).toBeNull();

      // Listen for poll:new-question broadcast on student socket
      const newQuestionPromise = waitForEvent<PollNewQuestionEvent>(
        studentSocket,
        "poll:new-question",
      );

      // 2. Activate poll
      const activatedPoll = await pollService.activatePoll(teacherActor, pollId);
      expect(activatedPoll.status).toBe("active");
      expect(activatedPoll.activatedAt).toBeDefined();

      const newQuestionEvent = await newQuestionPromise;
      expect(newQuestionEvent.pollId).toBe(pollId);
      expect(newQuestionEvent.question).toBe("Explain why the gradient points in direction of steepest ascent.");
      expect(newQuestionEvent.status).toBe("active");
      // SC-08 check: no rubric leaks
      expect(newQuestionEvent).not.toHaveProperty("expectedAnswer");
      expect(newQuestionEvent).not.toHaveProperty("rubric");

      // Verify PostgreSQL state
      const { data: dbPollActive } = await harness.serviceClient
        .from("poll_questions")
        .select("status, activated_at")
        .eq("id", pollId)
        .single();
      expect(dbPollActive?.status).toBe("active");
      expect(dbPollActive?.activated_at).toBeDefined();

      // 3. Student submits correct answer
      const countPromise = waitForEvent<PollResponseCountEvent>(
        teacherSocket,
        "poll:response-count",
      );
      const masteryPromise = waitForEvent<MasteryUpdatedEvent>(
        studentSocket,
        "mastery:updated",
      );

      const rawAnswer = "Gradient descent with excessive learning rate will overshoot the minimum and diverge.";
      const responseResult = await pollService.respondToPoll(
        studentActor,
        pollId,
        studentId,
        rawAnswer,
      );

      expect(responseResult.status).toBe("evaluated");
      expect(responseResult.evaluation.outcome).toBe("correct");
      expect(responseResult.newConfidence).toBe(0.85);
      expect(responseResult.newBand).toBe("green");

      const countEvent = await countPromise;
      expect(countEvent.pollId).toBe(pollId);
      expect(countEvent.responseCount).toBe(1);

      const masteryEvent = await masteryPromise;
      expect(masteryEvent.studentId).toBe(studentId);
      expect(masteryEvent.conceptId).toBe(conceptId);
      expect(masteryEvent.confidence).toBe(0.85);
      expect(masteryEvent.band).toBe("green");
      expect(masteryEvent.evidenceType).toBe("poll");
      expect(masteryEvent.attempts).toBe(1);

      // Verify PostgreSQL response row
      const { data: dbResponse } = await harness.serviceClient
        .from("poll_responses")
        .select("*")
        .eq("id", responseResult.responseId)
        .single();
      expect(dbResponse?.status).toBe("evaluated");
      expect(dbResponse?.evaluation?.mastery?.confidence).toBe(0.85);
      expect(dbResponse?.evaluation?.mastery?.attempts).toBe(1);

      // 4. Identical replay returns cached result without incrementing attempts or re-emitting
      let duplicateMasteryReceived = false;
      studentSocket.once("mastery:updated", () => {
        duplicateMasteryReceived = true;
      });
      let duplicateCountReceived = false;
      teacherSocket.once("poll:response-count", () => {
        duplicateCountReceived = true;
      });

      const replayResult = await pollService.respondToPoll(
        studentActor,
        pollId,
        studentId,
        rawAnswer,
      );
      expect(replayResult.responseId).toBe(responseResult.responseId);
      expect(replayResult.newConfidence).toBe(0.85);

      // Delivery barrier: same-socket acknowledgement ensures in-flight events are flushed
      await emitWithAck(teacherSocket, "lecture:join", { lectureId });
      await emitWithAck(studentSocket, "lecture:join", { lectureId });

      expect(duplicateMasteryReceived).toBe(false);
      expect(duplicateCountReceived).toBe(false);

      // Verify DB attempts remains 1
      const { data: dbMastery } = await harness.serviceClient
        .from("student_mastery")
        .select("confidence, attempts")
        .eq("student_id", studentId)
        .eq("concept_id", conceptId)
        .single();
      expect(dbMastery?.attempts).toBe(1);

      // 5. Conflicting different answer rejected with 409
      await expect(
        pollService.respondToPoll(
          studentActor,
          pollId,
          studentId,
          "Completely different second answer",
        ),
      ).rejects.toMatchObject({
        code: "RESPONSE_ALREADY_SUBMITTED",
        statusCode: 409,
      });

      // 6. Close poll
      const closedEventPromise = waitForEvent<PollClosedEvent>(studentSocket, "poll:closed");
      const closedPoll = await pollService.closePoll(teacherActor, pollId);
      expect(closedPoll.status).toBe("closed");
      expect(closedPoll.closedAt).toBeDefined();

      const closedEvent = await closedEventPromise;
      expect(closedEvent.pollId).toBe(pollId);
      expect(closedEvent.status).toBe("closed");

      // Verify PostgreSQL closed status
      const { data: dbPollClosed } = await harness.serviceClient
        .from("poll_questions")
        .select("status, closed_at")
        .eq("id", pollId)
        .single();
      expect(dbPollClosed?.status).toBe("closed");
      expect(dbPollClosed?.closed_at).toBeDefined();

      // 7. Late submission after close is rejected with 400
      await expect(
        pollService.respondToPoll(
          studentActor,
          pollId,
          studentId,
          rawAnswer,
        ),
      ).rejects.toMatchObject({
        code: "INVALID_POLL_STATUS",
        statusCode: 400,
      });
    });

    it("marks response failed and propagates 502 when AI evaluation fails", async () => {
      const {
        conceptId,
        lectureId,
        studentId,
        teacherActor,
        studentActor,
        pollRepo,
      } = await setupHarnessAndSockets();

      const pollId = randomUUID();
      await harness.serviceClient.from("poll_questions").insert({
        id: pollId,
        lecture_id: lectureId,
        concept_id: conceptId,
        question: "Difficult AI failure test question?",
        expected_answer: "Expected Answer",
        status: "draft",
      });

      // Service with failing AI
      const failingService = new PollService({
        polls: pollRepo,
        rooms: createRoomAuthorizer(harness.serviceClient),
        presence: {
          getAttendingStudentIds: () => [studentId],
        },
        ai: {
          evaluatePollResponse: async () => {
            throw new Error("Simulated upstream AI outage");
          },
        },
        evidence: {
          applyResponse: async () => {
            throw new Error("Should not be called");
          },
        },
        publisher: {
          emitToLecture: async () => {},
          emitToStudent: async () => {},
          emitToTeacher: async () => {},
        },
        ids: new CryptoIdGenerator(),
        clock: testClock,
      });

      await failingService.activatePoll(teacherActor, pollId);

      await expect(
        failingService.respondToPoll(studentActor, pollId, studentId, "Student answer"),
      ).rejects.toMatchObject({
        statusCode: 502,
      });

      // Verify row in DB is marked 'failed'
      const { data: failedResponse } = await harness.serviceClient
        .from("poll_responses")
        .select("status, answer")
        .eq("question_id", pollId)
        .eq("student_id", studentId)
        .single();

      expect(failedResponse?.status).toBe("failed");
      expect(failedResponse?.answer).toBe("Student answer");
    });

    it("enforces single active poll per lecture when two draft polls are activated concurrently", async () => {
      const {
        conceptId,
        lectureId,
        teacherActor,
        pollService,
      } = await setupHarnessAndSockets();

      const poll1 = randomUUID();
      const poll2 = randomUUID();

      await harness.serviceClient.from("poll_questions").insert([
        {
          id: poll1,
          lecture_id: lectureId,
          concept_id: conceptId,
          question: "Question 1?",
          expected_answer: "Answer 1",
          status: "draft",
        },
        {
          id: poll2,
          lecture_id: lectureId,
          concept_id: conceptId,
          question: "Question 2?",
          expected_answer: "Answer 2",
          status: "draft",
        },
      ]);

      const results = await Promise.allSettled([
        pollService.activatePoll(teacherActor, poll1),
        pollService.activatePoll(teacherActor, poll2),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify PostgreSQL state: exactly one is active
      const { data: activePolls } = await harness.serviceClient
        .from("poll_questions")
        .select("id, status")
        .eq("lecture_id", lectureId)
        .eq("status", "active");

      expect(activePolls).toHaveLength(1);
    });
  },
);
