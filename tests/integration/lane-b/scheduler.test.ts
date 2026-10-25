import http from "node:http";
import { type AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { ActorContext, Clock, ISOTimestamp } from "../../../src/contracts/common.js";
import type { RealtimePublisher, StudyGroupUpdatedEvent } from "../../../src/contracts/realtime.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import { createRoomAuthorizer } from "../../../src/server/realtime/room-authorizer.js";
import { createSocketServer } from "../../../src/server/realtime/index.js";
import { LectureRepository } from "../../../src/server/classroom/index.js";
import {
  EnrollmentRepository,
  EnrollmentService,
  CryptoIdGenerator,
} from "../../../src/server/core/index.js";
import {
  MessagingRepository,
  SchedulerRepository,
  Scheduler,
} from "../../../src/server/study-groups/index.js";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowISO(): ISOTimestamp {
    return new Date().toISOString();
  }
}
import { createFixtureSupabaseClient } from "./helpers/socket-fixture.js";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../lane-a/supabase-harness.js";

async function waitForConnect(socket: ClientSocket): Promise<void> {
  if (socket.connected) return;
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.once("connect", () => resolve());
  socket.once("connect_error", (err) => reject(err));
  await promise;
}

async function emitWithAck<T>(
  socket: ClientSocket,
  event: string,
  data: unknown
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(
    () => reject(new Error(`Timeout waiting for ack on ${event}`)),
    5000
  );
  socket.emit(event, data, (response: T) => {
    clearTimeout(timer);
    resolve(response);
  });
  return promise;
}

