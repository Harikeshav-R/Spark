import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "../../../src/contracts/common.js";
import {
  conceptDetectedEventSchema,
  transcriptChunkEventSchema,
  transcriptIngestResponseSchema,
} from "../../../src/contracts/index.js";
import { OpenRouterClient } from "../../../src/server/ai/index.js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator.js";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository.js";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service.js";
import { MasteryRepository } from "../../../src/server/core/mastery/mastery-repository.js";
import { MasteryService } from "../../../src/server/core/mastery/mastery-service.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import { createServer, type ServerInstance } from "../../../server/index.js";
import { SupabaseTestHarness, type TestContext } from "./supabase-harness.js";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

function waitForConnect(socket: ClientSocket): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.once("connect", () => resolve());
  socket.once("connect_error", (err) => reject(err));
  return promise;
}

function emitWithAck<T = { success: boolean; error?: string }>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  socket.emit(event, payload, (res: T) => resolve(res));
  return promise;
}

describe.skipIf(isFixtureMode)(
  "P3-B-01 / Lane A: Real Database Runtime Attendance Credit & Socket Room Verification",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let masteryService: MasteryService;
    let context: TestContext;
    let instance: ServerInstance | null = null;
    const openSockets: ClientSocket[] = [];
    let serverUrl = "";

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      enrollmentService = new EnrollmentService(
        new EnrollmentRepository(harness.serviceClient)
      );
      masteryService = new MasteryService(
        new MasteryRepository(harness.serviceClient)
      );
    });

    afterEach(async () => {
      for (const socket of openSockets) {
        if (socket.connected) {
          socket.disconnect();
        }
      }
      openSockets.length = 0;

      if (instance) {
        const io = instance.io;
        const httpServer = instance.httpServer;
        instance = null;

        const { promise: ioPromise, resolve: ioResolve } = Promise.withResolvers<void>();
        io.close(() => ioResolve());
        await ioPromise;

        if (httpServer.listening) {
          const { promise: httpPromise, resolve: httpResolve } = Promise.withResolvers<void>();
          httpServer.close(() => httpResolve());
          await httpPromise;
        }
      }

      if (context) {
        await harness.cleanup(context);
      }
    });

    it("attending student credited on concept detection; absent student remains untouched", async () => {
      context = { users: [], teacherIds: [], courseIds: [] };

      // 1. Create course with 1 concept ("Concept 01")
      const course = await harness.createTestCourse(context, { conceptCount: 1 });
      const concept1Id = course.conceptIds[0];
      const teacherUser = context.users.find((u) => u.authId === course.teacherAuthId)!;

      // 2. Create and enroll two students
      const studentUserA = await harness.createTestUser(context, "student");
      const studentUserB = await harness.createTestUser(context, "student");

      const studentA = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserA),
        course.joinCode
      );
      const studentB = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserB),
        course.joinCode
      );

      const enrolledActorA = harness.buildStudentActor(studentUserA, [
        { studentId: studentA.id, courseId: course.courseId },
      ]);
      const enrolledActorB = harness.buildStudentActor(studentUserB, [
        { studentId: studentB.id, courseId: course.courseId },
      ]);

      // Baseline mastery checks
      const baselineA = await masteryService.getMastery(enrolledActorA, studentA.id);
      const baseA = baselineA.find((m) => m.conceptId === concept1Id)!;
      expect(baseA.confidence).toBe(0);
      expect(baseA.attempts).toBe(0);
      const baselineVersionA = baseA.version;

      const baselineB = await masteryService.getMastery(enrolledActorB, studentB.id);
      const baseB = baselineB.find((m) => m.conceptId === concept1Id)!;
      expect(baseB.confidence).toBe(0);
      expect(baseB.attempts).toBe(0);
      const baselineVersionB = baseB.version;

      // 3. Create live lecture session
      const lectureId = randomUUID();
      const { error: lectureError } = await harness.serviceClient
        .from("lecture_sessions")
        .insert({
          id: lectureId,
          course_id: course.courseId,
          title: "Live Lecture on Concept 01",
          status: "live",
          started_at: new Date().toISOString(),
        });
      expect(lectureError).toBeNull();

      // 4. Authenticate teacher and student A
      const teacherLogin = await harness.anonClient.auth.signInWithPassword({
        email: teacherUser.email,
        password: "TestPassword123!",
      });
      expect(teacherLogin.error).toBeNull();
      expect(teacherLogin.data.session).not.toBeNull();
      const teacherToken = teacherLogin.data.session!.access_token;

      const studentALogin = await harness.anonClient.auth.signInWithPassword({
        email: studentUserA.email,
        password: "TestPassword123!",
      });
      expect(studentALogin.error).toBeNull();
      expect(studentALogin.data.session).not.toBeNull();
      const studentAToken = studentALogin.data.session!.access_token;

      // 5. Construct real composition root
      const auth = createAuthGateway(harness.anonClient, harness.serviceClient);
      const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const clock: Clock = {
        now: () => new Date(),
        nowISO: () => new Date().toISOString(),
      };
      const ids = new CryptoIdGenerator();

      instance = createServer({
        auth,
        databaseClient: harness.serviceClient,
        aiClient,
        clock,
        ids,
        origin: "*",
      });

      const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<void>();
      instance.httpServer.listen(0, "127.0.0.1", () => listenResolve());
      await listenPromise;

      const port = (instance.httpServer.address() as AddressInfo).port;
      serverUrl = `http://127.0.0.1:${port}`;

      // 6. Connect two sockets for Student A
      const socket1 = ioc(serverUrl, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        auth: { token: studentAToken },
      });
      openSockets.push(socket1);
      await waitForConnect(socket1);

      const socket2 = ioc(serverUrl, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        auth: { token: studentAToken },
      });
      openSockets.push(socket2);
      await waitForConnect(socket2);

      // Join lecture on both sockets
      const join1 = await emitWithAck(socket1, "lecture:join", { lectureId });
      expect(join1).toEqual({ success: true });

      const join2 = await emitWithAck(socket2, "lecture:join", { lectureId });
      expect(join2).toEqual({ success: true });

      // Leave on first socket, keep second socket joined
      const leave1 = await emitWithAck(socket1, "lecture:leave", { lectureId });
      expect(leave1).toEqual({ success: true });

      // Student B remains absent

      // 7. Attach event listeners on remaining socket 2 before HTTP post
      const { promise: chunkEventPromise, resolve: resolveChunkEvent } =
        Promise.withResolvers<unknown>();
      const { promise: conceptEventPromise, resolve: resolveConceptEvent } =
        Promise.withResolvers<unknown>();

      socket2.once("transcript:chunk", (data: unknown) => resolveChunkEvent(data));
      socket2.once("lecture:concept-detected", (data: unknown) => resolveConceptEvent(data));

      // 8. Submit transcript chunk by teacher
      const res = await fetch(`${serverUrl}/api/lectures/${lectureId}/transcript`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${teacherToken}`,
        },
        body: JSON.stringify({
          text: "Concept 01 is the topic of this lecture.",
          timestampSec: 5,
          speakerName: "Prof. Teacher",
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as unknown;
      const parsed = transcriptIngestResponseSchema.parse(body);
      expect(parsed.detectedConceptIds).toEqual([concept1Id]);

      const rawChunkEvent = await chunkEventPromise;
      const rawConceptEvent = await conceptEventPromise;

      const chunkEvent = transcriptChunkEventSchema.parse(rawChunkEvent);
      expect(chunkEvent.chunkId).toBe(parsed.chunkId);
      expect(chunkEvent.lectureId).toBe(lectureId);
      expect(chunkEvent.text).toBe("Concept 01 is the topic of this lecture.");
      expect(chunkEvent.timestampSec).toBe(5);

      const conceptEvent = conceptDetectedEventSchema.parse(rawConceptEvent);
      expect(conceptEvent.lectureId).toBe(lectureId);
      expect(conceptEvent.conceptIds).toEqual([concept1Id]);

      // 9. Verify database rows in transcript_chunks and transcript_concepts
      const { data: dbChunk, error: dbChunkError } = await harness.serviceClient
        .from("transcript_chunks")
        .select("*")
        .eq("id", parsed.chunkId)
        .single();
      expect(dbChunkError).toBeNull();
      expect(dbChunk).not.toBeNull();
      expect(dbChunk!.text).toBe("Concept 01 is the topic of this lecture.");
      expect(dbChunk!.lecture_id).toBe(lectureId);

      const { data: dbLinks, error: dbLinksError } = await harness.serviceClient
        .from("transcript_concepts")
        .select("*")
        .eq("transcript_chunk_id", parsed.chunkId);
      expect(dbLinksError).toBeNull();
      expect(dbLinks).not.toBeNull();
      expect(dbLinks!).toHaveLength(1);
      expect(dbLinks![0]?.concept_id).toBe(concept1Id);
      // 10. Verify mastery transitions via MasteryService:
      // Attending student (Student A): confidence 0 -> 0.05, attempts 0, version incremented
      const afterA = await masteryService.getMastery(enrolledActorA, studentA.id);
      const masteryA_c1 = afterA.find((m) => m.conceptId === concept1Id)!;
      expect(masteryA_c1.confidence).toBe(0.05);
      expect(masteryA_c1.attempts).toBe(0);
      expect(masteryA_c1.version).toBe(baselineVersionA + 1);

      // Absent student (Student B): unchanged
      const afterB = await masteryService.getMastery(enrolledActorB, studentB.id);
      const masteryB_c1 = afterB.find((m) => m.conceptId === concept1Id)!;
      expect(masteryB_c1.confidence).toBe(0);
      expect(masteryB_c1.attempts).toBe(0);
      expect(masteryB_c1.version).toBe(baselineVersionB);
    });
  }
);
