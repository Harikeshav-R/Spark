import { describe, it, expect, afterEach } from "vitest";
import type { Socket as ClientSocket } from "socket.io-client";
import {
  createTestRealtimeHarness,
  FIXTURE_IDS,
  type TestRealtimeHarness,
} from "./helpers/socket-fixture.js";
import type { SocketAckResponse } from "../../../src/contracts/realtime.js";
import { createSocketServer } from "../../../src/server/realtime/socket-server.js";
import { createRoomAuthorizer } from "../../../src/server/realtime/room-authorizer.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import { createFixtureSupabaseClient } from "./helpers/socket-fixture.js";
import { LectureRepository } from "../../../src/server/classroom/index.js";
import http from "node:http";
import { type AddressInfo } from "node:net";
import { io as ioc } from "socket.io-client";

function waitForConnect(socket: ClientSocket): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.once("connect", () => resolve());
  socket.once("connect_error", (err) => reject(err));
  return promise;
}

function waitForConnectError(socket: ClientSocket): Promise<{ message: string; data?: unknown }> {
  const { promise, resolve } = Promise.withResolvers<{ message: string; data?: unknown }>();
  socket.once("connect_error", (err: Error & { data?: unknown }) => {
    resolve({ message: err.message, data: err.data });
  });
  return promise;
}

function emitWithAck<T = SocketAckResponse>(
  socket: ClientSocket,
  event: string,
  payload: unknown
): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  socket.emit(event, payload, (res: T) => resolve(res));
  return promise;
}

function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string
): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  socket.once(event, (data: T) => {
    resolve(data);
  });
  return promise;
}

