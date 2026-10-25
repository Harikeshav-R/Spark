import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Clock,
  ConceptDetectedEvent,
  RealtimePublisher,
  SocketAckResponse,
  TranscriptChunkEvent,
} from "../../../src/contracts/index.js";
import {
  conceptDetectedEventSchema,
  transcriptChunkEventSchema,
  transcriptIngestResponseSchema,
} from "../../../src/contracts/index.js";
import { AppError, apiErrorSchema } from "../../../src/contracts/errors.js";
import {
  LectureRepository,
  TranscriptIngestor,
  TranscriptRepository,
  createTranscriptRouter,
} from "../../../src/server/classroom/index.js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import {
  createRoomAuthorizer,
  createSocketServer,
  type RealtimeSocketServer,
} from "../../../src/server/realtime/index.js";
import {
  AttendanceEvidenceService,
  CourseRepository,
  CourseService,
  MasteryRepository,
  MasteryService,
} from "../../../src/server/core/index.js";
import { createFixtureAttendanceService } from "./helpers/attendance-fixture.js";
import { FakeAiService } from "../../fixtures/ai.fixture.js";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../lane-a/supabase-harness.js";
import {
  FIXTURE_IDS,
  createFixtureSupabaseClient,
} from "./helpers/socket-fixture.js";

const testClock: Clock = {
  now: () => new Date(),
  nowISO: () => new Date().toISOString(),
};

function connectClient(port: number, token?: string): ClientSocket {
  return ioc(`http://127.0.0.1:${port}`, {
    auth: token ? { token } : {},
    transports: ["websocket"],
    reconnection: false,
    autoConnect: true,
  });
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

function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => {
    reject(new Error(`Timeout waiting for event: ${event}`));
  }, timeoutMs);
  socket.once(event, (data: T) => {
    clearTimeout(timer);
    resolve(data);
  });
  return promise;
}

