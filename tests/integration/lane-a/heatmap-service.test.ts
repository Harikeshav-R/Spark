import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { io as createClientSocket, type Socket as ClientSocket } from "socket.io-client";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";
import {
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
  EnrollmentRepository,
  EnrollmentService,
  HeatmapService,
  MasteryRepository,
  MasteryService,
} from "../../../src/server/core/index.js";
import { OpenRouterClient } from "../../../src/server/ai/index.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import { createServer, type ServerInstance } from "../../../server/index.js";
import type { HeatmapUpdatedEvent } from "../../../src/contracts/realtime.js";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

describe.skipIf(isFixtureMode)(
  "P4-A-02: Course Heatmap Aggregation Service & Runtime Integration Tests (live local PostgreSQL)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let courseService: CourseService;
    let masteryService: MasteryService;
    let heatmapService: HeatmapService;
    let currentContext: TestContext;
    let serverInstance: ServerInstance | null = null;
    const clientSockets: ClientSocket[] = [];

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const client = harness.serviceClient;
      enrollmentService = new EnrollmentService(new EnrollmentRepository(client));
      courseService = new CourseService(new CourseRepository(client), new CryptoIdGenerator());
      masteryService = new MasteryService(new MasteryRepository(client));
      heatmapService = new HeatmapService({
        client,
        courses: courseService,
        publisher: {
          emitToTeacher: async () => {},
        },
        clock: {
          now: () => new Date(),
          nowISO: () => new Date().toISOString(),
        },
        ids: new CryptoIdGenerator(),
      });
    });

    afterEach(async () => {
      for (const socket of clientSockets) {
        if (socket.connected) {
          socket.disconnect();
        }
      }
      clientSockets.length = 0;

      if (serverInstance) {
        const io = serverInstance.io;
        const httpServer = serverInstance.httpServer;
        serverInstance = null;

        const { promise: ioPromise, resolve: ioResolve } = Promise.withResolvers<void>();
        io.close(() => ioResolve());
        await ioPromise;

        if (httpServer.listening) {
          const { promise: httpPromise, resolve: httpResolve } = Promise.withResolvers<void>();
          httpServer.close(() => httpResolve());
          await httpPromise;
        }
      }

      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("aggregates student confidence across 4 bands (gray, red, yellow, green) and mean for course concepts", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };

      // 1. Create Course A with 2 concepts
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const concept1Id = course.conceptIds[0]!;
      const concept2Id = course.conceptIds[1]!;
      const teacherActor = harness.buildTeacherActor(
        currentContext.users.find((u) => u.authId === course.teacherAuthId)!,
        course.teacherId,
      );

      // 2. Create and enroll 4 students
      const students = [];
      const studentActors = [];
      for (let i = 0; i < 4; i++) {
        const studentUser = await harness.createTestUser(currentContext, "student");
        const student = await enrollmentService.enrollStudent(
          harness.buildStudentActor(studentUser),
          course.joinCode,
        );
        students.push(student);
        studentActors.push(
          harness.buildStudentActor(studentUser, [
            { studentId: student.id, courseId: course.courseId },
          ]),
        );
      }

      // 3. Apply tutor evidence through MasteryService:
      // Student 0: 0 tutor -> confidence 0.0 -> band gray
      // Student 1: 1 tutor -> confidence 0.2 -> band red
      await masteryService.applyEvidence(studentActors[1]!, students[1]!.id, concept1Id, {
        type: "tutor",
        sourceId: randomUUID(),
      });
      // Student 2: 2 tutors -> confidence 0.4 -> band yellow
      await masteryService.applyEvidence(studentActors[2]!, students[2]!.id, concept1Id, {
        type: "tutor",
        sourceId: randomUUID(),
      });
      await masteryService.applyEvidence(studentActors[2]!, students[2]!.id, concept1Id, {
        type: "tutor",
        sourceId: randomUUID(),
      });
      // Student 3: 4 tutors -> confidence 0.8 -> band green
      for (let k = 0; k < 4; k++) {
        await masteryService.applyEvidence(studentActors[3]!, students[3]!.id, concept1Id, {
          type: "tutor",
          sourceId: randomUUID(),
        });
      }

      // 4. Retrieve course snapshot as owning teacher
      const snapshot = await heatmapService.getCourseSnapshot(teacherActor, course.courseId);

      expect(snapshot.courseId).toBe(course.courseId);
      expect(snapshot.totalStudents).toBe(4);
      expect(snapshot.concepts).toHaveLength(2);

      const c1 = snapshot.concepts.find((c) => c.conceptId === concept1Id)!;
      expect(c1.distribution).toEqual({
        gray: 1,
        red: 1,
        yellow: 1,
        green: 1,
      });
      expect(c1.averageConfidence).toBeCloseTo(0.35, 3);

      const c2 = snapshot.concepts.find((c) => c.conceptId === concept2Id)!;
      expect(c2.distribution).toEqual({
        gray: 4,
        red: 0,
        yellow: 0,
        green: 0,
      });
      expect(c2.averageConfidence).toBe(0.0);
    });

    it("enforces tenant isolation between different courses", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };

      const courseA = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const courseB = await harness.createTestCourse(currentContext, { conceptCount: 1 });

      const teacherActorA = harness.buildTeacherActor(
        currentContext.users.find((u) => u.authId === courseA.teacherAuthId)!,
        courseA.teacherId,
      );
      const teacherActorB = harness.buildTeacherActor(
        currentContext.users.find((u) => u.authId === courseB.teacherAuthId)!,
        courseB.teacherId,
      );

      const snapshotA = await heatmapService.getCourseSnapshot(teacherActorA, courseA.courseId);
      expect(snapshotA.concepts).toHaveLength(1);
      expect(snapshotA.concepts[0]!.conceptId).toBe(courseA.conceptIds[0]);

      // Teacher B cannot access Course A
      await expect(
        heatmapService.getCourseSnapshot(teacherActorB, courseA.courseId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("verifies HTTP heatmap endpoint authorization and live socket heatmap:updated broadcast", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };

      // 1. Create course with 1 concept
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0]!;
      const teacherUser = currentContext.users.find((u) => u.authId === course.teacherAuthId)!;

      // 2. Create and enroll two students
      const studentUserA = await harness.createTestUser(currentContext, "student");
      const studentUserB = await harness.createTestUser(currentContext, "student");

      await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserA),
        course.joinCode,
      );
      await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserB),
        course.joinCode,
      );

      // 3. Create live lecture session
      const lectureId = randomUUID();
      const lectureRes = await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Heatmap Live Lecture",
        status: "live",
      });
      expect(lectureRes.error).toBeNull();

      // 4. Authenticate teacher and student A
      const teacherLogin = await harness.anonClient.auth.signInWithPassword({
        email: teacherUser.email,
        password: "TestPassword123!",
      });
      expect(teacherLogin.data.session).not.toBeNull();
      const teacherToken = teacherLogin.data.session!.access_token;

      const studentLogin = await harness.anonClient.auth.signInWithPassword({
        email: studentUserA.email,
        password: "TestPassword123!",
      });
      expect(studentLogin.data.session).not.toBeNull();
      const studentToken = studentLogin.data.session!.access_token;

      // 5. Mount full server
      const authGateway = createAuthGateway(harness.anonClient, harness.serviceClient);
      const aiClient = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
      });

      serverInstance = createServer({
        auth: authGateway,
        databaseClient: harness.serviceClient,
        aiClient,
        clock: {
          now: () => new Date(),
          nowISO: () => new Date().toISOString(),
        },
        ids: new CryptoIdGenerator(),
        origin: "http://localhost:3000",
      });

      const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<number>();
      serverInstance.httpServer.listen(0, "127.0.0.1", () => {
        const address = serverInstance!.httpServer.address();
        if (address && typeof address === "object") {
          listenResolve(address.port);
        }
      });
      const port = await listenPromise;
      const baseUrl = `http://127.0.0.1:${port}`;

      // 6. Test HTTP GET /api/courses/:courseId/heatmap endpoint
      // Unauthenticated -> 401
      const resUnauth = await fetch(`${baseUrl}/api/courses/${course.courseId}/heatmap`);
      expect(resUnauth.status).toBe(401);

      // Student -> 403
      const resStudent = await fetch(`${baseUrl}/api/courses/${course.courseId}/heatmap`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      expect(resStudent.status).toBe(403);

      // Teacher -> 200 initial baseline (2 gray, mean 0)
      const resTeacher = await fetch(`${baseUrl}/api/courses/${course.courseId}/heatmap`, {
        headers: { Authorization: `Bearer ${teacherToken}` },
      });
      expect(resTeacher.status).toBe(200);
      const initialHeatmap = (await resTeacher.json()) as {
        courseId: string;
        totalStudents: number;
        concepts: Array<{
          conceptId: string;
          distribution: { gray: number; red: number; yellow: number; green: number };
          averageConfidence: number;
        }>;
      };
      expect(initialHeatmap.totalStudents).toBe(2);
      expect(initialHeatmap.concepts[0]!.distribution).toEqual({
        gray: 2,
        red: 0,
        yellow: 0,
        green: 0,
      });

      const teacherSocket = createClientSocket(baseUrl, {
        auth: { token: teacherToken },
        transports: ["websocket"],
      });
      clientSockets.push(teacherSocket);

      const studentSocket = createClientSocket(baseUrl, {
        auth: { token: studentToken },
        transports: ["websocket"],
      });
      clientSockets.push(studentSocket);

      const { promise: teacherConnPromise, resolve: teacherConnResolve } = Promise.withResolvers<void>();
      teacherSocket.on("connect", () => teacherConnResolve());
      const { promise: studentConnPromise, resolve: studentConnResolve } = Promise.withResolvers<void>();
      studentSocket.on("connect", () => studentConnResolve());
      await Promise.all([teacherConnPromise, studentConnPromise]);
      const { promise: teacherJoinPromise, resolve: teacherJoinResolve } = Promise.withResolvers<void>();
      teacherSocket.emit("lecture:join", { lectureId }, (ack: { success: boolean }) => {
        expect(ack.success).toBe(true);
        teacherJoinResolve();
      });
      await teacherJoinPromise;

      // Student joins lecture room (this also records attendance in presence tracker)
      const { promise: studentJoinPromise, resolve: studentJoinResolve } = Promise.withResolvers<void>();
      studentSocket.emit("lecture:join", { lectureId }, (ack: { success: boolean }) => {
        expect(ack.success).toBe(true);
        studentJoinResolve();
      });
      await studentJoinPromise;

      // Setup listeners for heatmap:updated event
      const { promise: teacherEventPromise, resolve: teacherEventResolve } = Promise.withResolvers<HeatmapUpdatedEvent>();
      teacherSocket.on("heatmap:updated", (payload: HeatmapUpdatedEvent) => {
        teacherEventResolve(payload);
      });

      let studentReceivedHeatmapEvent = false;
      studentSocket.on("heatmap:updated", () => {
        studentReceivedHeatmapEvent = true;
      });

      // 8. Teacher posts transcript chunk that triggers concept detection & attendance credit
      const transcriptRes = await fetch(`${baseUrl}/api/lectures/${lectureId}/transcript`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Concept 01 is the topic of this lecture.",
          timestampSec: 5,
        }),
      });
      expect(transcriptRes.status).toBe(201);

      // 9. Await teacher socket event
      const updatedEvent = await teacherEventPromise;
      expect(updatedEvent.courseId).toBe(course.courseId);
      expect(updatedEvent.totalStudents).toBe(2);
      expect(updatedEvent.conceptId).toBe(conceptId);
      // Student A attended: confidence grew from 0.0 to 0.05 (red band)
      // Student B absent: confidence 0.0 (gray band)
      expect(updatedEvent.distribution).toEqual({
        gray: 1,
        red: 1,
        yellow: 0,
        green: 0,
      });
      expect(updatedEvent.averageConfidence).toBeCloseTo(0.025, 4);

      // Student must NOT receive teacher heatmap event
      expect(studentReceivedHeatmapEvent).toBe(false);

      // 10. Immediate GET /api/courses/:courseId/heatmap must match event despite cache
      const freshGet = await fetch(`${baseUrl}/api/courses/${course.courseId}/heatmap`, {
        headers: { Authorization: `Bearer ${teacherToken}` },
      });
      expect(freshGet.status).toBe(200);
      const freshData = (await freshGet.json()) as typeof initialHeatmap;
      expect(freshData.concepts[0]!.distribution).toEqual({
        gray: 1,
        red: 1,
        yellow: 0,
        green: 0,
      });
      expect(freshData.concepts[0]!.averageConfidence).toBeCloseTo(0.025, 4);
    }, 30000);
  }
);