describe("P3-B-01: Authenticated Socket.IO Server & Room Authorization", () => {
  let harness: TestRealtimeHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
      harness = null;
    }
  });

  describe("1. Handshake Authentication & Rejection", () => {
    it("rejects connection with UNAUTHORIZED (401) when token is missing", async () => {
      harness = await createTestRealtimeHarness();
      const client = await harness.connectClient({});
      const error = await waitForConnectError(client);

      expect(error.message).toBe("UNAUTHORIZED");
      expect(error.data).toMatchObject({
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
      expect(client.connected).toBe(false);
    });

    it("rejects connection with UNAUTHORIZED (401) for invalid token", async () => {
      harness = await createTestRealtimeHarness();
      const client = await harness.connectClient({ token: "invalid-token-xyz" });
      const error = await waitForConnectError(client);

      expect(error.message).toBe("UNAUTHORIZED");
      expect(error.data).toMatchObject({
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
      expect(client.connected).toBe(false);
    });

    it("rejects connection with SERVICE_UNAVAILABLE (503) when auth service is down", async () => {
      harness = await createTestRealtimeHarness({ authUnavailable: true });
      const client = await harness.connectClient({ token: FIXTURE_IDS.studentDual.token });
      const error = await waitForConnectError(client);

      expect(error.message).toBe("SERVICE_UNAVAILABLE");
      expect(error.data).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
      expect(client.connected).toBe(false);
    });
  });

  describe("2. Role Spoofing & Identity Isolation", () => {
    it("ignores client-supplied role, userId, and studentId, deriving identity purely from verified token", async () => {
      harness = await createTestRealtimeHarness();
      // Student tries to spoof teacher role and teacher ID in auth handshake
      const client = await harness.connectClient({
        token: FIXTURE_IDS.studentDual.token,
        role: "teacher",
        userId: FIXTURE_IDS.teacher1.authId,
        teacherId: FIXTURE_IDS.teacher1.teacherId,
      });
      await waitForConnect(client);
      expect(client.connected).toBe(true);

      // Student joins Lecture 1 (enrolled) -> should succeed
      const joinRes = await emitWithAck(client, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });
      expect(joinRes).toEqual({ success: true });

      // Student tries to join Lecture of a course they are not enrolled in (Lecture 2 requires CS201 which studentDual has, but let's check an unowned lecture)
      const unownedLectureId = "66666666-6666-4666-8666-999999999999";
      const unownedJoinRes = await emitWithAck(client, "lecture:join", {
        lectureId: unownedLectureId,
      });
      expect(unownedJoinRes).toEqual({
        success: false,
        error: "FORBIDDEN",
      });
    });
  });

  describe("3. Lecture & Professor Room Isolation", () => {
    it("owning teacher receives lecture and teacher broadcasts; enrolled student receives only lecture broadcast", async () => {
      harness = await createTestRealtimeHarness();

      const teacherSocket = await harness.connectClient({ token: FIXTURE_IDS.teacher1.token });
      await waitForConnect(teacherSocket);

      const studentSocket = await harness.connectClient({ token: FIXTURE_IDS.studentDual.token });
      await waitForConnect(studentSocket);

      // Teacher joins lecture
      const teacherJoin = await emitWithAck(teacherSocket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });
      expect(teacherJoin).toEqual({ success: true });

      // Student joins lecture
      const studentJoin = await emitWithAck(studentSocket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });
      expect(studentJoin).toEqual({ success: true });

      // Set up event listeners
      const teacherLectureEventPromise = waitForEvent(teacherSocket, "transcript:chunk");
      const studentLectureEventPromise = waitForEvent(studentSocket, "transcript:chunk");

      const lecturePayload = {
        eventId: "88888888-8888-4888-8888-888888888881",
        lectureId: FIXTURE_IDS.teacher1.lectureId,
        text: "Hello class",
      };

      await harness.publisher.emitToLecture(
        FIXTURE_IDS.teacher1.lectureId,
        "transcript:chunk",
        lecturePayload
      );

      const receivedByTeacher = await teacherLectureEventPromise;
      const receivedByStudent = await studentLectureEventPromise;
      expect(receivedByTeacher).toEqual(lecturePayload);
      expect(receivedByStudent).toEqual(lecturePayload);

      // Now publish teacher-only event (heatmap:updated)
      const teacherHeatmapPromise = waitForEvent(teacherSocket, "heatmap:updated");

      let studentReceivedHeatmap = false;
      studentSocket.once("heatmap:updated", () => {
        studentReceivedHeatmap = true;
      });

      const heatmapPayload = {
        eventId: "88888888-8888-4888-8888-888888888882",
        courseId: FIXTURE_IDS.teacher1.courseId,
        conceptId: "99999999-9999-4999-8999-999999999991",
        distribution: { green: 10, yellow: 2, red: 1, gray: 0 },
      };

      await harness.publisher.emitToTeacher(
        FIXTURE_IDS.teacher1.lectureId,
        "heatmap:updated",
        heatmapPayload
      );

      const receivedHeatmap = await teacherHeatmapPromise;
      expect(receivedHeatmap).toEqual(heatmapPayload);

      // Delivery barrier on student socket: emit a lecture event and wait for it
      const barrierPayload = {
        eventId: "88888888-8888-4888-8888-888888888883",
        lectureId: FIXTURE_IDS.teacher1.lectureId,
        text: "Barrier check",
      };
      const barrierPromise = waitForEvent(studentSocket, "transcript:chunk");
      await harness.publisher.emitToLecture(
        FIXTURE_IDS.teacher1.lectureId,
        "transcript:chunk",
        barrierPayload
      );
      await barrierPromise;

      expect(studentReceivedHeatmap).toBe(false);
    });

    it("non-owning teacher receives FORBIDDEN when attempting to join a lecture", async () => {
      harness = await createTestRealtimeHarness();

      // Teacher 2 attempts to join Teacher 1's lecture
      const teacher2Socket = await harness.connectClient({ token: FIXTURE_IDS.teacher2.token });
      await waitForConnect(teacher2Socket);

      const joinRes = await emitWithAck(teacher2Socket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });

      expect(joinRes).toEqual({
        success: false,
        error: "FORBIDDEN",
      });
    });
  });

  describe("4. Student Private Rooms Isolation", () => {
    it("student automatically joins rooms for all enrolled course studentIds upon connection", async () => {
      harness = await createTestRealtimeHarness();

      // Dual-enrolled student connects
      const dualSocket = await harness.connectClient({ token: FIXTURE_IDS.studentDual.token });
      await waitForConnect(dualSocket);

      // Other student connects
      const c1Socket = await harness.connectClient({
        token: FIXTURE_IDS.studentCourse1Only.token,
      });
      await waitForConnect(c1Socket);

      // Teacher connects
      const teacherSocket = await harness.connectClient({ token: FIXTURE_IDS.teacher1.token });
      await waitForConnect(teacherSocket);

      let c1ReceivedPrivate = false;
      c1Socket.once("mastery:updated", () => {
        c1ReceivedPrivate = true;
      });

      let teacherReceivedPrivate = false;
      teacherSocket.once("mastery:updated", () => {
        teacherReceivedPrivate = true;
      });

      // Emit to dual student's course 1 student ID
      const dualEvent1Promise = waitForEvent(dualSocket, "mastery:updated");
      const masteryPayload1 = {
        eventId: "88888888-8888-4888-8888-888888888884",
        studentId: FIXTURE_IDS.studentDual.studentIdCourse1,
        confidence: 0.85,
      };

      await harness.publisher.emitToStudent(
        FIXTURE_IDS.studentDual.studentIdCourse1,
        "mastery:updated",
        masteryPayload1
      );
      const received1 = await dualEvent1Promise;
      expect(received1).toEqual(masteryPayload1);

      // Emit to dual student's course 2 student ID
      const dualEvent2Promise = waitForEvent(dualSocket, "mastery:updated");
      const masteryPayload2 = {
        eventId: "88888888-8888-4888-8888-888888888885",
        studentId: FIXTURE_IDS.studentDual.studentIdCourse2,
        confidence: 0.92,
      };

      await harness.publisher.emitToStudent(
        FIXTURE_IDS.studentDual.studentIdCourse2,
        "mastery:updated",
        masteryPayload2
      );
      const received2 = await dualEvent2Promise;
      expect(received2).toEqual(masteryPayload2);

      // Barrier check on c1Socket
      const barrierPromise = waitForEvent(c1Socket, "c1:barrier");
      c1Socket.emit("ping:custom", {}, () => {});
      // Emit to c1Socket's private room to verify it receives its own events
      await harness.publisher.emitToStudent(
        FIXTURE_IDS.studentCourse1Only.studentIdCourse1,
        "c1:barrier",
        { ok: true }
      );
      await barrierPromise;

      expect(c1ReceivedPrivate).toBe(false);
      expect(teacherReceivedPrivate).toBe(false);

      // Emitting to auth ID must not reach enrollment rooms
      let dualReceivedAuthIdEvent = false;
      dualSocket.once("auth:private", () => {
        dualReceivedAuthIdEvent = true;
      });
      await harness.publisher.emitToStudent(
        FIXTURE_IDS.studentDual.authId,
        "auth:private",
        { ok: true }
      );
      // Barrier check
      const dualBarrierPromise = waitForEvent(dualSocket, "mastery:updated");
      await harness.publisher.emitToStudent(
        FIXTURE_IDS.studentDual.studentIdCourse1,
        "mastery:updated",
        { barrier: true }
      );
      await dualBarrierPromise;
      expect(dualReceivedAuthIdEvent).toBe(false);
    });
  });

  describe("5. Concurrent Lecture Subscriptions & Clean Leave", () => {
    it("maintains independent lecture memberships; leave stops events for left lecture while retaining others", async () => {
      harness = await createTestRealtimeHarness();

      const dualSocket = await harness.connectClient({ token: FIXTURE_IDS.studentDual.token });
      await waitForConnect(dualSocket);

      // Join Lecture 1
      const join1 = await emitWithAck(dualSocket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });
      expect(join1).toEqual({ success: true });

      // Join Lecture 2
      const join2 = await emitWithAck(dualSocket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher2.lectureId,
      });
      expect(join2).toEqual({ success: true });

      // Leave Lecture 1
      const leave1 = await emitWithAck(dualSocket, "lecture:leave", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });
      expect(leave1).toEqual({ success: true });

      let receivedL1 = false;
      dualSocket.once("transcript:chunk", (data: { lectureId: string }) => {
        if (data.lectureId === FIXTURE_IDS.teacher1.lectureId) {
          receivedL1 = true;
        }
      });

      // Publish to Lecture 1
      await harness.publisher.emitToLecture(
        FIXTURE_IDS.teacher1.lectureId,
        "transcript:chunk",
        { lectureId: FIXTURE_IDS.teacher1.lectureId, text: "L1 text" }
      );

      // Publish to Lecture 2 (should still be received!)
      const l2Promise = waitForEvent(dualSocket, "transcript:chunk");
      await harness.publisher.emitToLecture(
        FIXTURE_IDS.teacher2.lectureId,
        "transcript:chunk",
        { lectureId: FIXTURE_IDS.teacher2.lectureId, text: "L2 text" }
      );
      const l2Data = await l2Promise;
      expect(l2Data).toEqual({
        lectureId: FIXTURE_IDS.teacher2.lectureId,
        text: "L2 text",
      });

      expect(receivedL1).toBe(false);
    });
  });

  describe("6. Validation & Error Resilience", () => {
    it("handles malformed payload, missing ack, and server errors without crashing", async () => {
      harness = await createTestRealtimeHarness();

      const studentSocket = await harness.connectClient({ token: FIXTURE_IDS.studentDual.token });
      await waitForConnect(studentSocket);

      // 1. Malformed payload
      const badAck = await emitWithAck(studentSocket, "lecture:join", {
        lectureId: "not-a-uuid",
      });
      expect(badAck).toEqual({
        success: false,
        error: "VALIDATION_ERROR",
      });

      // 2. Missing/non-callable ack: should not throw or crash server
      studentSocket.emit("lecture:join", { lectureId: FIXTURE_IDS.teacher1.lectureId });

      // 3. Unknown event
      studentSocket.emit("unknown:event", { foo: "bar" });

      // 4. Valid subsequent request succeeds normally
      const goodAck = await emitWithAck(studentSocket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });
      expect(goodAck).toEqual({ success: true });
    });
  });

  describe("7. Deterministic Join/Leave Serialization", () => {
    it("serializes concurrent join and leave requests in arrival order without race conditions", async () => {
      const supabase = createFixtureSupabaseClient();
      const auth = createAuthGateway(supabase, supabase);
      const realAuthorizer = createRoomAuthorizer(supabase);

      const { promise: gatePromise, resolve: releaseGate } = Promise.withResolvers<void>();

      // Gated authorizer: pauses on lecture1 authorization
      const gatedAuthorizer = {
        async authorizeRoom(actor: Parameters<typeof realAuthorizer.authorizeRoom>[0], room: string) {
          if (room.includes(FIXTURE_IDS.teacher1.lectureId)) {
            await gatePromise;
          }
          return realAuthorizer.authorizeRoom(actor, room);
        },
      };

      const httpServer = http.createServer();
      const lectures = new LectureRepository(supabase);
      const { io } = createSocketServer(httpServer, {
        auth,
        rooms: gatedAuthorizer,
        lectures,
        origin: "*",
      });

      const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<void>();
      httpServer.listen(0, "127.0.0.1", () => listenResolve());
      await listenPromise;

      const port = (httpServer.address() as AddressInfo).port;
      const client = ioc(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        auth: { token: FIXTURE_IDS.teacher1.token },
      });
      await waitForConnect(client);

      const order: string[] = [];

      // Issue join and immediately issue leave
      const joinPromise = emitWithAck(client, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      }).then((res) => {
        order.push("join");
        return res;
      });

      const leavePromise = emitWithAck(client, "lecture:leave", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      }).then((res) => {
        order.push("leave");
        return res;
      });

      // Release gate to let join complete
      releaseGate();

      const [joinRes, leaveRes] = await Promise.all([joinPromise, leavePromise]);

      expect(joinRes).toEqual({ success: true });
      expect(leaveRes).toEqual({ success: true });
      expect(order).toEqual(["join", "leave"]);

      // Verify socket is not in lecture or professor room
      const serverSockets = await io.fetchSockets();
      expect(serverSockets.length).toBe(1);
      const serverSocket = serverSockets[0];
      expect(serverSocket.rooms.has(`lecture:${FIXTURE_IDS.teacher1.lectureId}`)).toBe(false);
      expect(serverSocket.rooms.has(`professor:${FIXTURE_IDS.teacher1.lectureId}`)).toBe(false);

      client.disconnect();
      const { promise: closePromise, resolve: closeResolve } = Promise.withResolvers<void>();
      io.close(() => closeResolve());
      await closePromise;
      if (httpServer.listening) {
        const { promise: httpClose, resolve: httpResolve } = Promise.withResolvers<void>();
        httpServer.close(() => httpResolve());
        await httpClose;
      }
    });
  });

  describe("8. Publisher Study Group Delivery", () => {
    it("delivers events to synthetic study group rooms correctly", async () => {
      harness = await createTestRealtimeHarness();

      const client1 = await harness.connectClient({ token: FIXTURE_IDS.studentDual.token });
      await waitForConnect(client1);

      const client2 = await harness.connectClient({
        token: FIXTURE_IDS.studentCourse1Only.token,
      });
      await waitForConnect(client2);

      const matchId1 = "77777777-7777-4777-8777-777777777771";
      const matchId2 = "77777777-7777-4777-8777-777777777772";

      // Join server-side sockets to test study group rooms directly
      const serverSockets = await harness.io.fetchSockets();
      expect(serverSockets.length).toBe(2);

      const s1 = serverSockets.find((s) => s.id === client1.id)!;
      const s2 = serverSockets.find((s) => s.id === client2.id)!;

      await s1.join(`study-group:${matchId1}`);
      await s2.join(`study-group:${matchId2}`);

      const event1Promise = waitForEvent(client1, "study-group:message");
      let client2ReceivedMessage1 = false;
      client2.on("study-group:message", (data: { matchId?: string }) => {
        if (data.matchId === matchId1) {
          client2ReceivedMessage1 = true;
        }
      });
      const messagePayload = {
        matchId: matchId1,
        content: "Hello study buddy",
      };

      await harness.publisher.emitToStudyGroup(matchId1, "study-group:message", messagePayload);

      const received1 = await event1Promise;
      expect(received1).toEqual(messagePayload);

      // Barrier check on client2
      const barrierPromise = waitForEvent(client2, "study-group:message");
      await harness.publisher.emitToStudyGroup(matchId2, "study-group:message", {
        matchId: matchId2,
        barrier: true,
      });
      await barrierPromise;

      expect(client2ReceivedMessage1).toBe(false);
    });
  });

  describe("9. Presence and Multi-Tab Attendance Tracking", () => {
    it("tracks presence across multiple tabs and retains presence when one tab disconnects", async () => {
      harness = await createTestRealtimeHarness();

      const tab1 = await harness.connectClient({
        token: FIXTURE_IDS.studentCourse1Only.token,
      });
      await waitForConnect(tab1);

      const tab2 = await harness.connectClient({
        token: FIXTURE_IDS.studentCourse1Only.token,
      });
      await waitForConnect(tab2);

      const lectureId = FIXTURE_IDS.teacher1.lectureId;
      const studentId = FIXTURE_IDS.studentCourse1Only.studentIdCourse1;

      const { promise: ack1Promise, resolve: resolveAck1 } = Promise.withResolvers<SocketAckResponse>();
      tab1.emit("lecture:join", { lectureId }, (res: SocketAckResponse) => resolveAck1(res));
      const ack1 = await ack1Promise;

      const { promise: ack2Promise, resolve: resolveAck2 } = Promise.withResolvers<SocketAckResponse>();
      tab2.emit("lecture:join", { lectureId }, (res: SocketAckResponse) => resolveAck2(res));
      const ack2 = await ack2Promise;

      expect(ack1.success).toBe(true);
      expect(ack2.success).toBe(true);

      expect(harness.presence.getAttendingStudentIds(lectureId)).toEqual([studentId]);

      // Await server-side socket disconnect event directly
      const serverTab1 = tab1.id ? harness.io.sockets.sockets.get(tab1.id) : undefined;
      const { promise: serverDisconnectPromise, resolve: resolveDisconnect } = Promise.withResolvers<void>();
      serverTab1?.on("disconnect", () => resolveDisconnect());

      tab1.disconnect();
      await serverDisconnectPromise;

      // Attendance should still be retained because tab 2 is connected
      expect(harness.presence.getAttendingStudentIds(lectureId)).toEqual([studentId]);
    });

    it("explicit leave on one tab retains presence; explicit leave on last tab removes presence immediately", async () => {
      harness = await createTestRealtimeHarness();

      const tab1 = await harness.connectClient({
        token: FIXTURE_IDS.studentCourse1Only.token,
      });
      await waitForConnect(tab1);

      const tab2 = await harness.connectClient({
        token: FIXTURE_IDS.studentCourse1Only.token,
      });
      await waitForConnect(tab2);

      const lectureId = FIXTURE_IDS.teacher1.lectureId;
      const studentId = FIXTURE_IDS.studentCourse1Only.studentIdCourse1;

      const { promise: join1, resolve: resolveJoin1 } = Promise.withResolvers<SocketAckResponse>();
      tab1.emit("lecture:join", { lectureId }, (res: SocketAckResponse) => resolveJoin1(res));
      await join1;

      const { promise: join2, resolve: resolveJoin2 } = Promise.withResolvers<SocketAckResponse>();
      tab2.emit("lecture:join", { lectureId }, (res: SocketAckResponse) => resolveJoin2(res));
      await join2;

      expect(harness.presence.getAttendingStudentIds(lectureId)).toEqual([studentId]);

      // Explicit leave tab1
      const { promise: leave1, resolve: resolveLeave1 } = Promise.withResolvers<SocketAckResponse>();
      tab1.emit("lecture:leave", { lectureId }, (res: SocketAckResponse) => resolveLeave1(res));
      const leaveAck1 = await leave1;
      expect(leaveAck1.success).toBe(true);
      expect(harness.presence.getAttendingStudentIds(lectureId)).toEqual([studentId]);

      // Explicit leave tab2
      const { promise: leave2, resolve: resolveLeave2 } = Promise.withResolvers<SocketAckResponse>();
      tab2.emit("lecture:leave", { lectureId }, (res: SocketAckResponse) => resolveLeave2(res));
      const leaveAck2 = await leave2;
      expect(leaveAck2.success).toBe(true);

      // Immediately removed without grace timer
      expect(harness.presence.getAttendingStudentIds(lectureId)).toEqual([]);
    });

    it("teachers and unauthorized student joins never create student presence", async () => {
      harness = await createTestRealtimeHarness();

      const teacherClient = await harness.connectClient({
        token: FIXTURE_IDS.teacher1.token,
      });
      await waitForConnect(teacherClient);

      const lectureId = FIXTURE_IDS.teacher1.lectureId;

      const { promise: teacherJoin, resolve: resolveTeacherJoin } = Promise.withResolvers<SocketAckResponse>();
      teacherClient.emit("lecture:join", { lectureId }, (res: SocketAckResponse) => resolveTeacherJoin(res));
      const teacherAck = await teacherJoin;
      expect(teacherAck.success).toBe(true);
      // Teacher should not be in student presence
      expect(harness.presence.getAttendingStudentIds(lectureId)).toEqual([]);

      // Student joins lecture they are not enrolled in
      const unauthStudent = await harness.connectClient({
        token: FIXTURE_IDS.studentCourse1Only.token,
      });
      await waitForConnect(unauthStudent);

      const { promise: unauthJoin, resolve: resolveUnauthJoin } = Promise.withResolvers<SocketAckResponse>();
      unauthStudent.emit("lecture:join", { lectureId: FIXTURE_IDS.teacher2.lectureId }, (res: SocketAckResponse) => resolveUnauthJoin(res));
      const unauthAck = await unauthJoin;
      expect(unauthAck.success).toBe(false);
      expect(unauthAck.error).toBe("FORBIDDEN");
      expect(harness.presence.getAttendingStudentIds(FIXTURE_IDS.teacher2.lectureId)).toEqual([]);
    });

    it("isolates dual-course student memberships to their respective course-specific student IDs", async () => {
      harness = await createTestRealtimeHarness();

      const client = await harness.connectClient({
        token: FIXTURE_IDS.studentDual.token,
      });
      await waitForConnect(client);

      const { promise: join1, resolve: resolveJoin1 } = Promise.withResolvers<SocketAckResponse>();
      client.emit("lecture:join", { lectureId: FIXTURE_IDS.teacher1.lectureId }, (res: SocketAckResponse) => resolveJoin1(res));
      const ack1 = await join1;

      const { promise: join2, resolve: resolveJoin2 } = Promise.withResolvers<SocketAckResponse>();
      client.emit("lecture:join", { lectureId: FIXTURE_IDS.teacher2.lectureId }, (res: SocketAckResponse) => resolveJoin2(res));
      const ack2 = await join2;

      expect(ack1.success).toBe(true);
      expect(ack2.success).toBe(true);

      expect(harness.presence.getAttendingStudentIds(FIXTURE_IDS.teacher1.lectureId)).toEqual([
        FIXTURE_IDS.studentDual.studentIdCourse1,
      ]);
      expect(harness.presence.getAttendingStudentIds(FIXTURE_IDS.teacher2.lectureId)).toEqual([
        FIXTURE_IDS.studentDual.studentIdCourse2,
      ]);
    });
  });
});