describe("P3-B-02: Live Transcript Chunk Ingestion & Broadcasting (Fixture Mode)", () => {
  const activeSockets: ClientSocket[] = [];
  let httpServer: http.Server | null = null;
  let ioServer: RealtimeSocketServer | null = null;

  const conceptId1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const conceptId2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  afterEach(async () => {
    for (const s of activeSockets) {
      if (s.connected) {
        s.disconnect();
      }
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
  });

  interface SetupOptions {
    candidateConcepts?: { id: string; course_id: string; label: string }[];
    detectorOverride?: (chunkText: string, candidates: { id: string; label: string }[]) => Promise<string[]>;
    lectureSessions?: Record<string, unknown>[];
    onEmitHook?: (lectureId: string, event: string, payload: unknown) => Promise<void>;
    attendanceOverride?: Pick<AttendanceEvidenceService, "recordChunkAttendance">;
  }
  async function setupFixtureEnvironment(options: SetupOptions = {}) {
    const transcriptChunksTable: Record<string, unknown>[] = [];
    const transcriptConceptsTable: Record<string, unknown>[] = [];
    const conceptNodesTable: Record<string, unknown>[] = options.candidateConcepts ?? [
      {
        id: conceptId1,
        course_id: FIXTURE_IDS.teacher1.courseId,
        label: "Gradient Descent",
      },
      {
        id: conceptId2,
        course_id: FIXTURE_IDS.teacher1.courseId,
        label: "Backpropagation",
      },
    ];

    const tableRows: Record<string, Record<string, unknown>[]> = {
      transcript_chunks: transcriptChunksTable,
      transcript_concepts: transcriptConceptsTable,
      concept_nodes: conceptNodesTable,
    };
    if (options.lectureSessions) {
      tableRows["lecture_sessions"] = options.lectureSessions;
    }

    const fixtureSupabase = createFixtureSupabaseClient({ tableRows });
    const authGateway = createAuthGateway(fixtureSupabase, fixtureSupabase);
    const roomAuthorizer = createRoomAuthorizer(fixtureSupabase);
    const lectureRepository = new LectureRepository(fixtureSupabase);
    const transcriptRepository = new TranscriptRepository(fixtureSupabase);

    const fakeAi = new FakeAiService();
    const detector = options.detectorOverride
      ? { detectConcepts: options.detectorOverride }
      : {
          detectConcepts: (text: string, cands: { id: string; label: string }[]) =>
            fakeAi.detectConcepts(text, cands),
        };

    const app = express();
    httpServer = http.createServer(app);

    const { io, publisher: basePublisher, presence } = createSocketServer(httpServer, {
      auth: authGateway,
      rooms: roomAuthorizer,
      lectures: lectureRepository,
    });
    ioServer = io;

    const { attendance: fixtureAttendance, mastery: fixtureMastery } =
      createFixtureAttendanceService(fixtureSupabase);

    const publisher: RealtimePublisher = {
      ...basePublisher,
      emitToLecture: async (lecId, ev, payload) => {
        if (options.onEmitHook) {
          await options.onEmitHook(lecId, ev, payload);
        }
        await basePublisher.emitToLecture(lecId, ev, payload);
      },
    };

    const ingestor = new TranscriptIngestor({
      lectures: lectureRepository,
      transcripts: transcriptRepository,
      rooms: roomAuthorizer,
      ai: detector,
      presence,
      attendance: options.attendanceOverride ?? fixtureAttendance,
      publisher,
      ids: new CryptoIdGenerator(),
      clock: testClock,
    });

    app.use(createTranscriptRouter({ auth: authGateway, classroom: ingestor }));

    const { promise, resolve } = Promise.withResolvers<void>();
    httpServer.listen(0, "127.0.0.1", () => resolve());
    await promise;
    const port = (httpServer.address() as AddressInfo).port;

    return {
      port,
      fixtureSupabase,
      transcriptChunksTable,
      transcriptConceptsTable,
      conceptNodesTable,
      fixtureMastery,
      presence,
    };
  }
  it("Teacher POSTs chunk to live lecture: returns 201, persists chunk & link, broadcasts events to enrolled student", async () => {
    const { port, transcriptChunksTable, transcriptConceptsTable } = await setupFixtureEnvironment();

    // Connect student enrolled in teacher1's course
    const studentSocket = connectClient(port, FIXTURE_IDS.studentCourse1Only.token);
    activeSockets.push(studentSocket);
    await waitForConnect(studentSocket);

    // Student joins lecture room
    const joinRes = await emitWithAck(studentSocket, "lecture:join", {
      lectureId: FIXTURE_IDS.teacher1.lectureId,
    });
    expect(joinRes).toEqual({ success: true });

    // Set up listeners for broadcast events
    const chunkEventPromise = waitForEvent<TranscriptChunkEvent>(studentSocket, "transcript:chunk");
    const conceptEventPromise = waitForEvent<ConceptDetectedEvent>(
      studentSocket,
      "lecture:concept-detected",
    );

    // Teacher sends transcript chunk
    const res = await fetch(
      `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Today we cover gradient descent.",
          timestampSec: 142.5,
          speakerName: "Prof. Chen",
        }),
      },
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as unknown;
    const parsedRes = transcriptIngestResponseSchema.parse(body);

    expect(parsedRes.chunkId).toBeDefined();
    expect(parsedRes.detectedConceptIds).toEqual([conceptId1]);

    // Verify database persistence
    expect(transcriptChunksTable).toHaveLength(1);
    const storedRow = transcriptChunksTable[0]!;
    expect(storedRow["id"]).toBe(parsedRes.chunkId);
    expect(storedRow["lecture_id"]).toBe(FIXTURE_IDS.teacher1.lectureId);
    expect(storedRow["text"]).toBe("Today we cover gradient descent.");
    expect(storedRow["timestamp_sec"]).toBe(142.5);
    expect(storedRow["speaker_name"]).toBe("Prof. Chen");
    expect(typeof storedRow["created_at"]).toBe("string");

    expect(transcriptConceptsTable).toHaveLength(1);
    expect(transcriptConceptsTable[0]).toEqual({
      transcript_chunk_id: parsedRes.chunkId,
      concept_id: conceptId1,
    });

    // Await Socket.IO events and verify payloads
    const receivedChunkEvent = await chunkEventPromise;
    expect(transcriptChunkEventSchema.parse(receivedChunkEvent)).toBeDefined();
    expect(receivedChunkEvent).toMatchObject({
      chunkId: parsedRes.chunkId,
      lectureId: FIXTURE_IDS.teacher1.lectureId,
      text: "Today we cover gradient descent.",
      timestampSec: 142.5,
      speakerName: "Prof. Chen",
    });

    const receivedConceptEvent = await conceptEventPromise;
    expect(conceptDetectedEventSchema.parse(receivedConceptEvent)).toBeDefined();
    expect(receivedConceptEvent).toMatchObject({
      lectureId: FIXTURE_IDS.teacher1.lectureId,
      conceptIds: [conceptId1],
    });
  });

  it("Persist-before-broadcast: storage contains chunk and concept link at moment event is emitted", async () => {
    let hookChecked = false;
    const tablesRef = {
      chunks: [] as Record<string, unknown>[],
      links: [] as Record<string, unknown>[],
    };

    const { port, transcriptChunksTable, transcriptConceptsTable } = await setupFixtureEnvironment({
      onEmitHook: async (_lecId, _ev, payload) => {
        hookChecked = true;
        expect(tablesRef.chunks.length).toBe(1);
        expect(tablesRef.links.length).toBe(1);
        if ("chunkId" in (payload as Record<string, unknown>)) {
          expect(tablesRef.chunks[0]!["id"]).toBe((payload as { chunkId: string }).chunkId);
        }
      },
    });
    tablesRef.chunks = transcriptChunksTable;
    tablesRef.links = transcriptConceptsTable;

    const res = await fetch(
      `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Today we cover gradient descent.",
          timestampSec: 0,
        }),
      },
    );
    expect(res.status).toBe(201);
    expect(hookChecked).toBe(true);
  });

  describe("Validation & Rejection Rules", () => {
    it("rejects non-numeric timestamp over HTTP with 400 VALIDATION_ERROR", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment();

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Valid text",
            timestampSec: "142.5",
          }),
        },
      );

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(transcriptChunksTable).toHaveLength(0);
    });

    it("rejects negative timestamp with 400 VALIDATION_ERROR", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment();

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Valid text",
            timestampSec: -1,
          }),
        },
      );

      expect(res.status).toBe(400);
      expect(transcriptChunksTable).toHaveLength(0);
    });

    it("rejects empty or whitespace text with 400 VALIDATION_ERROR", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment();

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "    \n   ",
            timestampSec: 10,
          }),
        },
      );

      expect(res.status).toBe(400);
      expect(transcriptChunksTable).toHaveLength(0);
    });

    it("rejects overlong speaker name with 400 VALIDATION_ERROR", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment();

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Valid text",
            timestampSec: 10,
            speakerName: "x".repeat(101),
          }),
        },
      );

      expect(res.status).toBe(400);
      expect(transcriptChunksTable).toHaveLength(0);
    });

    it("rejects malformed lecture UUID with 400 VALIDATION_ERROR", async () => {
      const { port } = await setupFixtureEnvironment();

      const res = await fetch(`http://127.0.0.1:${port}/api/lectures/not-a-uuid/transcript`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Valid text",
          timestampSec: 10,
        }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects malformed JSON payload with 400 VALIDATION_ERROR", async () => {
      const { port } = await setupFixtureEnvironment();

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: "invalid-json{",
        },
      );

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Authentication & Authorization Gates", () => {
    it("rejects unauthenticated request with 401 UNAUTHORIZED", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment();

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "Test", timestampSec: 1 }),
        },
      );

      expect(res.status).toBe(401);
      expect(transcriptChunksTable).toHaveLength(0);
    });

    it("rejects student actor with 403 FORBIDDEN", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment();

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.studentCourse1Only.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: "Test", timestampSec: 1 }),
        },
      );

      expect(res.status).toBe(403);
      expect(transcriptChunksTable).toHaveLength(0);
    });

    it("rejects teacher from another course with 403 FORBIDDEN", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment();

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher2.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: "Test", timestampSec: 1 }),
        },
      );

      expect(res.status).toBe(403);
      expect(transcriptChunksTable).toHaveLength(0);
    });

    it("rejects unknown lecture ID with 403 FORBIDDEN", async () => {
      const { port } = await setupFixtureEnvironment();
      const unknownLectureId = "00000000-0000-4000-8000-000000000000";

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${unknownLectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: "Test", timestampSec: 1 }),
        },
      );

      expect(res.status).toBe(403);
    });

    it("rejects completed lecture with 400 BAD_REQUEST", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment({
        lectureSessions: [
          {
            id: FIXTURE_IDS.teacher1.lectureId,
            course_id: FIXTURE_IDS.teacher1.courseId,
            title: "Completed Lecture",
            status: "completed",
            started_at: "2026-10-20T14:00:00.000Z",
            ended_at: "2026-10-20T15:00:00.000Z",
          },
        ],
      });

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: "Late chunk", timestampSec: 50 }),
        },
      );

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { message: string } };
      expect(json.error.message).toContain("inactive lecture");
      expect(transcriptChunksTable).toHaveLength(0);
    });
  });

  describe("Detection Behaviors & Failure Isolation", () => {
    it("handles empty candidate concepts: returns empty detectedConceptIds, broadcasts empty concept event", async () => {
      const { port } = await setupFixtureEnvironment({
        candidateConcepts: [],
      });

      const studentSocket = connectClient(port, FIXTURE_IDS.studentCourse1Only.token);
      activeSockets.push(studentSocket);
      await waitForConnect(studentSocket);
      await emitWithAck(studentSocket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });

      const conceptEventPromise = waitForEvent<ConceptDetectedEvent>(
        studentSocket,
        "lecture:concept-detected",
      );

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "No concepts defined for this course.",
            timestampSec: 25,
          }),
        },
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { detectedConceptIds: string[] };
      expect(body.detectedConceptIds).toEqual([]);

      const receivedEvent = await conceptEventPromise;
      expect(receivedEvent.conceptIds).toEqual([]);
    });

    it("propagates detector 503 SERVICE_UNAVAILABLE; raw chunk remains durable in DB, no events emitted", async () => {
      const emitSpy = vi.fn();
      const { port, transcriptChunksTable, transcriptConceptsTable } = await setupFixtureEnvironment({
        detectorOverride: async () => {
          throw new Error("AI provider down: 503 Service Unavailable");
        },
        onEmitHook: emitSpy,
      });

      const res = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Today we cover gradient descent.",
            timestampSec: 30,
          }),
        },
      );

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(transcriptChunksTable).toHaveLength(1);
      expect(transcriptConceptsTable).toHaveLength(0);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it("room isolation: student subscribed only to lecture 2 does not receive lecture 1 events", async () => {
      const { port } = await setupFixtureEnvironment();

      // Student enrolled in both courses joins lecture 2 only
      const studentSocket = connectClient(port, FIXTURE_IDS.studentDual.token);
      activeSockets.push(studentSocket);
      await waitForConnect(studentSocket);

      await emitWithAck(studentSocket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher2.lectureId,
      });

      const eventsReceived: TranscriptChunkEvent[] = [];
      studentSocket.on("transcript:chunk", (data: TranscriptChunkEvent) => eventsReceived.push(data));

      // Teacher 1 posts to lecture 1
      const res1 = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Lecture 1 exclusive chunk",
            timestampSec: 5,
          }),
        },
      );
      expect(res1.status).toBe(201);

      // Deterministic delivery barrier: Teacher 2 posts to lecture 2
      const lecture2ChunkPromise = waitForEvent<TranscriptChunkEvent>(studentSocket, "transcript:chunk");
      const res2 = await fetch(
        `http://127.0.0.1:${port}/api/lectures/${FIXTURE_IDS.teacher2.lectureId}/transcript`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher2.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Lecture 2 barrier chunk",
            timestampSec: 10,
          }),
        },
      );
      expect(res2.status).toBe(201);

      const barrierEvent = await lecture2ChunkPromise;
      expect(barrierEvent.text).toBe("Lecture 2 barrier chunk");

      // Verify student received ONLY the lecture 2 event, never the lecture 1 event
      expect(eventsReceived).toHaveLength(1);
      expect(eventsReceived[0]!.lectureId).toBe(FIXTURE_IDS.teacher2.lectureId);
    });
  });

  describe("Attendance Evidence & Multi-Tab Presence Integration", () => {
    it("multi-tab presence: closing 1 tab keeps presence active, awards attendance evidence to remaining tab", async () => {
      const { port, fixtureMastery } = await setupFixtureEnvironment();

      const tab1 = connectClient(port, FIXTURE_IDS.studentCourse1Only.token);
      const tab2 = connectClient(port, FIXTURE_IDS.studentCourse1Only.token);
      activeSockets.push(tab1, tab2);
      await waitForConnect(tab1);
      await waitForConnect(tab2);

      const lectureId = FIXTURE_IDS.teacher1.lectureId;
      const studentId = FIXTURE_IDS.studentCourse1Only.studentIdCourse1;

      const join1 = await emitWithAck(tab1, "lecture:join", { lectureId });
      const join2 = await emitWithAck(tab2, "lecture:join", { lectureId });
      expect(join1).toEqual({ success: true });
      expect(join2).toEqual({ success: true });

      // Seed initial mastery: confidence 0.20, attempts 2, version 1
      fixtureMastery.set(`${studentId}:${conceptId1}`, {
        confidence: 0.2,
        attempts: 2,
        version: 1,
      });

      // Disconnect tab 1 and await server-side disconnect
      const serverTab1 = tab1.id ? ioServer?.sockets.sockets.get(tab1.id) : undefined;
      const { promise: disconnectPromise, resolve: resolveDisconnect } = Promise.withResolvers<void>();
      if (serverTab1) {
        serverTab1.on("disconnect", () => resolveDisconnect());
      } else {
        tab1.on("disconnect", () => resolveDisconnect());
      }
      tab1.disconnect();
      await disconnectPromise;

      const chunkPromise = waitForEvent<TranscriptChunkEvent>(tab2, "transcript:chunk");
      const conceptPromise = waitForEvent<ConceptDetectedEvent>(
        tab2,
        "lecture:concept-detected",
      );

      const res = await fetch(`http://127.0.0.1:${port}/api/lectures/${lectureId}/transcript`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Today we explore Gradient Descent optimization",
          timestampSec: 15,
        }),
      });

      expect(res.status).toBe(201);
      const chunkEvent = await chunkPromise;
      const conceptEvent = await conceptPromise;
      expect(chunkEvent.text).toContain("Gradient Descent");
      expect(conceptEvent.conceptIds).toContain(conceptId1);

      // Attendance applied once: 0.20 + 0.05 = 0.25, attempts unchanged (2), version incremented (2)
      const updatedMastery = fixtureMastery.get(`${studentId}:${conceptId1}`);
      expect(updatedMastery).toEqual({
        confidence: 0.25,
        attempts: 2,
        version: 2,
      });
    });

    it("explicit final leave before chunk ingestion leaves seeded mastery unchanged", async () => {
      const { port, fixtureMastery } = await setupFixtureEnvironment();

      const studentSocket = connectClient(port, FIXTURE_IDS.studentCourse1Only.token);
      activeSockets.push(studentSocket);
      await waitForConnect(studentSocket);

      const lectureId = FIXTURE_IDS.teacher1.lectureId;
      const studentId = FIXTURE_IDS.studentCourse1Only.studentIdCourse1;

      const joinRes = await emitWithAck(studentSocket, "lecture:join", { lectureId });
      expect(joinRes).toEqual({ success: true });

      fixtureMastery.set(`${studentId}:${conceptId1}`, {
        confidence: 0.2,
        attempts: 2,
        version: 1,
      });

      // Explicit leave
      const leaveRes = await emitWithAck(studentSocket, "lecture:leave", { lectureId });
      expect(leaveRes).toEqual({ success: true });

      const res = await fetch(`http://127.0.0.1:${port}/api/lectures/${lectureId}/transcript`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Gradient Descent optimization while student is absent",
          timestampSec: 20,
        }),
      });

      expect(res.status).toBe(201);
      // Mastery state unchanged because student explicitly left
      expect(fixtureMastery.get(`${studentId}:${conceptId1}`)).toEqual({
        confidence: 0.2,
        attempts: 2,
        version: 1,
      });
    });

    it("attendee snapshot at chunk arrival excludes student who joins during AI detection", async () => {
      const { promise: gatePromise, resolve: openGate } = Promise.withResolvers<void>();

      const { port, fixtureMastery } = await setupFixtureEnvironment({
        detectorOverride: async (_text, cands) => {
          await gatePromise;
          return [cands[0]!.id];
        },
      });

      const lectureId = FIXTURE_IDS.teacher1.lectureId;
      const student1Id = FIXTURE_IDS.studentDual.studentIdCourse1;
      const student2Id = FIXTURE_IDS.studentCourse1Only.studentIdCourse1;

      const socket1 = connectClient(port, FIXTURE_IDS.studentDual.token);
      activeSockets.push(socket1);
      await waitForConnect(socket1);
      await emitWithAck(socket1, "lecture:join", { lectureId });

      // Trigger POST: enters detector and pauses at gate
      const postPromise = fetch(`http://127.0.0.1:${port}/api/lectures/${lectureId}/transcript`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Gated detection with Gradient Descent",
          timestampSec: 30,
        }),
      });

      // Student 2 joins while detection is in-flight
      const socket2 = connectClient(port, FIXTURE_IDS.studentCourse1Only.token);
      activeSockets.push(socket2);
      await waitForConnect(socket2);
      await emitWithAck(socket2, "lecture:join", { lectureId });

      // Release gate
      openGate();

      const res = await postPromise;
      expect(res.status).toBe(201);

      // Only student 1 was snapshotted at chunk arrival
      expect(fixtureMastery.has(`${student1Id}:${conceptId1}`)).toBe(true);
      expect(fixtureMastery.has(`${student2Id}:${conceptId1}`)).toBe(false);
    });

    it("attendance failure aborts broadcast and returns 503 SERVICE_UNAVAILABLE", async () => {
      const { port, transcriptChunksTable } = await setupFixtureEnvironment({
        attendanceOverride: {
          recordChunkAttendance: async () => {
            throw new AppError({
              code: "SERVICE_UNAVAILABLE",
              statusCode: 503,
              message: "Mastery store unavailable",
            });
          },
        },
      });

      const lectureId = FIXTURE_IDS.teacher1.lectureId;
      const studentSocket = connectClient(port, FIXTURE_IDS.studentCourse1Only.token);
      activeSockets.push(studentSocket);
      await waitForConnect(studentSocket);
      await emitWithAck(studentSocket, "lecture:join", { lectureId });

      let receivedAnyEvent = false;
      studentSocket.on("transcript:chunk", () => {
        receivedAnyEvent = true;
      });
      studentSocket.on("lecture:concept-detected", () => {
        receivedAnyEvent = true;
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/lectures/${lectureId}/transcript`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Gradient Descent with failing attendance",
          timestampSec: 40,
        }),
      });

      expect(res.status).toBe(503);
      const body = apiErrorSchema.parse(await res.json());
      expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(transcriptChunksTable).toHaveLength(1);

      // Socket never received events due to persist-before-broadcast gate
      expect(receivedAnyEvent).toBe(false);
    });
  });
});

describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
  "P3-B-02: Live Transcript Chunk Ingestion against Real Local PostgreSQL",
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
    });

    it("persists chunk and concept link into real postgres and broadcasts via socket", async () => {
      harness = new SupabaseTestHarness();
      context = { users: [], teacherIds: [], courseIds: [] };

      const courseCtx = await harness.createTestCourse(context, { conceptCount: 0 });
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

      // Insert a live lecture session into PostgreSQL
      const lectureId = randomUUID();
      const { error: lectureInsertErr } = await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: courseCtx.courseId,
        title: "Real DB Lecture",
        status: "live",
        started_at: new Date().toISOString(),
      });
      expect(lectureInsertErr).toBeNull();

      // Insert a concept node into PostgreSQL
      const conceptId = randomUUID();
      const { error: conceptInsertErr } = await harness.serviceClient.from("concept_nodes").insert({
        id: conceptId,
        course_id: courseCtx.courseId,
        label: "Gradient Descent",
        description: "Optimization algorithm",
        category: "optimization",
      });
      expect(conceptInsertErr).toBeNull();

      const authGateway = createAuthGateway(harness.serviceClient, harness.serviceClient);
      const roomAuthorizer = createRoomAuthorizer(harness.serviceClient);
      const lectureRepo = new LectureRepository(harness.serviceClient);
      const transcriptRepo = new TranscriptRepository(harness.serviceClient);
      const fakeAi = new FakeAiService();

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
      const attendanceService = new AttendanceEvidenceService(
        harness.serviceClient,
        courseService,
        masteryService,
      );

      const ingestor = new TranscriptIngestor({
        lectures: lectureRepo,
        transcripts: transcriptRepo,
        rooms: roomAuthorizer,
        ai: {
          detectConcepts: (t, c) => fakeAi.detectConcepts(t, c),
        },
        presence,
        attendance: attendanceService,
        publisher,
        ids: new CryptoIdGenerator(),
        clock: testClock,
      });

      app.use(createTranscriptRouter({ auth: authGateway, classroom: ingestor }));

      const { promise, resolve } = Promise.withResolvers<void>();
      httpServer.listen(0, "127.0.0.1", () => resolve());
      await promise;
      const port = (httpServer.address() as AddressInfo).port;

      const studentSocket = connectClient(port, studentToken);
      activeSockets.push(studentSocket);
      await waitForConnect(studentSocket);

      const joinRes = await emitWithAck(studentSocket, "lecture:join", { lectureId });
      expect(joinRes).toEqual({ success: true });

      const chunkPromise = waitForEvent<TranscriptChunkEvent>(studentSocket, "transcript:chunk");
      const conceptPromise = waitForEvent<ConceptDetectedEvent>(
        studentSocket,
        "lecture:concept-detected",
      );

      const postRes = await fetch(`http://127.0.0.1:${port}/api/lectures/${lectureId}/transcript`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Today we discuss gradient descent in real postgres.",
          timestampSec: 10.5,
          speakerName: "Prof. Real",
        }),
      });

      expect(postRes.status).toBe(201);
      const body = (await postRes.json()) as { chunkId: string; detectedConceptIds: string[] };
      expect(body.chunkId).toBeDefined();
      expect(body.detectedConceptIds).toEqual([conceptId]);

      // Query genuine PostgreSQL table rows
      const { data: chunkRows } = await harness.serviceClient
        .from("transcript_chunks")
        .select("*")
        .eq("id", body.chunkId);
      expect(chunkRows).toHaveLength(1);
      expect(chunkRows![0].text).toBe("Today we discuss gradient descent in real postgres.");

      const { data: linkRows } = await harness.serviceClient
        .from("transcript_concepts")
        .select("*")
        .eq("transcript_chunk_id", body.chunkId);
      expect(linkRows).toHaveLength(1);
      expect(linkRows![0].concept_id).toBe(conceptId);

      const receivedChunk = await chunkPromise;
      expect(receivedChunk.chunkId).toBe(body.chunkId);

      const receivedConcept = await conceptPromise;
      expect(receivedConcept.conceptIds).toEqual([conceptId]);

      // Query genuine PostgreSQL student_mastery update from attendance evidence
      const { data: masteryRows } = await harness.serviceClient
        .from("student_mastery")
        .select("confidence,attempts,version")
        .eq("student_id", studentId)
        .eq("concept_id", conceptId);
      expect(masteryRows).toHaveLength(1);
      expect(Number(masteryRows![0].confidence)).toBe(0.05);

      // Cleanup
      await harness.serviceClient.from("student_mastery").delete().eq("student_id", studentId);
      await harness.serviceClient.from("transcript_concepts").delete().eq("transcript_chunk_id", body.chunkId);
      await harness.serviceClient.from("transcript_chunks").delete().eq("id", body.chunkId);
      await harness.serviceClient.from("concept_nodes").delete().eq("id", conceptId);
      await harness.serviceClient.from("lecture_sessions").delete().eq("id", lectureId);
      await harness.serviceClient.from("students").delete().eq("id", studentId);
      await harness.cleanup(context);
    });
  },
);
