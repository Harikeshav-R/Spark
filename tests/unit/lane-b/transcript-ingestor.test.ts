import { describe, it, expect, vi } from "vitest";
import type {
  LectureSession,
  TranscriptChunk,
} from "../../../src/contracts/classroom.js";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../../src/contracts/common.js";
import { AppError } from "../../../src/contracts/errors.js";
import type {
  ConceptDetectedEvent,
  TranscriptChunkEvent,
} from "../../../src/contracts/realtime.js";
import {
  TranscriptIngestor,
  type TranscriptIngestorDependencies,
} from "../../../src/server/classroom/transcript-ingestor.js";

describe("TranscriptIngestor Unit Tests", () => {
  const teacherAuthId = "11111111-1111-4111-8111-111111111111";
  const teacherId = "22222222-2222-4222-8222-222222222222";
  const studentAuthId = "33333333-3333-4333-8333-333333333333";
  const studentId = "44444444-4444-4444-8444-444444444444";
  const courseId = "55555555-5555-4555-8555-555555555555";
  const lectureId = "66666666-6666-4666-8666-666666666666";
  const chunkId = "77777777-7777-4777-8777-777777777777";
  const eventId1 = "88888888-8888-4888-8888-888888888888";
  const eventId2 = "99999999-9999-4999-8999-999999999999";
  const conceptId1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const conceptId2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const foreignConceptId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const teacherActor: ActorContext = {
    userId: teacherAuthId,
    authId: teacherAuthId,
    teacherId,
    role: "teacher",
    name: "Prof. Alan Turing",
    email: "turing@example.edu",
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentAuthId,
    authId: studentAuthId,
    role: "student",
    name: "Grace Hopper",
    email: "hopper@example.edu",
    enrolledCourses: [{ studentId, courseId }],
  };

  const mockTime = "2026-10-22T14:30:00.000Z";
  const mockClock: Clock = {
    now: () => new Date(mockTime),
    nowISO: () => mockTime,
  };

  let idCounter = 0;
  const mockIds: IdGenerator = {
    generateId: () => {
      idCounter += 1;
      if (idCounter === 1) return chunkId;
      if (idCounter === 2) return eventId1;
      return eventId2;
    },
    generateJoinCode: () => "CODE1",
  };

  const liveLecture: LectureSession = {
    id: lectureId,
    courseId,
    title: "Intro to ML",
    status: "live",
    startedAt: mockTime,
  };

  function createTestHarness(overrides?: {
    lecture?: LectureSession;
    candidates?: { id: UUID; label: string }[];
    detected?: UUID[];
    detectorError?: Error;
    attendingStudentIds?: UUID[];
    attendanceError?: Error;
    onDetectConcepts?: () => void;
  }) {
    idCounter = 0;
    const lectureToUse = overrides?.lecture ?? liveLecture;
    const candidateList = overrides?.candidates ?? [
      { id: conceptId1, label: "Gradient Descent" },
      { id: conceptId2, label: "Backpropagation" },
    ];

    const insertedChunks: TranscriptChunk[] = [];
    const insertedLinks: { chunkId: UUID; conceptIds: UUID[] }[] = [];
    const emittedEvents: { lectureId: UUID; event: string; payload: unknown }[] = [];

    const deps: TranscriptIngestorDependencies = {
      lectures: {
        getLecture: vi.fn().mockResolvedValue(lectureToUse),
      },
      transcripts: {
        getCandidateConcepts: vi.fn().mockResolvedValue(candidateList),
        insertChunk: vi.fn().mockImplementation(async (chunk: TranscriptChunk) => {
          insertedChunks.push(chunk);
          return chunk;
        }),
        insertConceptLinks: vi.fn().mockImplementation(async (cId: UUID, cIds: UUID[]) => {
          insertedLinks.push({ chunkId: cId, conceptIds: cIds });
        }),
      },
      rooms: {
        authorizeRoom: vi.fn().mockResolvedValue(undefined),
      },
      ai: {
        detectConcepts: overrides?.detectorError
          ? vi.fn().mockRejectedValue(overrides.detectorError)
          : vi.fn().mockImplementation(async (_text: string, _cands: { id: UUID; label: string }[]) => {
              if (overrides?.onDetectConcepts) {
                overrides.onDetectConcepts();
              }
              return overrides?.detected ?? [conceptId1];
            }),
      },
      presence: {
        getAttendingStudentIds: vi.fn().mockReturnValue(overrides?.attendingStudentIds ?? [studentId]),
      },
      attendance: {
        recordChunkAttendance: overrides?.attendanceError
          ? vi.fn().mockRejectedValue(overrides.attendanceError)
          : vi.fn().mockResolvedValue([]),
      },
      publisher: {
        emitToLecture: vi
          .fn()
          .mockImplementation(async (lecId: UUID, ev: string, payload: unknown) => {
            emittedEvents.push({ lectureId: lecId, event: ev, payload });
          }),
      },
      ids: mockIds,
      clock: mockClock,
    };

    const ingestor = new TranscriptIngestor(deps);
    return {
      ingestor,
      deps,
      insertedChunks,
      insertedLinks,
      emittedEvents,
    };
  }

  it("successful ingestion persists chunk, detects concepts, and broadcasts events in order", async () => {
    const { ingestor, deps, insertedChunks, insertedLinks, emittedEvents } = createTestHarness();

    const result = await ingestor.ingestTranscriptChunk(
      teacherActor,
      lectureId,
      "Today we cover gradient descent.",
      142.5,
      "Prof. Chen",
    );

    expect(deps.rooms.authorizeRoom).toHaveBeenCalledWith(teacherActor, `professor:${lectureId}`);
    expect(deps.lectures.getLecture).toHaveBeenCalledWith(lectureId);
    expect(deps.transcripts.getCandidateConcepts).toHaveBeenCalledWith(courseId);
    expect(deps.ai.detectConcepts).toHaveBeenCalledWith("Today we cover gradient descent.", [
      { id: conceptId1, label: "Gradient Descent" },
      { id: conceptId2, label: "Backpropagation" },
    ]);

    expect(insertedChunks).toHaveLength(1);
    expect(insertedChunks[0]).toEqual({
      id: chunkId,
      lectureId,
      text: "Today we cover gradient descent.",
      timestampSec: 142.5,
      speakerName: "Prof. Chen",
      detectedConceptIds: [],
      createdAt: mockTime,
    });

    expect(insertedLinks).toHaveLength(1);
    expect(insertedLinks[0]).toEqual({
      chunkId,
      conceptIds: [conceptId1],
    });

    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0]).toEqual({
      lectureId,
      event: "transcript:chunk",
      payload: {
        eventId: eventId1,
        occurredAt: mockTime,
        chunkId,
        lectureId,
        text: "Today we cover gradient descent.",
        timestampSec: 142.5,
        speakerName: "Prof. Chen",
      } satisfies TranscriptChunkEvent,
    });
    expect(emittedEvents[1]).toEqual({
      lectureId,
      event: "lecture:concept-detected",
      payload: {
        eventId: eventId2,
        occurredAt: mockTime,
        lectureId,
        conceptIds: [conceptId1],
      } satisfies ConceptDetectedEvent,
    });

    expect(result).toEqual({
      id: chunkId,
      lectureId,
      text: "Today we cover gradient descent.",
      timestampSec: 142.5,
      speakerName: "Prof. Chen",
      detectedConceptIds: [conceptId1],
      createdAt: mockTime,
    });
  });

  it("attaches explicit isSimulated provenance to stored chunk and broadcast event", async () => {
    const { ingestor, insertedChunks, emittedEvents } = createTestHarness();

    const res = await ingestor.ingestTranscriptChunk(
      teacherActor,
      lectureId,
      "Simulated demo speech segment.",
      10.0,
      "Simulator",
      { isSimulated: true },
    );

    expect(insertedChunks[0].isSimulated).toBe(true);
    const chunkEvent = emittedEvents.find((e) => e.event === "transcript:chunk");
    expect(chunkEvent).toBeDefined();
    expect((chunkEvent?.payload as TranscriptChunkEvent).isSimulated).toBe(true);
    expect(res.isSimulated).toBe(true);
  });

  it("rejects invalid provenance object with 400 VALIDATION_ERROR", async () => {
    const { ingestor } = createTestHarness();

    await expect(
      ingestor.ingestTranscriptChunk(
        teacherActor,
        lectureId,
        "Invalid provenance test.",
        10.0,
        "Simulator",
        { isSimulated: "true" as unknown as boolean },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  });

  it("proves persist-before-publish invariant: writes complete before events emitted", async () => {
    let chunkInserted = false;
    let linksInserted = false;

    const { ingestor, deps } = createTestHarness();

    deps.transcripts.insertChunk = vi.fn().mockImplementation(async (chunk: TranscriptChunk) => {
      chunkInserted = true;
      return chunk;
    });

    deps.transcripts.insertConceptLinks = vi.fn().mockImplementation(async () => {
      linksInserted = true;
    });

    deps.publisher.emitToLecture = vi.fn().mockImplementation(async () => {
      // At the point any event is emitted, both chunk and links must be committed
      expect(chunkInserted).toBe(true);
      expect(linksInserted).toBe(true);
    });

    await ingestor.ingestTranscriptChunk(
      teacherActor,
      lectureId,
      "Testing persist-before-publish order",
      0,
    );

    expect(deps.publisher.emitToLecture).toHaveBeenCalledTimes(2);
  });

  it("handles empty candidate concepts without calling detector", async () => {
    const { ingestor, deps, insertedLinks, emittedEvents } = createTestHarness({
      candidates: [],
    });

    const result = await ingestor.ingestTranscriptChunk(
      teacherActor,
      lectureId,
      "No concepts defined for this course yet.",
      10,
    );

    expect(deps.ai.detectConcepts).not.toHaveBeenCalled();
    expect(insertedLinks).toHaveLength(0);
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].payload).toMatchObject({
      conceptIds: [],
    });
    expect(result.detectedConceptIds).toEqual([]);
  });

  it("filters foreign concepts and deduplicates detector output in order", async () => {
    const { ingestor, insertedLinks } = createTestHarness({
      detected: [conceptId2, foreignConceptId, conceptId2, conceptId1],
    });

    const result = await ingestor.ingestTranscriptChunk(
      teacherActor,
      lectureId,
      "Multiple concept detections",
      20,
    );

    // Foreign concept omitted, duplicate conceptId2 omitted, order preserved: [conceptId2, conceptId1]
    expect(insertedLinks[0].conceptIds).toEqual([conceptId2, conceptId1]);
    expect(result.detectedConceptIds).toEqual([conceptId2, conceptId1]);
  });

  describe("Validation & Invariants", () => {
    it("rejects non-teacher actor with 403 FORBIDDEN", async () => {
      const { ingestor, deps } = createTestHarness();

      await expect(
        ingestor.ingestTranscriptChunk(studentActor, lectureId, "Hello", 1),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      expect(deps.transcripts.insertChunk).not.toHaveBeenCalled();
    });

    it("rejects teacher without teacherId with 403 FORBIDDEN", async () => {
      const { ingestor } = createTestHarness();

      await expect(
        ingestor.ingestTranscriptChunk(
          { ...teacherActor, teacherId: undefined },
          lectureId,
          "Hello",
          1,
        ),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("rejects room authorization failure with 403 FORBIDDEN", async () => {
      const { ingestor, deps } = createTestHarness();
      deps.rooms.authorizeRoom = vi.fn().mockRejectedValue(
        new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Not permitted in lecture room",
        }),
      );

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Hello", 1),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      expect(deps.transcripts.insertChunk).not.toHaveBeenCalled();
    });

    it("rejects chunks to inactive lecture with 400 BAD_REQUEST", async () => {
      const { ingestor, deps } = createTestHarness({
        lecture: { ...liveLecture, status: "completed" },
      });

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Lecture already done", 50),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        statusCode: 400,
        message: "Cannot ingest transcript chunks into an inactive lecture",
      });

      expect(deps.transcripts.insertChunk).not.toHaveBeenCalled();
      expect(deps.publisher.emitToLecture).not.toHaveBeenCalled();
    });

    it("rejects invalid lecture UUID with 400 VALIDATION_ERROR", async () => {
      const { ingestor } = createTestHarness();

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, "not-a-uuid", "Text", 5),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("rejects empty or whitespace text with 400 VALIDATION_ERROR", async () => {
      const { ingestor } = createTestHarness();

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "", 5),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "   \n\t  ", 5),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("rejects negative timestamp with 400 VALIDATION_ERROR", async () => {
      const { ingestor } = createTestHarness();

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Text", -0.1),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("rejects NaN and Infinity timestamps with 400 VALIDATION_ERROR", async () => {
      const { ingestor } = createTestHarness();

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Text", Number.NaN),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Text", Number.POSITIVE_INFINITY),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("rejects overlong speaker name with 400 VALIDATION_ERROR", async () => {
      const { ingestor } = createTestHarness();

      await expect(
        ingestor.ingestTranscriptChunk(
          teacherActor,
          lectureId,
          "Text",
          10,
          "a".repeat(101),
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("propagates detector 503 SERVICE_UNAVAILABLE error and does not broadcast", async () => {
      const { ingestor, deps, insertedChunks, emittedEvents } = createTestHarness({
        detectorError: new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "AI service offline",
        }),
      });

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "AI is down", 15),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });

      // Raw chunk was committed
      expect(insertedChunks).toHaveLength(1);
      // No links and no events emitted
      expect(deps.transcripts.insertConceptLinks).not.toHaveBeenCalled();
      expect(emittedEvents).toHaveLength(0);
    });

    it("rejects malformed detector output with 502 BAD_GATEWAY and does not broadcast", async () => {
      const { ingestor, deps, insertedChunks, emittedEvents } = createTestHarness({
        detected: ["not-a-valid-uuid" as UUID],
      });

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Malformed AI result", 15),
      ).rejects.toMatchObject({
        code: "BAD_GATEWAY",
        statusCode: 502,
      });

      expect(insertedChunks).toHaveLength(1);
      expect(deps.transcripts.insertConceptLinks).not.toHaveBeenCalled();
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("Attendance Evidence Integration", () => {
    it("calls recordChunkAttendance after persisting concept links and before broadcast", async () => {
      const callOrder: string[] = [];
      const { ingestor, deps } = createTestHarness();

      vi.mocked(deps.transcripts.insertConceptLinks).mockImplementation(async () => {
        callOrder.push("insertConceptLinks");
      });
      vi.mocked(deps.attendance.recordChunkAttendance).mockImplementation(async () => {
        callOrder.push("recordChunkAttendance");
        return [];
      });
      vi.mocked(deps.publisher.emitToLecture).mockImplementation(async () => {
        callOrder.push("emitToLecture");
      });

      await ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Hello gradient descent", 10);

      expect(deps.attendance.recordChunkAttendance).toHaveBeenCalledWith(
        teacherActor,
        courseId,
        lectureId,
        chunkId,
        [studentId],
      );
      expect(callOrder).toEqual([
        "insertConceptLinks",
        "recordChunkAttendance",
        "emitToLecture",
        "emitToLecture",
      ]);
    });

    it("propagates error if recordChunkAttendance throws and aborts broadcast", async () => {
      const attendanceError = new AppError({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to record attendance",
      });
      const { ingestor, deps } = createTestHarness({ attendanceError });

      await expect(
        ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Hello gradient descent", 10),
      ).rejects.toThrow("Failed to record attendance");

      expect(deps.publisher.emitToLecture).not.toHaveBeenCalled();
    });

    it("skips recordChunkAttendance when attending student list is empty", async () => {
      const { ingestor, deps } = createTestHarness({ attendingStudentIds: [] });

      const result = await ingestor.ingestTranscriptChunk(
        teacherActor,
        lectureId,
        "Hello gradient descent",
        10,
      );

      expect(deps.attendance.recordChunkAttendance).not.toHaveBeenCalled();
      expect(deps.publisher.emitToLecture).toHaveBeenCalledTimes(2);
      expect(result.detectedConceptIds).toEqual([conceptId1]);
    });

    it("skips recordChunkAttendance when no concepts are accepted", async () => {
      const { ingestor, deps } = createTestHarness({ detected: [] });

      const result = await ingestor.ingestTranscriptChunk(
        teacherActor,
        lectureId,
        "Just some chat without concepts",
        10,
      );

      expect(deps.attendance.recordChunkAttendance).not.toHaveBeenCalled();
      // Still broadcasts chunk event
      expect(deps.publisher.emitToLecture).toHaveBeenCalledWith(
        lectureId,
        "transcript:chunk",
        expect.any(Object),
      );
      expect(result.detectedConceptIds).toEqual([]);
    });

    it("snapshots attendees before detection so late joining students are not awarded earlier chunk", async () => {
      let attendees = [studentId];
      const lateStudentId = "bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb" as UUID;

      const { ingestor, deps } = createTestHarness({
        onDetectConcepts: () => {
          // Simulate student joining during AI detection
          attendees = [studentId, lateStudentId];
        },
      });
      vi.mocked(deps.presence.getAttendingStudentIds).mockImplementation(() => [...attendees]);

      await ingestor.ingestTranscriptChunk(teacherActor, lectureId, "Hello gradient descent", 10);

      // Only studentId should be present, not lateStudentId
      expect(deps.attendance.recordChunkAttendance).toHaveBeenCalledWith(
        teacherActor,
        courseId,
        lectureId,
        chunkId,
        [studentId],
      );
    });
  });
});
