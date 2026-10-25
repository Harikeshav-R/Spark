
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Clock } from "../../../src/contracts/common.js";
import { OpenRouterClient } from "../../../src/server/ai/index.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator.js";
import { createServer, type ServerInstance } from "../../../server/index.js";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness.js";
import {
  type PollResponseCountEvent,
  type HeatmapUpdatedEvent,
  type PollNewQuestionEvent,
  type PollClosedEvent,
} from "../../../src/contracts/realtime.js";

function waitForConnect(socket: ClientSocket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.once("connect", () => resolve());
  socket.once("connect_error", (err) => reject(err));
  return promise;
}

function emitWithAck<T = { success: boolean; error?: string }>(
  socket: ClientSocket,
  event: string,
  payload: unknown
): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  socket.emit(event, payload, (res: T) => resolve(res));
  return promise;
}

describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
  "P4-D-01 / Lane A: Teacher Poll Runtime & Mastery Heatmap Integration",
  () => {
    let harness: SupabaseTestHarness;
    let context: TestContext;
    let instance: ServerInstance | null = null;
    let serverUrl = "";
    const activeSockets: ClientSocket[] = [];

    const testClock: Clock = {
      now: () => new Date(),
      nowISO: () => new Date().toISOString(),
    };

    afterEach(async () => {
      for (const s of activeSockets) {
        if (s.connected) s.disconnect();
      }
      activeSockets.length = 0;

      if (instance) {
        instance.io.close();
        const { promise, resolve } = Promise.withResolvers<void>();
        instance.httpServer.close(() => resolve());
        await promise;
        instance = null;
      }

      if (context && harness) {
        await harness.cleanup(context);
      }
    });

    it("executes complete teacher poll lifecycle, response deduplication, and mastery verification", async () => {
      harness = new SupabaseTestHarness();
      context = { users: [], teacherIds: [], courseIds: [] };

      // 1. Create Course A with 2 concepts
      const courseCtx = await harness.createTestCourse(context, { conceptCount: 2 });
      const courseId = courseCtx.courseId;
      const concept1 = courseCtx.conceptIds[0]!;
      const concept2 = courseCtx.conceptIds[1]!;

      const teacherUser = context.users.find((u: { authId: string }) => u.authId === courseCtx.teacherAuthId)!;
      const { data: teacherSignIn, error: teacherSignInErr } =
        await harness.anonClient.auth.signInWithPassword({
          email: teacherUser.email,
          password: "TestPassword123!",
        });
      expect(teacherSignInErr).toBeNull();
      const teacherToken = teacherSignIn.session!.access_token;

      // 2. Create Student 1 and enroll in Course A
      const studentUser = await harness.createTestUser(context, "student");
      const studentId = randomUUID();
      const { error: studentInsertErr } = await harness.serviceClient.from("students").insert({
        id: studentId,
        auth_id: studentUser.authId,
        course_id: courseId,
        name: studentUser.name,
        email: studentUser.email,
      });
      expect(studentInsertErr).toBeNull();

      // Initialize mastery for student 1
      await harness.serviceClient.from("student_mastery").insert([
        {
          id: randomUUID(),
          student_id: studentId,
          concept_id: concept1,
          confidence: 0.0,
          attempts: 0,
          version: 1,
        },
        {
          id: randomUUID(),
          student_id: studentId,
          concept_id: concept2,
          confidence: 0.0,
          attempts: 0,
          version: 1,
        },
      ]);

      const { data: studentSignIn, error: studentSignInErr } =
        await harness.anonClient.auth.signInWithPassword({
          email: studentUser.email,
          password: "TestPassword123!",
        });
      expect(studentSignInErr).toBeNull();
      const studentToken = studentSignIn.session!.access_token;

      // 3. Create Server with real Supabase clients
      const auth = createAuthGateway(harness.serviceClient, harness.serviceClient);
      const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const ids = new CryptoIdGenerator();

      instance = createServer({
        auth,
        databaseClient: harness.serviceClient,
        aiClient,
        clock: testClock,
        ids,
      });

      const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<void>();
      instance.httpServer.listen(0, "127.0.0.1", () => listenResolve());
      await listenPromise;
      const port = (instance.httpServer.address() as AddressInfo).port;
      serverUrl = `http://127.0.0.1:${port}`;

      // 4. Teacher starts lecture
      const startLectureRes = await fetch(`${serverUrl}/api/courses/${courseId}/lectures`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Optimization & Gradients" }),
      });
      expect(startLectureRes.status).toBe(201);
      const lecture = (await startLectureRes.json()) as { id: string; status: string };
      const lectureId = lecture.id;
      expect(lecture.status).toBe("live");

      // 5. Connect Sockets for teacher and student
      const teacherSocket: ClientSocket = ioc(serverUrl, {
        auth: { token: teacherToken },
        transports: ["websocket"],
      });
      activeSockets.push(teacherSocket);
      await waitForConnect(teacherSocket);

      const studentSocket: ClientSocket = ioc(serverUrl, {
        auth: { token: studentToken },
        transports: ["websocket"],
      });
      activeSockets.push(studentSocket);
      await waitForConnect(studentSocket);

      const teacherJoin = await emitWithAck(teacherSocket, "lecture:join", { lectureId });
      expect(teacherJoin.success).toBe(true);

      const studentJoin = await emitWithAck(studentSocket, "lecture:join", { lectureId });
      expect(studentJoin.success).toBe(true);

      // Listen for socket events
      const countEvents: PollResponseCountEvent[] = [];
      teacherSocket.on("poll:response-count", (evt: PollResponseCountEvent) => countEvents.push(evt));

      const newQuestionEvents: PollNewQuestionEvent[] = [];
      studentSocket.on("poll:new-question", (evt: PollNewQuestionEvent) => newQuestionEvents.push(evt));

      const closedEvents: PollClosedEvent[] = [];
      studentSocket.on("poll:closed", (evt: PollClosedEvent) => closedEvents.push(evt));

      const heatmapEvents: HeatmapUpdatedEvent[] = [];
      teacherSocket.on("heatmap:updated", (evt: HeatmapUpdatedEvent) => heatmapEvents.push(evt));

      // 6. Teacher generates poll draft for concept 1
      const genRes = await fetch(`${serverUrl}/api/lectures/${lectureId}/poll/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ conceptId: concept1 }),
      });
      expect(genRes.status).toBe(201);
      const draftPoll = (await genRes.json()) as { id: string; status: string; question: string };
      const pollId = draftPoll.id;
      expect(draftPoll.status).toBe("draft");

      // 7. Teacher edits draft (modifies question and rubric)
      const patchRes = await fetch(`${serverUrl}/api/polls/${pollId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: "How does learning rate affect gradient descent trajectories?",
          expectedAnswer: "Large learning rates oscillate and diverge; small learning rates converge slowly.",
        }),
      });
      expect(patchRes.status).toBe(200);
      const patchedPoll = (await patchRes.json()) as { question: string; expectedAnswer: string };
      expect(patchedPoll.question).toContain("How does learning rate affect");

      // 8. Teacher views private snapshot: saved fields and response count 0 present
      const teacherPollsRes = await fetch(`${serverUrl}/api/lectures/${lectureId}/polls`, {
        headers: { Authorization: `Bearer ${teacherToken}` },
      });
      expect(teacherPollsRes.status).toBe(200);
      const teacherSnapshot = (await teacherPollsRes.json()) as {
        draft: { poll: { id: string; question: string; expectedAnswer: string }; responseCount: number };
        active: unknown;
      };
      expect(teacherSnapshot.draft.poll.id).toBe(pollId);
      expect(teacherSnapshot.draft.responseCount).toBe(0);
      expect(teacherSnapshot.draft.poll.expectedAnswer).toContain("Large learning rates oscillate");
      expect(teacherSnapshot.active).toBeNull();

      // 9. Teacher activates poll
      const activateRes = await fetch(`${serverUrl}/api/polls/${pollId}/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${teacherToken}` },
      });
      expect(activateRes.status).toBe(200);
      const activePoll = (await activateRes.json()) as { status: string };
      expect(activePoll.status).toBe("active");

      // Verify student received poll:new-question WITHOUT expectedAnswer or rubric
      await vi.waitFor(() => expect(newQuestionEvents.length).toBeGreaterThan(0), { timeout: 3000 });
      const newQuestionEvt = newQuestionEvents[0]!;
      expect(newQuestionEvt.pollId).toBe(pollId);
      expect("expectedAnswer" in newQuestionEvt).toBe(false);
      expect("rubric" in newQuestionEvt).toBe(false);

      // Verify public student snapshot strips expectedAnswer
      const studentSnapRes = await fetch(`${serverUrl}/api/lectures/${lectureId}/snapshot`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      expect(studentSnapRes.status).toBe(200);
      const studentSnapshot = (await studentSnapRes.json()) as {
        activePoll: { id: string; question: string } | null;
      };
      expect(studentSnapshot.activePoll?.id).toBe(pollId);
      expect("expectedAnswer" in (studentSnapshot.activePoll ?? {})).toBe(false);

      // 10. Student submits response
      const answer = "Large steps overshoot the minimum and diverge.";
      const respondRes = await fetch(`${serverUrl}/api/polls/${pollId}/respond`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${studentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ answer }),
      });
      expect(respondRes.status).toBe(200);
      const respondBody = (await respondRes.json()) as {
        status: string;
        evaluation: { outcome: string };
        newConfidence: number;
      };
      expect(respondBody.status).toBe("evaluated");
      expect(respondBody.evaluation.outcome).toBe("correct");
      expect(respondBody.newConfidence).toBeGreaterThanOrEqual(0.85);

      // 11. Authoritative count broadcast received by teacher (count = 1)
      await vi.waitFor(() => expect(countEvents.length).toBeGreaterThan(0), { timeout: 3000 });
      expect(countEvents[0]!.responseCount).toBe(1);
      expect(countEvents[0]!.pollId).toBe(pollId);

      // 12. Duplicate submission: must not insert duplicate row or increment count
      const dupRes = await fetch(`${serverUrl}/api/polls/${pollId}/respond`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${studentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ answer }),
      });
      expect(dupRes.status).toBe(200);

      // Check database row count in poll_responses
      const { count: dbResponseCount, error: countDbErr } = await harness.serviceClient
        .from("poll_responses")
        .select("id", { count: "exact", head: true })
        .eq("question_id", pollId);
      expect(countDbErr).toBeNull();
      expect(dbResponseCount).toBe(1);

      // Teacher snapshot count reflects exactly 1
      const teacherSnapshotAfter = await (
        await fetch(`${serverUrl}/api/lectures/${lectureId}/polls`, {
          headers: { Authorization: `Bearer ${teacherToken}` },
        })
      ).json();
      expect(teacherSnapshotAfter.active.responseCount).toBe(1);

      // 13. Verify mastery in database updated to 0.85
      const { data: masteryRow, error: masteryErr } = await harness.serviceClient
        .from("student_mastery")
        .select("confidence, attempts, version")
        .eq("student_id", studentId)
        .eq("concept_id", concept1)
        .single();
      expect(masteryErr).toBeNull();
      expect(masteryRow!.confidence).toBe(0.85);
      expect(masteryRow!.attempts).toBe(1);

      // 14. Teacher closes poll
      const closeRes = await fetch(`${serverUrl}/api/polls/${pollId}/close`, {
        method: "POST",
        headers: { Authorization: `Bearer ${teacherToken}` },
      });
      expect(closeRes.status).toBe(200);
      const closedPoll = (await closeRes.json()) as { status: string };
      expect(closedPoll.status).toBe("closed");

      // Verify student received poll:closed
      await vi.waitFor(() => expect(closedEvents.length).toBeGreaterThan(0), { timeout: 3000 });
      expect(closedEvents[0]!.pollId).toBe(pollId);

      // 15. Cross-course denial: Teacher B cannot view Course A polls or edit draft
      const courseB = await harness.createTestCourse(context, { conceptCount: 1 });
      const teacherBUser = context.users.find((u: { authId: string }) => u.authId === courseB.teacherAuthId)!;
      const { data: teacherBSignIn } = await harness.anonClient.auth.signInWithPassword({
        email: teacherBUser.email,
        password: "TestPassword123!",
      });
      const teacherBToken = teacherBSignIn.session!.access_token;

      const crossAccessRes = await fetch(`${serverUrl}/api/lectures/${lectureId}/polls`, {
        headers: { Authorization: `Bearer ${teacherBToken}` },
      });
      expect(crossAccessRes.status).toBe(403);
    });
  }
);
