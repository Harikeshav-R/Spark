import http from "node:http";
import { type AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type {
  ActorContext,
  Clock,
  ISOTimestamp,
} from "../../../src/contracts/common.js";
import type {
  RealtimePublisher,
  SocketAckResponse,
  StudyGroupMessageEvent,
} from "../../../src/contracts/realtime.js";
import { createSocketServer } from "../../../src/server/realtime/socket-server.js";
import { createRoomAuthorizer } from "../../../src/server/realtime/room-authorizer.js";
import { LectureRepository } from "../../../src/server/classroom/index.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import {
  MessagingRepository,
  MessagingService,
} from "../../../src/server/study-groups/index.js";
import {
  createTestRealtimeHarness,
  createFixtureSupabaseClient,
  FIXTURE_IDS,
  type TestRealtimeHarness,
} from "./helpers/socket-fixture.js";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../lane-a/supabase-harness.js";
import {
  EnrollmentService,
  EnrollmentRepository,
  CryptoIdGenerator,
} from "../../../src/server/core/index.js";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowISO(): ISOTimestamp {
    return new Date().toISOString();
  }
}

function waitForConnect(socket: ClientSocket): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.once("connect", () => resolve());
  socket.once("connect_error", (err) => reject(err));
  return promise;
}

function emitWithAck<T = SocketAckResponse>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  socket.emit(event, payload, (res: T) => resolve(res));
  return promise;
}

