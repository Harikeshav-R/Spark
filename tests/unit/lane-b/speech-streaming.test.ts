import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  ActorContext,
  UUID,
  ISOTimestamp,
} from "../../../src/contracts/common.js";
import type {
  ClassroomService,
  LectureSession,
  TranscriptChunk,
} from "../../../src/contracts/classroom.js";
import type {
  TranscriptChunkEvent,
} from "../../../src/contracts/realtime.js";
import { AppError } from "../../../src/contracts/errors.js";
import {
  CS229_TRANSCRIPT_SCRIPT,
  LectureSpeechService,
  readSpeechSourceConfig,
  runLectureSimulator,
} from "../../../src/server/classroom/index.js";
import { runZoomRtms } from "../../../src/server/zoom/index.js";
import { TranscriptIngestor } from "../../../src/server/classroom/transcript-ingestor.js";

class MockWebSocket extends EventTarget {
  url: string;
  sentMessages: string[] = [];
  readyState: number = 0;
  closeCalled = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closeCalled = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  triggerOpen(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  triggerMessage(data: string): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  triggerError(err?: unknown): void {
    this.dispatchEvent(new ErrorEvent("error", { error: err }));
  }
}

describe("P3-B-04: Lecture Simulator & Zoom RTMS Streaming Adapter", () => {
  const lectureId: UUID = "11111111-1111-4111-8111-111111111111";
  const courseId: UUID = "22222222-2222-4222-8222-222222222222";
  const teacherId: UUID = "33333333-3333-4333-8333-333333333333";
  const userId: UUID = "44444444-4444-4444-8444-444444444444";
  const startedAt: ISOTimestamp = "2026-10-22T14:00:00.000Z";

  const teacherActor: ActorContext = {
    userId,
    authId: userId,
    email: "teacher@stanford.edu",
    name: "Prof. Chen",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: "55555555-5555-4555-8555-555555555555",
    authId: "55555555-5555-4555-8555-555555555555",
    email: "student@stanford.edu",
    name: "Alice",
    role: "student",
    enrolledCourses: [
      {
        studentId: "66666666-6666-4666-8666-666666666666",
        courseId,
      },
    ],
  };

  const liveLecture: LectureSession = {
    id: lectureId,
    courseId,
    title: "CS229 Machine Learning",
    status: "live",
    startedAt,
  };

  function createIngestorHarness(overrides?: {
    lecture?: LectureSession;
    ingestDelay?: number;
    ingestReject?: Error;
  }) {
    let idCounter = 0;
    const insertedChunks: TranscriptChunk[] = [];
    const emittedEvents: { lectureId: UUID; event: string; payload: unknown }[] = [];

    const deps = {
      lectures: {
        getLecture: vi.fn().mockResolvedValue(overrides?.lecture ?? liveLecture),
      },
      transcripts: {
        getCandidateConcepts: vi.fn().mockResolvedValue([]),
        insertChunk: vi.fn().mockImplementation(async (chunk: TranscriptChunk) => {
          if (overrides?.ingestReject) {
            throw overrides.ingestReject;
          }
          if (overrides?.ingestDelay) {
            await new Promise((resolve) => setTimeout(resolve, overrides.ingestDelay));
          }
          insertedChunks.push(chunk);
          return chunk;
        }),
        insertConceptLinks: vi.fn().mockResolvedValue(undefined),
      },
      rooms: {
        authorizeRoom: vi.fn().mockResolvedValue(undefined),
      },
      ai: {
        detectConcepts: vi.fn().mockResolvedValue([]),
      },
      presence: {
        getAttendingStudentIds: vi.fn().mockReturnValue([]),
      },
      attendance: {
        recordChunkAttendance: vi.fn().mockResolvedValue([]),
      },
      publisher: {
        emitToLecture: vi
          .fn()
          .mockImplementation(async (lecId: UUID, ev: string, payload: unknown) => {
            emittedEvents.push({ lectureId: lecId, event: ev, payload });
          }),
      },
      ids: {
        generateId: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}` as UUID,
      },
      clock: {
        now: () => new Date(),
        nowISO: () => "2026-10-22T14:05:00.000Z",
      },
    };

    const ingestor = new TranscriptIngestor(deps);
    return { ingestor, deps, insertedChunks, emittedEvents };
  }

  describe("readSpeechSourceConfig", () => {
    it("returns defaults when environment variables are omitted", () => {
      const config = readSpeechSourceConfig({});
      expect(config).toEqual({
        integrationMode: "fixture",
        lectureSource: "simulator",
        tickRateMs: 4000,
        zoomClientId: undefined,
        zoomClientSecret: undefined,
      });
    });

    it("parses valid custom configurations", () => {
      const config = readSpeechSourceConfig({
        INTEGRATION_MODE: "live",
        LECTURE_SOURCE: "zoom",
        DEMO_TICK_RATE_MS: "2000",
        ZOOM_CLIENT_ID: "client-123",
        ZOOM_CLIENT_SECRET: "secret-abc",
      });
      expect(config).toEqual({
        integrationMode: "live",
        lectureSource: "zoom",
        tickRateMs: 2000,
        zoomClientId: "client-123",
        zoomClientSecret: "secret-abc",
      });
    });

    it("rejects invalid INTEGRATION_MODE", () => {
      expect(() =>
        readSpeechSourceConfig({ INTEGRATION_MODE: "staging" as unknown as "live" }),
      ).toThrow(AppError);
    });

    it("rejects invalid LECTURE_SOURCE", () => {
      expect(() =>
        readSpeechSourceConfig({ LECTURE_SOURCE: "youtube" as unknown as "zoom" }),
      ).toThrow(AppError);
    });

    it("rejects non-positive or non-integer DEMO_TICK_RATE_MS", () => {
      expect(() => readSpeechSourceConfig({ DEMO_TICK_RATE_MS: "-100" })).toThrow(AppError);
      expect(() => readSpeechSourceConfig({ DEMO_TICK_RATE_MS: "0" })).toThrow(AppError);
      expect(() => readSpeechSourceConfig({ DEMO_TICK_RATE_MS: "3.14" })).toThrow(AppError);
      expect(() => readSpeechSourceConfig({ DEMO_TICK_RATE_MS: "fast" })).toThrow(AppError);
    });
  });

  describe("Simulator Execution & Schedule", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("emits chunks on 4-second cadence with isSimulated: true", async () => {
      const { ingestor, insertedChunks, emittedEvents } = createIngestorHarness();
      const abortController = new AbortController();

      const simPromise = runLectureSimulator(
        ingestor,
        teacherActor,
        lectureId,
        CS229_TRANSCRIPT_SCRIPT,
        4000,
        abortController.signal,
      );

      // At 3999ms no row exists
      await vi.advanceTimersByTimeAsync(3999);
      expect(insertedChunks).toHaveLength(0);

      // At 4000ms script chunk 0 appears
      await vi.advanceTimersByTimeAsync(1);
      expect(insertedChunks).toHaveLength(1);
      expect(insertedChunks[0].timestampSec).toBe(0);
      expect(insertedChunks[0].isSimulated).toBe(true);
      expect(insertedChunks[0].text).toBe(CS229_TRANSCRIPT_SCRIPT[0].text);

      const chunkEvent1 = emittedEvents.find((e) => e.event === "transcript:chunk");
      expect(chunkEvent1).toBeDefined();
      expect((chunkEvent1?.payload as TranscriptChunkEvent).isSimulated).toBe(true);

      // At 8000ms script chunk 1 appears
      await vi.advanceTimersByTimeAsync(4000);
      expect(insertedChunks).toHaveLength(2);
      expect(insertedChunks[1].timestampSec).toBe(4);
      expect(insertedChunks[1].isSimulated).toBe(true);

      // At 12000ms script chunk 2 appears
      await vi.advanceTimersByTimeAsync(4000);
      expect(insertedChunks).toHaveLength(3);
      expect(insertedChunks[2].timestampSec).toBe(8);

      // Advance through remaining 3 chunks (16000, 20000, 24000)
      await vi.advanceTimersByTimeAsync(12000);
      expect(insertedChunks).toHaveLength(6);
      expect(insertedChunks[5].timestampSec).toBe(20);

      // Simulator resolves done upon script exhaustion
      await simPromise;

      // Advancing another interval does not emit extra chunks
      await vi.advanceTimersByTimeAsync(4000);
      expect(insertedChunks).toHaveLength(6);
    });

    it("skips busy ticks without overlapping ingestion and without skipping script entries", async () => {
      const insertedChunks: TranscriptChunk[] = [];
      let delayedIngestResolve: (() => void) | null = null;

      const mockClassroom: Pick<ClassroomService, "ingestTranscriptChunk"> = {
        ingestTranscriptChunk: vi.fn().mockImplementation(async (
          _actor,
          _lecId,
          text,
          timestampSec,
          speakerName,
          provenance,
        ) => {
          if (insertedChunks.length === 0) {
            // Block first ingestion across multiple ticks
            const { promise, resolve } = Promise.withResolvers<void>();
            delayedIngestResolve = resolve;
            await promise;
          }
          const chunk: TranscriptChunk = {
            id: `chunk-${insertedChunks.length}` as UUID,
            lectureId,
            text,
            timestampSec,
            speakerName,
            detectedConceptIds: [],
            isSimulated: provenance?.isSimulated,
            createdAt: "2026-10-22T14:00:00.000Z",
          };
          insertedChunks.push(chunk);
          return chunk;
        }),
      };

      const abortController = new AbortController();
      const simPromise = runLectureSimulator(
        mockClassroom,
        teacherActor,
        lectureId,
        CS229_TRANSCRIPT_SCRIPT,
        4000,
        abortController.signal,
      );

      // Tick 1 (4000ms): ingestion 1 begins but is unresolved
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockClassroom.ingestTranscriptChunk).toHaveBeenCalledTimes(1);
      expect(insertedChunks).toHaveLength(0);

      // Tick 2 (8000ms): tick occurs while ingestion 1 is in-flight -> skipped, no overlap
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockClassroom.ingestTranscriptChunk).toHaveBeenCalledTimes(1);

      // Now release first ingestion
      delayedIngestResolve!();
      // Allow microtask to resolve
      await Promise.resolve();
      expect(insertedChunks).toHaveLength(1);
      expect(insertedChunks[0].timestampSec).toBe(0);

      // Tick 3 (12000ms): next available tick ingests entry 2 (timestampSec = 4), not a burst
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockClassroom.ingestTranscriptChunk).toHaveBeenCalledTimes(2);
      expect(insertedChunks).toHaveLength(2);
      expect(insertedChunks[1].timestampSec).toBe(4);

      abortController.abort();
      await simPromise;
    });

    it("stop before first tick produces zero rows", async () => {
      const { ingestor, insertedChunks } = createIngestorHarness();
      const abortController = new AbortController();

      const simPromise = runLectureSimulator(
        ingestor,
        teacherActor,
        lectureId,
        CS229_TRANSCRIPT_SCRIPT,
        4000,
        abortController.signal,
      );

      // Advance partially then abort before first tick
      await vi.advanceTimersByTimeAsync(2000);
      abortController.abort();
      await simPromise;

      // Advance past interval
      await vi.advanceTimersByTimeAsync(10000);
      expect(insertedChunks).toHaveLength(0);
    });

    it("stop during ingestion lets in-flight complete and schedules no further entries", async () => {
      const insertedChunks: TranscriptChunk[] = [];
      let delayedResolve: (() => void) | null = null;

      const mockClassroom: Pick<ClassroomService, "ingestTranscriptChunk"> = {
        ingestTranscriptChunk: vi.fn().mockImplementation(async (
          _actor,
          _lecId,
          text,
          timestampSec,
          speakerName,
          provenance,
        ) => {
          const { promise, resolve } = Promise.withResolvers<void>();
          delayedResolve = resolve;
          await promise;
          const chunk: TranscriptChunk = {
            id: `chunk-${insertedChunks.length}` as UUID,
            lectureId,
            text,
            timestampSec,
            speakerName,
            detectedConceptIds: [],
            isSimulated: provenance?.isSimulated,
            createdAt: "2026-10-22T14:00:00.000Z",
          };
          insertedChunks.push(chunk);
          return chunk;
        }),
      };

      const abortController = new AbortController();
      const simPromise = runLectureSimulator(
        mockClassroom,
        teacherActor,
        lectureId,
        CS229_TRANSCRIPT_SCRIPT,
        4000,
        abortController.signal,
      );

      // At 4000ms chunk 1 starts
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockClassroom.ingestTranscriptChunk).toHaveBeenCalledTimes(1);

      // Abort while in flight
      abortController.abort();

      // Release in flight ingestion
      delayedResolve!();
      await simPromise;

      expect(insertedChunks).toHaveLength(1);
      // Advance more time; no more chunks
      await vi.advanceTimersByTimeAsync(20000);
      expect(insertedChunks).toHaveLength(1);
    });

    it("empty script completes immediately without emitting", async () => {
      const { ingestor, insertedChunks } = createIngestorHarness();
      const abortController = new AbortController();

      await runLectureSimulator(
        ingestor,
        teacherActor,
        lectureId,
        [],
        4000,
        abortController.signal,
      );

      expect(insertedChunks).toHaveLength(0);
    });

    it("malformed script rejects before scheduling", async () => {
      const { ingestor } = createIngestorHarness();
      const abortController = new AbortController();

      // Empty text
      await expect(
        runLectureSimulator(
          ingestor,
          teacherActor,
          lectureId,
          [{ text: "   ", timestampSec: 0 }],
          4000,
          abortController.signal,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Negative timestamp
      await expect(
        runLectureSimulator(
          ingestor,
          teacherActor,
          lectureId,
          [{ text: "Valid text", timestampSec: -5 }],
          4000,
          abortController.signal,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Non-decreasing timestamps
      await expect(
        runLectureSimulator(
          ingestor,
          teacherActor,
          lectureId,
          [
            { text: "First chunk", timestampSec: 10 },
            { text: "Second chunk earlier", timestampSec: 5 },
          ],
          4000,
          abortController.signal,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Speaker name too long
      await expect(
        runLectureSimulator(
          ingestor,
          teacherActor,
          lectureId,
          [{ text: "Valid text", timestampSec: 0, speakerName: "A".repeat(101) }],
          4000,
          abortController.signal,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("terminates and rejects done when an ingestion fails", async () => {
      const ingestError = new AppError({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Cannot ingest transcript chunks into an inactive lecture",
      });
      const { ingestor } = createIngestorHarness({ ingestReject: ingestError });
      const abortController = new AbortController();

      const simPromise = runLectureSimulator(
        ingestor,
        teacherActor,
        lectureId,
        CS229_TRANSCRIPT_SCRIPT,
        4000,
        abortController.signal,
      );

      const catchSpy = vi.fn();
      simPromise.catch(catchSpy);

      await vi.advanceTimersByTimeAsync(4000);
      await expect(simPromise).rejects.toBe(ingestError);
    });
  });

  describe("LectureSpeechService Lifecycle & Guards", () => {
    it("rejects non-teacher actors with 403 FORBIDDEN", async () => {
      const { ingestor, deps } = createIngestorHarness();
      const service = new LectureSpeechService(
        {
          classroom: ingestor,
          lectures: deps.lectures,
          rooms: deps.rooms,
        },
        { integrationMode: "fixture", lectureSource: "simulator", tickRateMs: 4000 },
      );

      await expect(service.start(studentActor, lectureId)).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("rejects inactive lecture with 400 BAD_REQUEST", async () => {
      const inactiveLecture: LectureSession = {
        ...liveLecture,
        status: "completed",
        endedAt: "2026-10-22T15:00:00.000Z",
      };
      const { ingestor, deps } = createIngestorHarness({ lecture: inactiveLecture });
      const service = new LectureSpeechService(
        {
          classroom: ingestor,
          lectures: deps.lectures,
          rooms: deps.rooms,
        },
        { integrationMode: "fixture", lectureSource: "simulator", tickRateMs: 4000 },
      );

      await expect(service.start(teacherActor, lectureId)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        statusCode: 400,
      });
    });

    it("rejects duplicate start with 409 CONFLICT, and permits fresh start after stop", async () => {
      const { ingestor, deps } = createIngestorHarness();
      const service = new LectureSpeechService(
        {
          classroom: ingestor,
          lectures: deps.lectures,
          rooms: deps.rooms,
        },
        { integrationMode: "fixture", lectureSource: "simulator", tickRateMs: 4000 },
      );

      const handle1 = await service.start(teacherActor, lectureId);

      // Concurrent start for same lectureId
      await expect(service.start(teacherActor, lectureId)).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
        message: "Lecture speech stream already active",
      });

      // Stop session 1
      await handle1.stop();

      // Fresh start now succeeds
      const handle2 = await service.start(teacherActor, lectureId);
      expect(handle2).toBeDefined();
      await handle2.stop();
    });

    it("dispose stops all active sessions", async () => {
      const { ingestor, deps } = createIngestorHarness();
      const service = new LectureSpeechService(
        {
          classroom: ingestor,
          lectures: deps.lectures,
          rooms: deps.rooms,
        },
        { integrationMode: "fixture", lectureSource: "simulator", tickRateMs: 4000 },
      );

      await service.start(teacherActor, lectureId);
      await service.dispose();
      // Service map is now empty; new start succeeds
      const handleNext = await service.start(teacherActor, lectureId);
      await handleNext.stop();
    });

    it("Zoom selection in fixture integration mode returns 503 SERVICE_UNAVAILABLE", async () => {
      const { ingestor, deps } = createIngestorHarness();
      const service = new LectureSpeechService(
        {
          classroom: ingestor,
          lectures: deps.lectures,
          rooms: deps.rooms,
        },
        { integrationMode: "fixture", lectureSource: "zoom", tickRateMs: 4000 },
      );

      await expect(
        service.start(teacherActor, lectureId, {
          meetingUuid: "uuid-123",
          rtmsStreamId: "stream-123",
          serverUrl: "wss://zoom.us/rtms/stream",
        }),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom RTMS requires live integration mode",
      });
    });
  });

  describe("Zoom RTMS Protocol Adapter", () => {
    const validServerUrl = "wss://zoom.us/rtms/signaling";
    const validTranscriptUrl = "wss://zoom.us/rtms/media/transcript";
    const clientId = "zoom-client-id-123";
    const clientSecret = "zoom-client-secret-xyz";
    const meetingUuid = "meeting-uuid-999";
    const rtmsStreamId = "stream-id-888";

    it("executes signaling and media handshake, answers keep-alive, and streams transcript with isSimulated: false", async () => {
      const { ingestor, insertedChunks, emittedEvents } = createIngestorHarness();
      let signalingSocket: MockWebSocket | null = null;
      let mediaSocket: MockWebSocket | null = null;

      const mockWsFactory = (url: string) => {
        const ws = new MockWebSocket(url);
        if (url === validServerUrl) {
          signalingSocket = ws;
        } else if (url === validTranscriptUrl) {
          mediaSocket = ws;
        }
        return ws as unknown as WebSocket;
      };

      const abortController = new AbortController();
      let readyCalled = false;

      const rtmsPromise = runZoomRtms(
        {
          classroom: ingestor,
          actor: teacherActor,
          lecture: liveLecture,
          meetingUuid,
          rtmsStreamId,
          serverUrl: validServerUrl,
          clientId,
          clientSecret,
          createWebSocket: mockWsFactory,
        },
        abortController.signal,
        () => {
          readyCalled = true;
        },
      );

      expect(signalingSocket).not.toBeNull();
      // 1. Signaling opens -> client sends msg_type: 1
      signalingSocket!.triggerOpen();
      expect(signalingSocket!.sentMessages).toHaveLength(1);
      const handshakeMsg1 = JSON.parse(signalingSocket!.sentMessages[0]);
      expect(handshakeMsg1).toMatchObject({
        msg_type: 1,
        protocol_version: 1,
        meeting_uuid: meetingUuid,
        rtms_stream_id: rtmsStreamId,
      });
      expect(handshakeMsg1.signature).toBeDefined();

      // 2. Signaling responds with msg_type: 2 providing transcript media URL
      signalingSocket!.triggerMessage(
        JSON.stringify({
          msg_type: 2,
          status: 0,
          media_server: {
            server_urls: {
              transcript: validTranscriptUrl,
            },
          },
        }),
      );

      // Media socket should now be created
      expect(mediaSocket).not.toBeNull();

      // 3. Media opens -> client sends msg_type: 3 with media_type: 8
      mediaSocket!.triggerOpen();
      expect(mediaSocket!.sentMessages).toHaveLength(1);
      const mediaHandshakeMsg = JSON.parse(mediaSocket!.sentMessages[0]);
      expect(mediaHandshakeMsg).toMatchObject({
        msg_type: 3,
        protocol_version: 1,
        meeting_uuid: meetingUuid,
        rtms_stream_id: rtmsStreamId,
        media_type: 8,
      });

      // 4. Media responds with msg_type: 4 (status: 0)
      mediaSocket!.triggerMessage(
        JSON.stringify({
          msg_type: 4,
          status: 0,
        }),
      );

      // Client should send msg_type: 7 on signaling socket and call onReady
      expect(signalingSocket!.sentMessages).toHaveLength(2);
      const readyNotice = JSON.parse(signalingSocket!.sentMessages[1]);
      expect(readyNotice).toMatchObject({
        msg_type: 7,
        rtms_stream_id: rtmsStreamId,
      });
      expect(readyCalled).toBe(true);

      // 5. Keep-alive test on both sockets (msg_type 12 -> 13)
      signalingSocket!.triggerMessage(JSON.stringify({ msg_type: 12, timestamp: 12345678 }));
      expect(signalingSocket!.sentMessages).toHaveLength(3);
      expect(JSON.parse(signalingSocket!.sentMessages[2])).toEqual({
        msg_type: 13,
        timestamp: 12345678,
      });

      mediaSocket!.triggerMessage(JSON.stringify({ msg_type: 12, timestamp: 87654321 }));
      expect(mediaSocket!.sentMessages).toHaveLength(2);
      expect(JSON.parse(mediaSocket!.sentMessages[1])).toEqual({
        msg_type: 13,
        timestamp: 87654321,
      });

      // 6. Data message (msg_type 17)
      // lecture.startedAt = "2026-10-22T14:00:00.000Z" (epoch: 1792677600000)
      // timestamp: 1792677604250 -> timestampSec = (1792677604250 - 1792677600000)/1000 = 4.25
      mediaSocket!.triggerMessage(
        JSON.stringify({
          msg_type: 17,
          content: {
            data: "The chain rule computes gradients.",
            user_name: "Prof. Chen",
            timestamp: 1792677604250,
          },
        }),
      );

      await vi.waitFor(() => {
        expect(insertedChunks).toHaveLength(1);
      });
      expect(insertedChunks[0].text).toBe("The chain rule computes gradients.");
      expect(insertedChunks[0].speakerName).toBe("Prof. Chen");
      expect(insertedChunks[0].timestampSec).toBe(4.25);
      expect(insertedChunks[0].isSimulated).toBe(false);

      const chunkEvent = emittedEvents.find((e) => e.event === "transcript:chunk");
      expect(chunkEvent).toBeDefined();
      expect((chunkEvent?.payload as TranscriptChunkEvent).isSimulated).toBe(false);

      // Stop stream
      abortController.abort();
      await rtmsPromise;

      expect(signalingSocket!.closeCalled).toBe(true);
      expect(mediaSocket!.closeCalled).toBe(true);
    });

    it("rejects missing credentials with 503 SERVICE_UNAVAILABLE", async () => {
      const { ingestor } = createIngestorHarness();
      const abortController = new AbortController();

      await expect(
        runZoomRtms(
          {
            classroom: ingestor,
            actor: teacherActor,
            lecture: liveLecture,
            meetingUuid,
            rtmsStreamId,
            serverUrl: validServerUrl,
            clientId: "",
            clientSecret: "",
          },
          abortController.signal,
          vi.fn(),
        ),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom RTMS credentials are not configured",
      });
    });

    it("rejects malformed server URL with 400 VALIDATION_ERROR", async () => {
      const { ingestor } = createIngestorHarness();
      const abortController = new AbortController();

      // Not wss:
      await expect(
        runZoomRtms(
          {
            classroom: ingestor,
            actor: teacherActor,
            lecture: liveLecture,
            meetingUuid,
            rtmsStreamId,
            serverUrl: "http://zoom.us/rtms",
            clientId,
            clientSecret,
          },
          abortController.signal,
          vi.fn(),
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Wrong host
      await expect(
        runZoomRtms(
          {
            classroom: ingestor,
            actor: teacherActor,
            lecture: liveLecture,
            meetingUuid,
            rtmsStreamId,
            serverUrl: "wss://evil-zoom.org/rtms",
            clientId,
            clientSecret,
          },
          abortController.signal,
          vi.fn(),
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Custom non-443 port
      await expect(
        runZoomRtms(
          {
            classroom: ingestor,
            actor: teacherActor,
            lecture: liveLecture,
            meetingUuid,
            rtmsStreamId,
            serverUrl: "wss://zoom.us:8080/rtms",
            clientId,
            clientSecret,
          },
          abortController.signal,
          vi.fn(),
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("terminates with 503 on nonzero signaling handshake status", async () => {
      const { ingestor } = createIngestorHarness();
      let signalingSocket: MockWebSocket | null = null;
      const abortController = new AbortController();

      const rtmsPromise = runZoomRtms(
        {
          classroom: ingestor,
          actor: teacherActor,
          lecture: liveLecture,
          meetingUuid,
          rtmsStreamId,
          serverUrl: validServerUrl,
          clientId,
          clientSecret,
          createWebSocket: (url) => {
            signalingSocket = new MockWebSocket(url);
            return signalingSocket as unknown as WebSocket;
          },
        },
        abortController.signal,
        vi.fn(),
      );

      signalingSocket!.triggerOpen();
      signalingSocket!.triggerMessage(
        JSON.stringify({
          msg_type: 2,
          status: 401, // Handshake rejected
        }),
      );

      await expect(rtmsPromise).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Zoom RTMS handshake failed",
      });
    });

    it("terminates with 504 GATEWAY_TIMEOUT on startup deadline expiry", async () => {
      vi.useFakeTimers();
      try {
        const { ingestor } = createIngestorHarness();
        const abortController = new AbortController();

        const rtmsPromise = runZoomRtms(
          {
            classroom: ingestor,
            actor: teacherActor,
            lecture: liveLecture,
            meetingUuid,
            rtmsStreamId,
            serverUrl: validServerUrl,
            clientId,
            clientSecret,
            createWebSocket: (url) => new MockWebSocket(url) as unknown as WebSocket,
          },
          abortController.signal,
          vi.fn(),
        );

        const catchSpy = vi.fn();
        rtmsPromise.catch(catchSpy);

        // Advance past 10,000ms startup timeout
        await vi.advanceTimersByTimeAsync(10001);

        await expect(rtmsPromise).rejects.toMatchObject({
          code: "GATEWAY_TIMEOUT",
          statusCode: 504,
          message: "Zoom RTMS connection timed out",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("terminates with 502 BAD_GATEWAY on malformed JSON or pre-lecture timestamp", async () => {
      const { ingestor } = createIngestorHarness();
      let signalingSocket: MockWebSocket | null = null;
      const abortController = new AbortController();

      const rtmsPromise = runZoomRtms(
        {
          classroom: ingestor,
          actor: teacherActor,
          lecture: liveLecture,
          meetingUuid,
          rtmsStreamId,
          serverUrl: validServerUrl,
          clientId,
          clientSecret,
          createWebSocket: (url) => {
            signalingSocket = new MockWebSocket(url);
            return signalingSocket as unknown as WebSocket;
          },
        },
        abortController.signal,
        vi.fn(),
      );

      signalingSocket!.triggerOpen();
      signalingSocket!.triggerMessage("NOT_VALID_JSON{");

      await expect(rtmsPromise).rejects.toMatchObject({
        code: "BAD_GATEWAY",
        statusCode: 502,
        message: "Invalid Zoom RTMS message",
      });
    });

    it("abort before readiness throws 400 BAD_REQUEST", async () => {
      const { ingestor } = createIngestorHarness();
      const abortController = new AbortController();

      const rtmsPromise = runZoomRtms(
        {
          classroom: ingestor,
          actor: teacherActor,
          lecture: liveLecture,
          meetingUuid,
          rtmsStreamId,
          serverUrl: validServerUrl,
          clientId,
          clientSecret,
          createWebSocket: (url) => new MockWebSocket(url) as unknown as WebSocket,
        },
        abortController.signal,
        vi.fn(),
      );

      // Abort before any handshake completes
      abortController.abort();

      await expect(rtmsPromise).rejects.toMatchObject({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Lecture speech stream stopped",
      });
    });
  });
});
