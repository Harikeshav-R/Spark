import type { MockInstance } from "vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DetectConceptsCandidate } from "../../../src/contracts/ai.js";
import { summarizedLectureSchema } from "../../../src/contracts/ai.js";
import type { UUID } from "../../../src/contracts/common.js";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import { lectureSummaryReadyEventSchema } from "../../../src/contracts/realtime.js";
import {
  SummarizeLectureAi,
  LectureSummaryRepository,
  PostLectureSummarizer,
  fixtureSummarizeLecture,
  ZERO_CHUNKS_SUMMARY_TEXT,
  FIXTURE_SUMMARY_CONCEPT_ID_1,
  FIXTURE_SUMMARY_CONCEPT_ID_2,
  OpenRouterClient,
  DEFAULT_MODELS,
  type LectureSummaryDatabaseClientPort,
  type TranscriptSourcePort,
} from "../../../src/server/ai/index.js";
import { FakeRealtimePublisher } from "../../fixtures/classroom.fixture.js";

function createMockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("P3-C-02: Post-Lecture Summarization Pipeline (CP-P3-C-02)", () => {
  const LECTURE_ID: UUID = "88888888-8888-4888-8888-888888888888";
  const COURSE_ID: UUID = "11111111-1111-4111-8111-111111111111";
  const ID_GRADIENT: UUID = "33333333-3333-4333-8333-333333333316";
  const ID_LEARNING_RATE: UUID = "33333333-3333-4333-8333-333333333317";
  const ID_BACKPROP: UUID = "33333333-3333-4333-8333-333333333318";

  const standardCandidates: DetectConceptsCandidate[] = [
    { id: ID_GRADIENT, label: "Gradient Descent" },
    { id: ID_LEARNING_RATE, label: "Learning Rate" },
    { id: ID_BACKPROP, label: "Backpropagation" },
  ];

  const standardTranscriptChunks = [
    { text: "Today we begin analyzing gradient descent algorithms.", timestampSec: 0 },
    { text: "The gradient points in the direction of greatest rate of increase.", timestampSec: 30 },
    { text: "We update parameters using a step scaled by the learning rate.", timestampSec: 120 },
    { text: "Backpropagation computes these partial derivatives across layers.", timestampSec: 300 },
  ];

  let warnSpy: MockInstance;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // ==========================================================================
  // 1. CP-P3-C-02 Verification & Deterministic Fixture
  // ==========================================================================
  describe("1. CP-P3-C-02 Verification & Deterministic Fixtures", () => {
    it("completed lecture generates markdown summary with key concepts list", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const summarizer = new SummarizeLectureAi(client);

      const result = await summarizer.summarizeLecture(
        standardTranscriptChunks,
        standardCandidates
      );

      // Verify schema compliance
      expect(summarizedLectureSchema.safeParse(result).success).toBe(true);

      // Verify Markdown structure
      expect(result.summary).toContain("## Lecture Overview");
      expect(result.summary).toContain("## Key Concepts Covered");
      expect(result.summary.length).toBeGreaterThanOrEqual(100);
      expect(result.summary.length).toBeLessThanOrEqual(3000);

      // Verify key concepts extracted
      expect(result.keyConceptsCovered).toContain(ID_GRADIENT);
      expect(result.keyConceptsCovered).toContain(ID_LEARNING_RATE);
      expect(result.keyConceptsCovered).toContain(ID_BACKPROP);

      // Verify timeline highlights
      expect(result.timelineHighlights.length).toBeGreaterThanOrEqual(2);
      expect(result.timelineHighlights[0].timestampSec).toBe(0);
      expect(result.timelineHighlights[0].conceptLabel).toBe("Gradient Descent");
    });

    it("fixture helper directly produces valid output matching schema", () => {
      const result = fixtureSummarizeLecture(standardTranscriptChunks, standardCandidates);
      expect(summarizedLectureSchema.safeParse(result).success).toBe(true);
      expect(result.keyConceptsCovered).toContain(ID_GRADIENT);
    });

    it("falls back to default canonical concepts when candidate list is empty", () => {
      const result = fixtureSummarizeLecture(standardTranscriptChunks, []);
      expect(result.keyConceptsCovered).toEqual([
        FIXTURE_SUMMARY_CONCEPT_ID_1,
        FIXTURE_SUMMARY_CONCEPT_ID_2,
      ]);
    });
  });

  // ==========================================================================
  // 2. Invariant: Lecture with Zero Chunks
  // ==========================================================================
  describe("2. Invariant: Zero Chunks Returns Concise Notice Without LLM Error", () => {
    it("returns zero-chunk notice for empty chunk array without invoking OpenRouter", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const completeSpy = vi.spyOn(client, "complete");
      const summarizer = new SummarizeLectureAi(client);

      const result = await summarizer.summarizeLecture([]);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(result.summary).toBe(ZERO_CHUNKS_SUMMARY_TEXT);
      expect(result.keyConceptsCovered).toEqual([]);
      expect(result.timelineHighlights).toEqual([]);
      expect(result.summary.length).toBeGreaterThanOrEqual(100);
      expect(summarizedLectureSchema.safeParse(result).success).toBe(true);
    });

    it("returns zero-chunk notice when chunks contain only empty strings or whitespace", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const completeSpy = vi.spyOn(client, "complete");
      const summarizer = new SummarizeLectureAi(client);

      const result = await summarizer.summarizeLecture([
        { text: "   ", timestampSec: 0 },
        { text: "", timestampSec: 10 },
      ]);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(result.summary).toBe(ZERO_CHUNKS_SUMMARY_TEXT);
      expect(result.keyConceptsCovered).toEqual([]);
      expect(result.timelineHighlights).toEqual([]);
    });
  });

  // ==========================================================================
  // 3. OpenRouter Deep Model & Live Integration Verification
  // ==========================================================================
  describe("3. OpenRouter Deep Model & Live Mode Compliance", () => {
    it("reports integration mode correctly", () => {
      const fixtureClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      expect(new SummarizeLectureAi(fixtureClient).getIntegrationMode()).toBe("fixture");

      const liveClient = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-v1-test" },
      });
      expect(new SummarizeLectureAi(liveClient).getIntegrationMode()).toBe("live");
    });

    it("fails construction with 503 SERVICE_UNAVAILABLE when live credentials missing (Gate 6)", () => {
      try {
        new OpenRouterClient({ env: { INTEGRATION_MODE: "live" } });
        expect.unreachable("Should have thrown AppError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.SERVICE_UNAVAILABLE);
        expect(appErr.statusCode).toBe(503);
      }
    });

    it("calls OpenRouter API with deep tier and parses valid JSON in live mode", async () => {
      const mockSummaryPayload = {
        summary:
          "## Lecture Overview\nThis session comprehensively covered stochastic gradient descent algorithms and stability.\n\n## Key Concepts\nConvergence criteria and adaptive learning rates were analyzed in depth across diverse topologies.",
        keyConceptsCovered: [ID_GRADIENT, ID_LEARNING_RATE],
        timelineHighlights: [
          {
            timestampSec: 10,
            conceptLabel: "Gradient Descent",
            description: "Definition of negative gradient descent path.",
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue(
        createMockResponse(200, {
          id: "gen-123",
          choices: [
            {
              message: {
                content: JSON.stringify(mockSummaryPayload),
              },
            },
          ],
        })
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-v1-test" },
        fetch: fetchMock as unknown as typeof fetch,
      });

      const summarizer = new SummarizeLectureAi(client);
      const result = await summarizer.summarizeLecture(
        standardTranscriptChunks,
        standardCandidates
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      expect(requestBody.model).toBe(DEFAULT_MODELS.deep);
      expect(requestBody.max_tokens).toBe(1500);

      expect(result.summary).toContain("## Lecture Overview");
      expect(result.keyConceptsCovered).toEqual([ID_GRADIENT, ID_LEARNING_RATE]);
    });

    it("filters candidate concept IDs to match candidate list in live mode", async () => {
      const mockSummaryPayload = {
        summary:
          "## Lecture Overview\nDetailed analysis of neural optimization algorithms and loss function dynamics over multiple epochs.\n\n## Summary\nAll concepts were synthesized successfully.",
        keyConceptsCovered: [ID_GRADIENT, "44444444-4444-4444-8444-444444444444"],
        timelineHighlights: [
          {
            timestampSec: 20,
            conceptLabel: "Gradient Descent",
            description: "Explanation of gradient.",
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue(
        createMockResponse(200, {
          choices: [{ message: { content: JSON.stringify(mockSummaryPayload) } }],
        })
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-v1-test" },
        fetch: fetchMock as unknown as typeof fetch,
      });

      const summarizer = new SummarizeLectureAi(client);
      const result = await summarizer.summarizeLecture(
        standardTranscriptChunks,
        standardCandidates
      );

      // Untrusted concept ID "44444444-..." is excluded since not in standardCandidates
      expect(result.keyConceptsCovered).toEqual([ID_GRADIENT]);
    });
  });

  // ==========================================================================
  // 4. Persistence: LectureSummaryRepository
  // ==========================================================================
  describe("4. Persistence: LectureSummaryRepository", () => {
    it("persists and reads back a lecture summary record", async () => {
      const memoryDb = new Map<string, unknown>();

      const mockClient: LectureSummaryDatabaseClientPort = {
        from: (_table: string) => ({
          insert: (values: unknown) => {
            const row = values as { lecture_id: string };
            memoryDb.set(row.lecture_id, values);
            return {
              select: () => ({
                single: async () => ({ data: values, error: null }),
              }),
            };
          },
          select: () => ({
            eq: (_col: string, val: unknown) => ({
              single: async () => ({ data: memoryDb.get(val as string) ?? null, error: null }),
              maybeSingle: async () => ({
                data: memoryDb.get(val as string) ?? null,
                error: null,
              }),
            }),
          }),
        }),
      };

      const repo = new LectureSummaryRepository(mockClient);

      const saved = await repo.saveSummary({
        lectureId: LECTURE_ID,
        summary:
          "## Overview\nThis lecture covered optimization algorithms, step sizes, and stability proofs for convex objective functions.\n\n## Takeaway\nConvergence bounds depend directly on Lipschitz continuity.",
        keyConceptsCovered: [ID_GRADIENT, ID_LEARNING_RATE],
        timelineHighlights: [
          {
            timestampSec: 60,
            conceptLabel: "Gradient Descent",
            description: "Initial formulation.",
          },
        ],
        createdAt: "2026-10-23T15:00:00.000Z",
      });

      expect(saved.lectureId).toBe(LECTURE_ID);
      expect(saved.keyConceptsCovered).toEqual([ID_GRADIENT, ID_LEARNING_RATE]);

      const retrieved = await repo.getSummary(LECTURE_ID);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summary).toBe(saved.summary);
      expect(retrieved?.timelineHighlights).toEqual(saved.timelineHighlights);
    });

    it("returns null when no summary exists for lectureId", async () => {
      const mockClient: LectureSummaryDatabaseClientPort = {
        from: () => ({
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
          select: () => ({
            eq: () => ({
              single: async () => ({ data: null, error: null }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };

      const repo = new LectureSummaryRepository(mockClient);
      const result = await repo.getSummary(LECTURE_ID);
      expect(result).toBeNull();
    });

    it("rejects invalid UUID with 400 VALIDATION_ERROR", async () => {
      const mockClient = { from: vi.fn() } as unknown as LectureSummaryDatabaseClientPort;
      const repo = new LectureSummaryRepository(mockClient);

      await expect(repo.getSummary("invalid-uuid" as UUID)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("maps database network failure to 503 SERVICE_UNAVAILABLE", async () => {
      const mockClient: LectureSummaryDatabaseClientPort = {
        from: () => ({
          insert: () => {
            throw new Error("Connection refused");
          },
          select: () => ({
            eq: () => {
              throw new Error("Connection timed out");
            },
          }),
        }),
      };

      const repo = new LectureSummaryRepository(mockClient);

      await expect(
        repo.saveSummary({
          lectureId: LECTURE_ID,
          summary:
            "## Overview\nValid summary with at least 100 characters in length to pass schema validation constraints cleanly.\n\n## Takeaway\nComplete takeaway statement.",
          keyConceptsCovered: [ID_GRADIENT],
          timelineHighlights: [],
          createdAt: "2026-10-23T15:00:00.000Z",
        })
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });

      await expect(repo.getSummary(LECTURE_ID)).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });
  });

  // ==========================================================================
  // 5. Orchestration: PostLectureSummarizer & Realtime Broadcasting
  // ==========================================================================
  describe("5. Orchestration: PostLectureSummarizer & Realtime Broadcasting", () => {
    it("fetches transcript, calls AI, persists summary, and broadcasts lecture:summary-ready", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const ai = new SummarizeLectureAi(client);

      const transcriptSource: TranscriptSourcePort = {
        getTranscriptChunks: vi.fn().mockResolvedValue(standardTranscriptChunks),
        getCandidateConcepts: vi.fn().mockResolvedValue(standardCandidates),
      };

      const memoryDb = new Map<string, unknown>();
      const mockDb: LectureSummaryDatabaseClientPort = {
        from: () => ({
          insert: (values: unknown) => {
            const row = values as { lecture_id: string };
            memoryDb.set(row.lecture_id, values);
            return {
              select: () => ({ single: async () => ({ data: values, error: null }) }),
            };
          },
          select: () => ({
            eq: (_c: string, val: unknown) => ({
              single: async () => ({ data: memoryDb.get(val as string) ?? null, error: null }),
              maybeSingle: async () => ({ data: memoryDb.get(val as string) ?? null, error: null }),
            }),
          }),
        }),
      };
      const summaryRepository = new LectureSummaryRepository(mockDb);
      const publisher = new FakeRealtimePublisher();

      const fixedClock = { nowISO: () => "2026-10-23T15:30:00.000Z" };
      const fixedIdGen = { generateUUID: () => "99999999-9999-4999-8999-999999999999" as UUID };

      const summarizer = new PostLectureSummarizer({
        ai,
        transcriptSource,
        summaryRepository,
        publisher,
        clock: fixedClock,
        idGenerator: fixedIdGen,
      });

      const record = await summarizer.summarizeCompletedLecture(LECTURE_ID, COURSE_ID);

      // 1. Verify transcript and candidates fetched
      expect(transcriptSource.getTranscriptChunks).toHaveBeenCalledWith(LECTURE_ID);
      expect(transcriptSource.getCandidateConcepts).toHaveBeenCalledWith(COURSE_ID);

      // 2. Verify summary record created and persisted
      expect(record.lectureId).toBe(LECTURE_ID);
      expect(record.summary).toContain("## Lecture Overview");
      expect(record.createdAt).toBe("2026-10-23T15:30:00.000Z");

      const inDb = await summaryRepository.getSummary(LECTURE_ID);
      expect(inDb).not.toBeNull();
      expect(inDb?.summary).toBe(record.summary);

      // 3. Verify lecture:summary-ready broadcast
      expect(publisher.lectureEmissions).toHaveLength(1);
      const emission = publisher.lectureEmissions[0];
      expect(emission.lectureId).toBe(LECTURE_ID);
      expect(emission.event).toBe("lecture:summary-ready");

      const parsedEvent = lectureSummaryReadyEventSchema.parse(emission.payload);
      expect(parsedEvent.eventId).toBe("99999999-9999-4999-8999-999999999999");
      expect(parsedEvent.lectureId).toBe(LECTURE_ID);
      expect(parsedEvent.summary).toBe(record.summary);
      expect(parsedEvent.keyConceptsCovered).toEqual(record.keyConceptsCovered);
    });

    it("handles zero chunks seamlessly and broadcasts notice event", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const ai = new SummarizeLectureAi(client);

      const transcriptSource: TranscriptSourcePort = {
        getTranscriptChunks: vi.fn().mockResolvedValue([]),
      };

      const savedRecords: unknown[] = [];
      const summaryRepository = {
        saveSummary: vi.fn().mockImplementation(async (r) => {
          savedRecords.push(r);
          return r;
        }),
        getSummary: vi.fn().mockResolvedValue(null),
      };

      const publisher = new FakeRealtimePublisher();

      const summarizer = new PostLectureSummarizer({
        ai,
        transcriptSource,
        summaryRepository,
        publisher,
      });

      const record = await summarizer.summarizeCompletedLecture(LECTURE_ID);

      expect(record.summary).toBe(ZERO_CHUNKS_SUMMARY_TEXT);
      expect(record.keyConceptsCovered).toEqual([]);
      expect(record.timelineHighlights).toEqual([]);

      expect(summaryRepository.saveSummary).toHaveBeenCalledTimes(1);
      expect(publisher.lectureEmissions).toHaveLength(1);
      expect(publisher.lectureEmissions[0].event).toBe("lecture:summary-ready");
    });

    it("does not throw when realtime publisher fails, but still returns saved summary", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const ai = new SummarizeLectureAi(client);

      const transcriptSource: TranscriptSourcePort = {
        getTranscriptChunks: vi.fn().mockResolvedValue(standardTranscriptChunks),
      };

      const summaryRepository = {
        saveSummary: vi.fn().mockImplementation(async (r) => r),
        getSummary: vi.fn().mockResolvedValue(null),
      };

      const failingPublisher = {
        emitToLecture: vi.fn().mockRejectedValue(new Error("Socket disconnected")),
        emitToTeacher: vi.fn().mockResolvedValue(undefined),
        emitToStudent: vi.fn().mockResolvedValue(undefined),
        emitToStudyGroup: vi.fn().mockResolvedValue(undefined),
      };

      const summarizer = new PostLectureSummarizer({
        ai,
        transcriptSource,
        summaryRepository,
        publisher: failingPublisher,
      });

      const record = await summarizer.summarizeCompletedLecture(LECTURE_ID);

      expect(record.lectureId).toBe(LECTURE_ID);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("rejects invalid lectureId format with 400 VALIDATION_ERROR", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const ai = new SummarizeLectureAi(client);

      const summarizer = new PostLectureSummarizer({
        ai,
        transcriptSource: { getTranscriptChunks: vi.fn().mockResolvedValue([]) },
        summaryRepository: { saveSummary: vi.fn(), getSummary: vi.fn() },
      });

      await expect(
        summarizer.summarizeCompletedLecture("bad-id" as UUID)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });
  });
});