describe("P6-B-03: Scheduler Integration (Offline Suite)", () => {
  const courseId = "11111111-1111-4111-8111-111111111111";
  const student1Id = "22222222-2222-4222-8222-222222222221";
  const student2Id = "22222222-2222-4222-8222-222222222222";
  const auth1 = "33333333-3333-4333-8333-333333333331";
  const auth2 = "33333333-3333-4333-8333-333333333332";
  const matchId = "44444444-4444-4444-8444-444444444441";

  const actor1: ActorContext = {
    userId: auth1,
    authId: auth1,
    role: "student",
    name: "Student One",
    email: "s1@example.edu",
    enrolledCourses: [{ studentId: student1Id, courseId }],
  };

  const actor2: ActorContext = {
    userId: auth2,
    authId: auth2,
    role: "student",
    name: "Student Two",
    email: "s2@example.edu",
    enrolledCourses: [{ studentId: student2Id, courseId }],
  };

  it("completes full scheduling lifecycle: propose -> accept S1 -> accept S2 -> accepted", async () => {
    const fixtureDb = createFixtureSupabaseClient({
      tableRows: {
        students: [
          { id: student1Id, auth_id: auth1, course_id: courseId },
          { id: student2Id, auth_id: auth2, course_id: courseId },
        ],
        study_group_matches: [
          {
            id: matchId,
            course_id: courseId,
            student1_id: student1Id,
            student2_id: student2Id,
            concept_ids: ["77777777-7777-4777-8777-777777777777"],
            scheduling_status: "pending",
            proposed_start: null,
            proposed_end: null,
            student1_accepted: false,
            student2_accepted: false,
            meeting_status: "pending",
            zoom_meeting_id: null,
            zoom_link: null,
            status: "active",
          },
        ],
        student_availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: student1Id,
            course_id: courseId,
            starts_at: "2026-10-25T14:00:00.000Z",
            ends_at: "2026-10-25T16:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: student2Id,
            course_id: courseId,
            starts_at: "2026-10-25T15:00:00.000Z",
            ends_at: "2026-10-25T17:00:00.000Z",
          },
        ],
      },
    });

    const membership = new MessagingRepository(fixtureDb);
    const repository = new SchedulerRepository(fixtureDb);
    const emittedEvents: StudyGroupUpdatedEvent[] = [];
    const publisher: RealtimePublisher = {
      emitToLecture: async () => {},
      emitToTeacher: async () => {},
      emitToStudent: async () => {},
      emitToStudyGroup: async (_matchId, _event, payload) => {
        emittedEvents.push(payload as StudyGroupUpdatedEvent);
      },
    };
    const clock = new SystemClock();
    const ids = new CryptoIdGenerator();
    const meetings = {
      createForCourse: async () => ({
        meetingId: "9876543210",
        joinUrl: "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
      }),
    };

    const scheduler = new Scheduler({
      membership,
      repository,
      meetings,
      publisher,
      clock,
      ids,
    });
    // 1. Propose schedule
    const prop = await scheduler.proposeSchedule(actor1, matchId);
    expect(prop.schedulingStatus).toBe("proposed");
    expect(prop.proposedSlot).toEqual({
      startsAt: "2026-10-25T15:00:00.000Z",
      endsAt: "2026-10-25T15:30:00.000Z",
    });

    // 2. Accept as Student 1
    const accept1 = await scheduler.acceptSchedule(actor1, matchId, prop.proposedSlot!);
    expect(accept1.bothAccepted).toBe(false);

    // 3. Accept as Student 2
    const accept2 = await scheduler.acceptSchedule(actor2, matchId, prop.proposedSlot!);
    expect(accept2.bothAccepted).toBe(true);
    expect(accept2.zoomMeetingId).toBe("9876543210");
    expect(accept2.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");

    // Verify DB snapshot
    const finalMatch = await repository.getMatch(courseId, matchId);
    expect(finalMatch?.schedulingStatus).toBe("accepted");
    expect(finalMatch?.student1Accepted).toBe(true);
    expect(finalMatch?.student2Accepted).toBe(true);
    expect(finalMatch?.meetingStatus).toBe("created");
    expect(finalMatch?.zoomMeetingId).toBe("9876543210");
    expect(finalMatch?.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");

    // Verify events were emitted in order
    expect(emittedEvents).toHaveLength(3);
    expect(emittedEvents[0]?.schedulingStatus).toBe("proposed");
    expect(emittedEvents[1]?.student1Accepted).toBe(true);
    expect(emittedEvents[1]?.schedulingStatus).toBe("proposed");
    expect(emittedEvents[2]?.student2Accepted).toBe(true);
    expect(emittedEvents[2]?.schedulingStatus).toBe("accepted");
    expect(emittedEvents[2]?.meetingStatus).toBe("created");
    expect(emittedEvents[2]?.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");
  });
});
describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
  "P6-B-03: Scheduler (Local PostgreSQL & Real Realtime Server)",
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
        new EnrollmentRepository(harness.serviceClient)
      );

      const authGateway = createAuthGateway(
        harness.anonClient,
        harness.serviceClient
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

    it("verifies real PostgreSQL availability proposal, bilateral acceptance, atomic CAS, and socket broadcast", async () => {
      context = { users: [], teacherIds: [], courseIds: [] };

      // 1. Create course and 3 students
      const course = await harness.createTestCourse(context, { conceptCount: 2 });
      const user1 = await harness.createTestUser(context, "student", { name: "Student 1" });
      const user2 = await harness.createTestUser(context, "student", { name: "Student 2" });
      const user3 = await harness.createTestUser(context, "student", { name: "Student 3 Outsider" });

      const student1Enrollment = await enrollmentService.enrollStudent(
        harness.buildStudentActor(user1),
        course.joinCode
      );
      const student2Enrollment = await enrollmentService.enrollStudent(
        harness.buildStudentActor(user2),
        course.joinCode
      );
      await enrollmentService.enrollStudent(
        harness.buildStudentActor(user3),
        course.joinCode
      );

      // Canonical UUID ordering
      const [student1Id, student2Id, actorUser1, actorUser2] =
        student1Enrollment.id < student2Enrollment.id
          ? [student1Enrollment.id, student2Enrollment.id, user1, user2]
          : [student2Enrollment.id, student1Enrollment.id, user2, user1];

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

      // Seed student availability in next-day UTC
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const baseDateStr = tomorrow.toISOString().split("T")[0];

      const s1Start = `${baseDateStr}T14:00:00.000Z`;
      const s1End = `${baseDateStr}T16:00:00.000Z`;
      const s2Start = `${baseDateStr}T15:00:00.000Z`;
      const s2End = `${baseDateStr}T17:00:00.000Z`;

      const { error: availErr1 } = await harness.serviceClient
        .from("student_availability")
        .insert({
          student_id: student1Id,
          course_id: course.courseId,
          starts_at: s1Start,
          ends_at: s1End,
        });
      expect(availErr1).toBeNull();

      const { error: availErr2 } = await harness.serviceClient
        .from("student_availability")
        .insert({
          student_id: student2Id,
          course_id: course.courseId,
          starts_at: s2Start,
          ends_at: s2End,
        });
      expect(availErr2).toBeNull();

      // Sign in users with password
      const { data: signIn1 } = await harness.anonClient.auth.signInWithPassword({
        email: actorUser1.email,
        password: "TestPassword123!",
      });
      const token1 = signIn1.session!.access_token;

      const { data: signIn2 } = await harness.anonClient.auth.signInWithPassword({
        email: actorUser2.email,
        password: "TestPassword123!",
      });
      const token2 = signIn2.session!.access_token;

      const { data: signIn3 } = await harness.anonClient.auth.signInWithPassword({
        email: user3.email,
        password: "TestPassword123!",
      });
      const token3 = signIn3.session!.access_token;

      const authGateway = createAuthGateway(
        harness.anonClient,
        harness.serviceClient
      );
      const actor1 = await authGateway.verifyToken(token1);
      const actor2 = await authGateway.verifyToken(token2);
      const actor3 = await authGateway.verifyToken(token3);

      // Connect clients over Socket.IO
      const client1 = await connectRealClient(token1);
      const client2 = await connectRealClient(token2);
      const client3 = await connectRealClient(token3);

      // Join rooms
      const join1 = await emitWithAck(client1, "study-group:join", { matchId });
      const join2 = await emitWithAck(client2, "study-group:join", { matchId });
      const join3 = await emitWithAck(client3, "study-group:join", { matchId });

      expect(join1).toEqual({ success: true });
      expect(join2).toEqual({ success: true });
      expect(join3).toEqual({ success: false, error: "FORBIDDEN" });

      // Instantiate fresh services
      const membership = new MessagingRepository(harness.serviceClient);
      const repository = new SchedulerRepository(harness.serviceClient);
      const meetings = {
        createForCourse: async () => ({
          meetingId: "9876543210",
          joinUrl: "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
        }),
      };
      const scheduler = new Scheduler({
        membership,
        repository,
        meetings,
        publisher,
        clock,
        ids: idGenerator,
      });
      function nextEvent(socket: ClientSocket, eventName: string): Promise<StudyGroupUpdatedEvent> {
        const { promise, resolve } = Promise.withResolvers<StudyGroupUpdatedEvent>();
        socket.once(eventName, (evt) => resolve(evt as StudyGroupUpdatedEvent));
        return promise;
      }

      // Propose schedule and await realtime socket delivery
      const ev1Promise = nextEvent(client2, "study-group:updated");
      const propResult = await scheduler.proposeSchedule(actor1, matchId);
      expect(propResult.schedulingStatus).toBe("proposed");
      expect(propResult.proposedSlot).toEqual({
        startsAt: `${baseDateStr}T15:00:00.000Z`,
        endsAt: `${baseDateStr}T15:30:00.000Z`,
      });

      const ev1 = await ev1Promise;
      expect(ev1.schedulingStatus).toBe("proposed");
      expect(ev1.proposedSlot).toEqual(propResult.proposedSlot);

      // Student 1 accepts
      const ev2Promise = nextEvent(client2, "study-group:updated");
      const accept1 = await scheduler.acceptSchedule(
        actor1,
        matchId,
        propResult.proposedSlot!
      );
      expect(accept1.bothAccepted).toBe(false);

      const ev2 = await ev2Promise;
      expect(ev2.student1Accepted).toBe(true);
      expect(ev2.student2Accepted).toBe(false);

      // Verify directly from PostgreSQL with separate client instance
      const freshRepo = new SchedulerRepository(harness.serviceClient);
      const postgreMatch1 = await freshRepo.getMatch(course.courseId, matchId);
      expect(postgreMatch1?.student1Accepted).toBe(true);
      expect(postgreMatch1?.student2Accepted).toBe(false);
      expect(postgreMatch1?.schedulingStatus).toBe("proposed");

      // S3 outsider tries to accept -> 403
      await expect(
        scheduler.acceptSchedule(actor3, matchId, propResult.proposedSlot!)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      // Student 2 accepts using fresh scheduler instance
      const freshScheduler = new Scheduler({
        membership,
        repository: freshRepo,
        meetings,
        publisher,
        clock,
        ids: idGenerator,
      });

      const ev3Promise = nextEvent(client2, "study-group:updated");
      const accept2 = await freshScheduler.acceptSchedule(
        actor2,
        matchId,
        propResult.proposedSlot!
      );
      expect(accept2.bothAccepted).toBe(true);
      expect(accept2.zoomMeetingId).toBe("9876543210");
      expect(accept2.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");

      const ev3 = await ev3Promise;
      expect(ev3.student1Accepted).toBe(true);
      expect(ev3.student2Accepted).toBe(true);
      expect(ev3.schedulingStatus).toBe("accepted");
      expect(ev3.meetingStatus).toBe("created");
      expect(ev3.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");

      // Verify final PostgreSQL state
      const postgreMatchFinal = await freshRepo.getMatch(course.courseId, matchId);
      expect(postgreMatchFinal?.schedulingStatus).toBe("accepted");
      expect(postgreMatchFinal?.student1Accepted).toBe(true);
      expect(postgreMatchFinal?.student2Accepted).toBe(true);
      expect(postgreMatchFinal?.meetingStatus).toBe("created");
      expect(postgreMatchFinal?.zoomMeetingId).toBe("9876543210");
      expect(postgreMatchFinal?.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");
    });
  }
);