describe("P6-B-02: Peer Messaging Integration (Offline Suite)", () => {
  let harness: TestRealtimeHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
      harness = null;
    }
  });

  const courseId = FIXTURE_IDS.teacher1.courseId;
  const student1Id = FIXTURE_IDS.studentDual.studentIdCourse1;
  const student2Id = FIXTURE_IDS.studentCourse1Only.studentIdCourse1;
  const matchId = "77777777-7777-4777-8777-777777777771";
  const matchId2 = "77777777-7777-4777-8777-777777777772";

  const offlineTableRows = {
    study_group_matches: [
      {
        id: matchId,
        course_id: courseId,
        student1_id: student1Id,
        student2_id: student2Id,
        concept_ids: ["99999999-9999-4999-8999-999999999999"],
        status: "active",
      },
      {
        id: matchId2,
        course_id: courseId,
        student1_id: student1Id,
        student2_id: student2Id,
        concept_ids: ["99999999-9999-4999-8999-999999999999"],
        status: "active",
      },
    ],
    study_group_messages: [] as Record<string, unknown>[],
  };

  it("completes full send, persist, and socket broadcast flow to matched peer", async () => {
    harness = await createTestRealtimeHarness({
      tableRows: offlineTableRows,
    });

    const client1 = await harness.connectClient({
      token: FIXTURE_IDS.studentDual.token,
    });
    const client2 = await harness.connectClient({
      token: FIXTURE_IDS.studentCourse1Only.token,
    });
    await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

    const joinAck1 = await emitWithAck(client1, "study-group:join", { matchId });
    const joinAck2 = await emitWithAck(client2, "study-group:join", { matchId });
    expect(joinAck1.success).toBe(true);
    expect(joinAck2.success).toBe(true);

    const repo = new MessagingRepository(createFixtureSupabaseClient({ tableRows: offlineTableRows }));
    const clock = new SystemClock();
    const ids = new CryptoIdGenerator();
    const messagingService = new MessagingService({
      repository: repo,
      publisher: harness.publisher,
      clock,
      ids,
    });

    const actor1: ActorContext = {
      userId: FIXTURE_IDS.studentDual.authId,
      authId: FIXTURE_IDS.studentDual.authId,
      role: "student",
      name: "Student Dual",
      email: "student_dual@example.edu",
      enrolledCourses: [{ studentId: student1Id, courseId }],
    };

    const { promise: receivedPromise, resolve: resolveReceived } =
      Promise.withResolvers<StudyGroupMessageEvent>();
    client2.on("study-group:message", (event: unknown) => {
      resolveReceived(event as StudyGroupMessageEvent);
    });

    const sentMessage = await messagingService.sendMessage(
      actor1,
      matchId,
      "Can we review backpropagation?",
    );

    expect(sentMessage.content).toBe("Can we review backpropagation?");
    expect(sentMessage.senderId).toBe(student1Id);

    const receivedEvent = await receivedPromise;
    expect(receivedEvent.messageId).toBe(sentMessage.id);
    expect(receivedEvent.matchId).toBe(matchId);
    expect(receivedEvent.senderId).toBe(student1Id);
    expect(receivedEvent.content).toBe("Can we review backpropagation?");

    // Reconstruct history
    const history = await messagingService.getMatchMessages(actor1, matchId);
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(sentMessage);
  });

  it("denies teacher actor from sending or reading messages with FORBIDDEN (403)", async () => {
    const fixtureDb = createFixtureSupabaseClient({ tableRows: offlineTableRows });
    const repo = new MessagingRepository(fixtureDb);
    const messagingService = new MessagingService({
      repository: repo,
      publisher: {
        emitToStudyGroup: async () => {},
      },
      clock: new SystemClock(),
      ids: new CryptoIdGenerator(),
    });

    const teacherActor: ActorContext = {
      userId: FIXTURE_IDS.teacher1.authId,
      authId: FIXTURE_IDS.teacher1.authId,
      role: "teacher",
      teacherId: FIXTURE_IDS.teacher1.teacherId,
      name: "Prof Teacher",
      email: "teacher1@example.edu",
      enrolledCourses: [],
    };

    await expect(
      messagingService.sendMessage(teacherActor, matchId, "Teacher message"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });

    await expect(
      messagingService.getMatchMessages(teacherActor, matchId),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("rejects non-existent match ID with FORBIDDEN (403)", async () => {
    const fixtureDb = createFixtureSupabaseClient({ tableRows: offlineTableRows });
    const repo = new MessagingRepository(fixtureDb);
    const messagingService = new MessagingService({
      repository: repo,
      publisher: {
        emitToStudyGroup: async () => {},
      },
      clock: new SystemClock(),
      ids: new CryptoIdGenerator(),
    });

    const actor1: ActorContext = {
      userId: FIXTURE_IDS.studentDual.authId,
      authId: FIXTURE_IDS.studentDual.authId,
      role: "student",
      name: "Student Dual",
      email: "student_dual@example.edu",
      enrolledCourses: [{ studentId: student1Id, courseId }],
    };

    const nonexistentMatch = "88888888-8888-4888-8888-888888888888";
    await expect(
      messagingService.sendMessage(actor1, nonexistentMatch, "Hello"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Forbidden study group access",
    });

    await expect(
      messagingService.getMatchMessages(actor1, nonexistentMatch),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Forbidden study group access",
    });
  });

  it("rejects malformed match ID with VALIDATION_ERROR (400)", async () => {
    const fixtureDb = createFixtureSupabaseClient({ tableRows: offlineTableRows });
    const repo = new MessagingRepository(fixtureDb);
    const messagingService = new MessagingService({
      repository: repo,
      publisher: {
        emitToStudyGroup: async () => {},
      },
      clock: new SystemClock(),
      ids: new CryptoIdGenerator(),
    });

    const actor1: ActorContext = {
      userId: FIXTURE_IDS.studentDual.authId,
      authId: FIXTURE_IDS.studentDual.authId,
      role: "student",
      name: "Student Dual",
      email: "student_dual@example.edu",
      enrolledCourses: [{ studentId: student1Id, courseId }],
    };

    await expect(
      messagingService.sendMessage(actor1, "invalid-match-uuid", "Hello"),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: "Invalid match ID format",
    });

    await expect(
      messagingService.getMatchMessages(actor1, "invalid-match-uuid"),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: "Invalid match ID format",
    });
  });

  it("fetches over 1,000 messages across multiple pages ordered chronologically", async () => {
    const bulkRows: Record<string, unknown>[] = [];
    const baseTime = new Date("2026-10-24T00:00:00.000Z").getTime();
    for (let i = 0; i < 1001; i++) {
      bulkRows.push({
        id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
        match_id: matchId,
        sender_id: i % 2 === 0 ? student1Id : student2Id,
        content: `Bulk message #${i}`,
        created_at: new Date(baseTime + i * 1000).toISOString(),
      });
    }

    const fixtureDb = createFixtureSupabaseClient({
      tableRows: {
        ...offlineTableRows,
        study_group_messages: bulkRows,
      },
    });

    const repo = new MessagingRepository(fixtureDb);
    const messagingService = new MessagingService({
      repository: repo,
      publisher: {
        emitToStudyGroup: async () => {},
      },
      clock: new SystemClock(),
      ids: new CryptoIdGenerator(),
    });

    const actor1: ActorContext = {
      userId: FIXTURE_IDS.studentDual.authId,
      authId: FIXTURE_IDS.studentDual.authId,
      role: "student",
      name: "Student Dual",
      email: "student_dual@example.edu",
      enrolledCourses: [{ studentId: student1Id, courseId }],
    };

    const messages = await messagingService.getMatchMessages(actor1, matchId);
    expect(messages).toHaveLength(1001);
    expect(messages[0]?.content).toBe("Bulk message #0");
    expect(messages[1000]?.content).toBe("Bulk message #1000");
  });
});

describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
  "P6-B-02: Peer Messaging (Local PostgreSQL)",
  () => {
    let harness: SupabaseTestHarness;
    let context: TestContext;
    let enrollmentService: EnrollmentService;
    let idGenerator: CryptoIdGenerator;
    let clock: SystemClock;

    let httpServer: http.Server;
    let serverAddress: AddressInfo;
    let publisher: RealtimePublisher;

    const openSockets: ClientSocket[] = [];

    beforeAll(async () => {
      harness = new SupabaseTestHarness();
      idGenerator = new CryptoIdGenerator();
      clock = new SystemClock();
      enrollmentService = new EnrollmentService(
        new EnrollmentRepository(harness.serviceClient),
      );

      const authGateway = createAuthGateway(
        harness.anonClient,
        harness.serviceClient,
      );
      const roomAuthorizer = createRoomAuthorizer(harness.serviceClient);
      const lectureRepo = new LectureRepository(harness.serviceClient);

      httpServer = http.createServer();
      const socketServer = createSocketServer(httpServer, {
        auth: authGateway,
        rooms: roomAuthorizer,
        lectures: lectureRepo,
        origin: "*",
      });
      publisher = socketServer.publisher;

      const { promise, resolve } = Promise.withResolvers<void>();
      httpServer.listen(0, "127.0.0.1", () => resolve());
      await promise;
      serverAddress = httpServer.address() as AddressInfo;
    });

    afterAll(async () => {
      for (const socket of openSockets) {
        if (socket.connected) {
          socket.disconnect();
        }
      }
      openSockets.length = 0;

      if (httpServer && httpServer.listening) {
        const { promise, resolve } = Promise.withResolvers<void>();
        httpServer.close(() => resolve());
        await promise;
      }
    });

    afterEach(async () => {
      for (const socket of openSockets) {
        if (socket.connected) {
          socket.disconnect();
        }
      }
      openSockets.length = 0;

      if (context) {
        await harness.cleanup(context);
      }
    });

    async function connectRealClient(token: string): Promise<ClientSocket> {
      const socket = ioc(`http://127.0.0.1:${serverAddress.port}`, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        auth: { token },
      });
      openSockets.push(socket);
      await waitForConnect(socket);
      return socket;
    }

    it("persists messages to study_group_messages, notifies peer via study-group room, and enforces 403 on outsiders", async () => {
      context = { users: [], teacherIds: [], courseIds: [] };

      // 1. Create course and 3 students
      const course = await harness.createTestCourse(context, { conceptCount: 2 });
      const user1 = await harness.createTestUser(context, "student", { name: "Student 1" });
      const user2 = await harness.createTestUser(context, "student", { name: "Student 2" });
      const user3 = await harness.createTestUser(context, "student", { name: "Student 3 Outsider" });

      const student1Enrollment = await enrollmentService.enrollStudent(
        harness.buildStudentActor(user1),
        course.joinCode,
      );
      const student2Enrollment = await enrollmentService.enrollStudent(
        harness.buildStudentActor(user2),
        course.joinCode,
      );
      await enrollmentService.enrollStudent(
        harness.buildStudentActor(user3),
        course.joinCode,
      );

      // Canonical UUID ordering for match table check constraint
      const [student1Id, student2Id] =
        student1Enrollment.id < student2Enrollment.id
          ? [student1Enrollment.id, student2Enrollment.id]
          : [student2Enrollment.id, student1Enrollment.id];

      const matchId = randomUUID();
      const { error: matchInsertErr } = await harness.serviceClient
        .from("study_group_matches")
        .insert({
          id: matchId,
          course_id: course.courseId,
          student1_id: student1Id,
          student2_id: student2Id,
          concept_ids: course.conceptIds,
          status: "active",
        });
      expect(matchInsertErr).toBeNull();

      // Sign in all 3 users with passwords
      const { data: signIn1, error: signInErr1 } =
        await harness.anonClient.auth.signInWithPassword({
          email: user1.email,
          password: "TestPassword123!",
        });
      expect(signInErr1).toBeNull();
      const token1 = signIn1.session!.access_token;

      const { data: signIn2, error: signInErr2 } =
        await harness.anonClient.auth.signInWithPassword({
          email: user2.email,
          password: "TestPassword123!",
        });
      expect(signInErr2).toBeNull();
      const token2 = signIn2.session!.access_token;

      const { data: signIn3, error: signInErr3 } =
        await harness.anonClient.auth.signInWithPassword({
          email: user3.email,
          password: "TestPassword123!",
        });
      expect(signInErr3).toBeNull();
      const token3 = signIn3.session!.access_token;

      // Obtain verified actors through createAuthGateway
      const authGateway = createAuthGateway(
        harness.anonClient,
        harness.serviceClient,
      );
      const actor1 = await authGateway.verifyToken(token1);
      const actor2 = await authGateway.verifyToken(token2);
      const actor3 = await authGateway.verifyToken(token3);

      // Connect clients over Socket.IO
      const client1 = await connectRealClient(token1);
      const client2 = await connectRealClient(token2);
      const client3 = await connectRealClient(token3);

      // S1 and S2 join successfully; S3 is denied with FORBIDDEN
      const join1 = await emitWithAck(client1, "study-group:join", { matchId });
      const join2 = await emitWithAck(client2, "study-group:join", { matchId });
      const join3 = await emitWithAck(client3, "study-group:join", { matchId });

      expect(join1).toEqual({ success: true });
      expect(join2).toEqual({ success: true });
      expect(join3).toEqual({ success: false, error: "FORBIDDEN" });

      // Instantiate MessagingService
      const messagingRepo = new MessagingRepository(harness.serviceClient);
      const messagingService = new MessagingService({
        repository: messagingRepo,
        publisher,
        clock,
        ids: idGenerator,
      });

      // Prepare event listener on S2
      const { promise: s2ReceivedPromise, resolve: resolveS2Received } =
        Promise.withResolvers<StudyGroupMessageEvent>();
      client2.on("study-group:message", (event) => {
        resolveS2Received(event as StudyGroupMessageEvent);
      });

      // S1 sends message
      const s1Sent = await messagingService.sendMessage(
        actor1,
        matchId,
        "Can we review backpropagation?",
      );

      expect(s1Sent.content).toBe("Can we review backpropagation?");
      expect(s1Sent.senderId).toBe(student1Enrollment.id);

      // S2 receives real-time broadcast
      const s2Event = await s2ReceivedPromise;
      expect(s2Event.messageId).toBe(s1Sent.id);
      expect(s2Event.matchId).toBe(matchId);
      expect(s2Event.senderId).toBe(student1Enrollment.id);
      expect(s2Event.content).toBe("Can we review backpropagation?");

      // Verify row exists directly in PostgreSQL catalog table
      const { data: dbRow, error: dbErr } = await harness.serviceClient
        .from("study_group_messages")
        .select("id, match_id, sender_id, content, created_at")
        .eq("id", s1Sent.id)
        .single();
      expect(dbErr).toBeNull();
      expect(dbRow).not.toBeNull();
      expect(dbRow!.content).toBe("Can we review backpropagation?");
      expect(dbRow!.match_id).toBe(matchId);

      // Reconstruct history with a fresh repository and service instance
      const freshRepo = new MessagingRepository(harness.serviceClient);
      const freshService = new MessagingService({
        repository: freshRepo,
        publisher,
        clock,
        ids: idGenerator,
      });

      const historyAfterS1 = await freshService.getMatchMessages(actor1, matchId);
      expect(historyAfterS1).toHaveLength(1);
      expect(historyAfterS1[0]).toEqual(s1Sent);

      // S2 sends reply
      const s2Sent = await freshService.sendMessage(
        actor2,
        matchId,
        "Yes! Let's start with gradient descent.",
      );
      expect(s2Sent.senderId).toBe(student2Enrollment.id);

      // History contains both messages ordered chronologically
      const historyAfterS2 = await freshService.getMatchMessages(actor1, matchId);
      expect(historyAfterS2).toHaveLength(2);
      expect(historyAfterS2[0]?.id).toBe(s1Sent.id);
      expect(historyAfterS2[1]?.id).toBe(s2Sent.id);

      // Outsider S3 is rejected on read and send (403)
      await expect(
        freshService.getMatchMessages(actor3, matchId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      await expect(
        freshService.sendMessage(actor3, matchId, "Outsider intruder"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      // S2 leaves room; S1 sends a 3rd message; S2 receives no event
      const leaveAck = await emitWithAck(client2, "study-group:leave", { matchId });
      expect(leaveAck).toEqual({ success: true });

      let s2ReceivedAfterLeave = false;
      client2.on("study-group:message", () => {
        s2ReceivedAfterLeave = true;
      });

      await freshService.sendMessage(actor1, matchId, "Are you still there?");

      // Barrier: roundtrip ack on client2
      const barrierAck = await emitWithAck(client2, "study-group:leave", { matchId });
      expect(barrierAck.success).toBe(true);
      expect(s2ReceivedAfterLeave).toBe(false);

      // Full history has 3 messages
      const finalHistory = await freshService.getMatchMessages(actor1, matchId);
      expect(finalHistory).toHaveLength(3);
    });
  },
);
