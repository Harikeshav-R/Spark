import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { describe, it, expect, afterEach } from "vitest";
import type { Clock, UUID } from "../../../src/contracts/common.js";
import {
  conceptDetectedEventSchema,
  transcriptChunkEventSchema,
  transcriptIngestResponseSchema,
} from "../../../src/contracts/index.js";
import { OpenRouterClient } from "../../../src/server/ai/index.js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import {
  createServer,
  type ServerInstance,
} from "../../../server/index.js";
import {
  FIXTURE_IDS,
  createFixtureSupabaseClient,
} from "../lane-b/helpers/socket-fixture.js";

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

describe("P3-B-01 / Lane A: Transcript Runtime Ingestion & Root Socket Room Authorization", () => {
  let instance: ServerInstance | null = null;
  const openSockets: ClientSocket[] = [];
  let serverUrl = "";

  const conceptGradientId: UUID = "77777777-7777-4777-8777-777777777777";
  const completedLectureId: UUID = "66666666-6666-4666-8666-666666666669";

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
  });

  async function startTestServer(options: {
    chunkRows: Record<string, unknown>[];
    conceptRows: Record<string, unknown>[];
  }) {
    const supabase = createFixtureSupabaseClient({
      tableRows: {
        concept_nodes: [
          {
            id: conceptGradientId,
            course_id: FIXTURE_IDS.teacher1.courseId,
            label: "Gradient Descent",
          },
        ],
        lecture_sessions: [
          {
            id: FIXTURE_IDS.teacher1.lectureId,
            course_id: FIXTURE_IDS.teacher1.courseId,
            title: "Lecture 1",
            status: "live",
            started_at: "2026-10-20T14:00:00.000Z",
          },
          {
            id: FIXTURE_IDS.teacher2.lectureId,
            course_id: FIXTURE_IDS.teacher2.courseId,
            title: "Lecture 2",
            status: "live",
            started_at: "2026-10-20T14:00:00.000Z",
          },
          {
            id: completedLectureId,
            course_id: FIXTURE_IDS.teacher1.courseId,
            title: "Completed Lecture",
            status: "completed",
            started_at: "2026-10-20T12:00:00.000Z",
            ended_at: "2026-10-20T13:00:00.000Z",
          },
        ],
        transcript_chunks: options.chunkRows,
        transcript_concepts: options.conceptRows,
      },
    });

    const auth = createAuthGateway(supabase, supabase);
    const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const clock: Clock = {
      now: () => new Date("2026-10-23T11:00:00.000Z"),
      nowISO: () => "2026-10-23T11:00:00.000Z",
    };
    const ids = new CryptoIdGenerator();

    instance = createServer({
      auth,
      databaseClient: supabase,
      aiClient,
      clock,
      ids,
      origin: "*",
    });

    const { promise, resolve } = Promise.withResolvers<void>();
    instance.httpServer.listen(0, "127.0.0.1", () => resolve());
    await promise;

    const port = (instance.httpServer.address() as AddressInfo).port;
    serverUrl = `http://127.0.0.1:${port}`;
  }

  it("1. Authorized teacher ingests transcript chunk → persists, detects concepts, and broadcasts to room", async () => {
    const chunkRows: Record<string, unknown>[] = [];
    const conceptRows: Record<string, unknown>[] = [];
    await startTestServer({ chunkRows, conceptRows });

    const teacherSocket = ioc(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      auth: { token: FIXTURE_IDS.teacher1.token },
    });
    openSockets.push(teacherSocket);
    await waitForConnect(teacherSocket);

    const joinAck = await emitWithAck(teacherSocket, "lecture:join", {
      lectureId: FIXTURE_IDS.teacher1.lectureId,
    });
    expect(joinAck).toEqual({ success: true });

    const { promise: chunkEventPromise, resolve: resolveChunkEvent, reject: rejectChunkEvent } =
      Promise.withResolvers<unknown>();
    const { promise: conceptEventPromise, resolve: resolveConceptEvent, reject: rejectConceptEvent } =
      Promise.withResolvers<unknown>();

    teacherSocket.once("transcript:chunk", (data: unknown) => {
      try {
        expect(chunkRows.length).toBeGreaterThan(0);
        resolveChunkEvent(data);
      } catch (err) {
        rejectChunkEvent(err);
      }
    });

    teacherSocket.once("lecture:concept-detected", (data: unknown) => {
      try {
        expect(conceptRows.length).toBeGreaterThan(0);
        resolveConceptEvent(data);
      } catch (err) {
        rejectConceptEvent(err);
      }
    });

    const res = await fetch(`${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
      },
      body: JSON.stringify({
        text: "Gradient Descent minimizes the training loss.",
        timestampSec: 5,
        speakerName: "Prof. Teacher One",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as unknown;
    const parsed = transcriptIngestResponseSchema.parse(body);
    expect(parsed.detectedConceptIds).toEqual([conceptGradientId]);

    const rawChunkEvent = await chunkEventPromise;
    const rawConceptEvent = await conceptEventPromise;

    const chunkEvent = transcriptChunkEventSchema.parse(rawChunkEvent);
    expect(chunkEvent.chunkId).toBe(parsed.chunkId);
    expect(chunkEvent.lectureId).toBe(FIXTURE_IDS.teacher1.lectureId);
    expect(chunkEvent.text).toBe("Gradient Descent minimizes the training loss.");
    expect(chunkEvent.timestampSec).toBe(5);
    expect(chunkEvent.speakerName).toBe("Prof. Teacher One");

    const conceptEvent = conceptDetectedEventSchema.parse(rawConceptEvent);
    expect(conceptEvent.lectureId).toBe(FIXTURE_IDS.teacher1.lectureId);
    expect(conceptEvent.conceptIds).toEqual([conceptGradientId]);

    expect(chunkRows).toHaveLength(1);
    expect(chunkRows[0]["id"]).toBe(parsed.chunkId);
    expect(chunkRows[0]["lecture_id"]).toBe(FIXTURE_IDS.teacher1.lectureId);
    expect(chunkRows[0]["text"]).toBe("Gradient Descent minimizes the training loss.");
    expect(chunkRows[0]["timestamp_sec"]).toBe(5);
    expect(chunkRows[0]["speaker_name"]).toBe("Prof. Teacher One");

    expect(conceptRows).toHaveLength(1);
    expect(conceptRows[0]["transcript_chunk_id"]).toBe(parsed.chunkId);
    expect(conceptRows[0]["concept_id"]).toBe(conceptGradientId);
  });

  it("2. Ingestion rejection: unauthenticated, unauthorized, or non-live lecture leaves database unchanged", async () => {
    const chunkRows: Record<string, unknown>[] = [];
    const conceptRows: Record<string, unknown>[] = [];
    await startTestServer({ chunkRows, conceptRows });

    // Missing token -> 401
    const resMissing = await fetch(
      `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test text", timestampSec: 1 }),
      }
    );
    expect(resMissing.status).toBe(401);

    // Invalid token -> 401
    const resInvalid = await fetch(
      `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-token",
        },
        body: JSON.stringify({ text: "Test text", timestampSec: 1 }),
      }
    );
    expect(resInvalid.status).toBe(401);

    // Student actor -> 403
    const resStudent = await fetch(
      `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${FIXTURE_IDS.studentCourse1Only.token}`,
        },
        body: JSON.stringify({ text: "Test text", timestampSec: 1 }),
      }
    );
    expect(resStudent.status).toBe(403);

    // Non-owning teacher -> 403
    const resTeacher2 = await fetch(
      `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${FIXTURE_IDS.teacher2.token}`,
        },
        body: JSON.stringify({ text: "Test text", timestampSec: 1 }),
      }
    );
    expect(resTeacher2.status).toBe(403);

    // Completed lecture -> 400
    const resCompleted = await fetch(
      `${serverUrl}/api/lectures/${completedLectureId}/transcript`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
        },
        body: JSON.stringify({ text: "Test text", timestampSec: 1 }),
      }
    );
    expect(resCompleted.status).toBe(400);

    // Assert persistence arrays remain completely unchanged
    expect(chunkRows).toHaveLength(0);
    expect(conceptRows).toHaveLength(0);
  });

  it("3. Root socket authorization: rejects invalid token and enforces course enrollment isolation", async () => {
    const chunkRows: Record<string, unknown>[] = [];
    const conceptRows: Record<string, unknown>[] = [];
    await startTestServer({ chunkRows, conceptRows });

    // Invalid socket token -> connect_error with UNAUTHORIZED
    const invalidSocket = ioc(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      auth: { token: "bad-token" },
    });
    openSockets.push(invalidSocket);

    const { promise: errPromise, resolve: resolveErr, reject: rejectErr } =
      Promise.withResolvers<Error>();
    invalidSocket.once("connect_error", (e) => resolveErr(e));
    invalidSocket.once("connect", () =>
      rejectErr(new Error("Socket unexpectedly connected with invalid token"))
    );
    const err = await errPromise;
    expect(err.message).toBe("UNAUTHORIZED");

    // Student enrolled only in course 1 connects to socket
    const studentSocket = ioc(serverUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      auth: { token: FIXTURE_IDS.studentCourse1Only.token },
    });
    openSockets.push(studentSocket);
    await waitForConnect(studentSocket);

    // Joins lecture 1 (enrolled course) -> success
    const join1Ack = await emitWithAck(studentSocket, "lecture:join", {
      lectureId: FIXTURE_IDS.teacher1.lectureId,
    });
    expect(join1Ack).toEqual({ success: true });

    // Attempts to join lecture 2 (unenrolled course) -> FORBIDDEN
    const join2Ack = await emitWithAck(studentSocket, "lecture:join", {
      lectureId: FIXTURE_IDS.teacher2.lectureId,
    });
    expect(join2Ack).toEqual({ success: false, error: "FORBIDDEN" });
  });
});
