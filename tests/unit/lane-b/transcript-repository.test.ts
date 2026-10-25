import { describe, it, expect, vi } from "vitest";
import type { TranscriptChunk } from "../../../src/contracts/classroom.js";
import {
  TranscriptRepository,
  type TranscriptDatabaseClientPort,
} from "../../../src/server/classroom/transcript-repository.js";

describe("TranscriptRepository Unit Tests", () => {
  const courseId = "11111111-1111-4111-8111-111111111111";
  const lectureId = "22222222-2222-4222-8222-222222222222";
  const chunkId = "33333333-3333-4333-8333-333333333333";
  const conceptId1 = "44444444-4444-4444-8444-444444444444";
  const conceptId2 = "55555555-5555-4555-8555-555555555555";
  const timestamp = "2026-10-22T10:00:00.000Z";

  describe("getCandidateConcepts", () => {
    it("validates courseId format", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn(),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getCandidateConcepts("invalid-uuid")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    it("returns candidate concepts when present", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { id: conceptId1, label: "Gradient Descent" },
                { id: conceptId2, label: "Backpropagation" },
              ],
              error: null,
            }),
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      const concepts = await repo.getCandidateConcepts(courseId);
      expect(concepts).toEqual([
        { id: conceptId1, label: "Gradient Descent" },
        { id: conceptId2, label: "Backpropagation" },
      ]);
    });

    it("returns empty array when no concepts found", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      const concepts = await repo.getCandidateConcepts(courseId);
      expect(concepts).toEqual([]);
    });

    it("maps transport failure to 503 SERVICE_UNAVAILABLE", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockRejectedValue(new Error("Connection reset")),
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getCandidateConcepts(courseId)).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("maps database query error to 500 INTERNAL_SERVER_ERROR", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "relation does not exist" },
            }),
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getCandidateConcepts(courseId)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });

    it("maps malformed rows to 500 INTERNAL_SERVER_ERROR", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: "not-a-uuid", label: "" }],
              error: null,
            }),
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getCandidateConcepts(courseId)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });
  });

  describe("insertChunk", () => {
    const validChunk: TranscriptChunk = {
      id: chunkId,
      lectureId,
      text: "Today we discuss neural network optimization.",
      timestampSec: 12.5,
      speakerName: "Dr. Smith",
      detectedConceptIds: [],
      createdAt: timestamp,
    };

    it("persists and returns stored chunk", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: chunkId,
                  lecture_id: lectureId,
                  text: "Today we discuss neural network optimization.",
                  timestamp_sec: 12.5,
                  speaker_name: "Dr. Smith",
                  created_at: timestamp,
                },
                error: null,
              }),
            }),
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      const stored = await repo.insertChunk(validChunk);
      expect(stored).toEqual(validChunk);
    });

    it("persists and parses is_simulated: true correctly", async () => {
      let insertedPayload: unknown;
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockImplementation((payload: unknown) => {
            insertedPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: chunkId,
                    lecture_id: lectureId,
                    text: "Today we discuss neural network optimization.",
                    timestamp_sec: 12.5,
                    speaker_name: "Dr. Smith",
                    is_simulated: true,
                    created_at: timestamp,
                  },
                  error: null,
                }),
              }),
            };
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);
      const stored = await repo.insertChunk({ ...validChunk, isSimulated: true });

      expect(insertedPayload).toMatchObject({ is_simulated: true });
      expect(stored.isSimulated).toBe(true);
    });

    it("persists and parses is_simulated: false correctly", async () => {
      let insertedPayload: unknown;
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockImplementation((payload: unknown) => {
            insertedPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: chunkId,
                    lecture_id: lectureId,
                    text: "Today we discuss neural network optimization.",
                    timestamp_sec: 12.5,
                    speaker_name: "Dr. Smith",
                    is_simulated: false,
                    created_at: timestamp,
                  },
                  error: null,
                }),
              }),
            };
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);
      const stored = await repo.insertChunk({ ...validChunk, isSimulated: false });

      expect(insertedPayload).toMatchObject({ is_simulated: false });
      expect(stored.isSimulated).toBe(false);
    });

    it("persists null is_simulated and leaves isSimulated undefined for legacy rows", async () => {
      let insertedPayload: unknown;
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockImplementation((payload: unknown) => {
            insertedPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: chunkId,
                    lecture_id: lectureId,
                    text: "Today we discuss neural network optimization.",
                    timestamp_sec: 12.5,
                    speaker_name: "Dr. Smith",
                    is_simulated: null,
                    created_at: timestamp,
                  },
                  error: null,
                }),
              }),
            };
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);
      const stored = await repo.insertChunk(validChunk);

      expect(insertedPayload).toMatchObject({ is_simulated: null });
      expect(stored.isSimulated).toBeUndefined();
    });

    it("rejects invalid chunk payload with 400 VALIDATION_ERROR", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn(),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(
        repo.insertChunk({
          ...validChunk,
          text: "", // invalid: min(1) required
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    it("maps transport failure to 503 SERVICE_UNAVAILABLE", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockRejectedValue(new Error("Timeout")),
            }),
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.insertChunk(validChunk)).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("maps database error to 500 INTERNAL_SERVER_ERROR", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "foreign key constraint failed" },
              }),
            }),
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.insertChunk(validChunk)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });
  });

  describe("insertConceptLinks", () => {
    it("skips DB call when conceptIds is empty", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn(),
      };
      const repo = new TranscriptRepository(mockClient);

      await repo.insertConceptLinks(chunkId, []);
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    it("inserts links for valid concepts", async () => {
      const insertFn = vi.fn().mockResolvedValue({ error: null });
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: insertFn,
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      await repo.insertConceptLinks(chunkId, [conceptId1, conceptId2]);
      expect(mockClient.from).toHaveBeenCalledWith("transcript_concepts");
      expect(insertFn).toHaveBeenCalledWith([
        { transcript_chunk_id: chunkId, concept_id: conceptId1 },
        { transcript_chunk_id: chunkId, concept_id: conceptId2 },
      ]);
    });

    it("maps transport failure to 503 SERVICE_UNAVAILABLE", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockRejectedValue(new Error("Network drop")),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.insertConceptLinks(chunkId, [conceptId1])).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("maps database error to 500 INTERNAL_SERVER_ERROR", async () => {
      const mockClient: TranscriptDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({
            error: { message: "duplicate key value" },
          }),
        }),
      };
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.insertConceptLinks(chunkId, [conceptId1])).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });
  });

  describe("getRecentTranscriptText", () => {
    it("validates lectureId UUID format", async () => {
      const mockClient = { from: vi.fn() } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getRecentTranscriptText("invalid-uuid", 50)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    it("validates timestampSec is a finite non-negative number", async () => {
      const mockClient = { from: vi.fn() } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getRecentTranscriptText(lectureId, -5)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
      await expect(repo.getRecentTranscriptText(lectureId, Number.NaN)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
      await expect(repo.getRecentTranscriptText(lectureId, Number.POSITIVE_INFINITY)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    it("queries [Math.max(0, timestampSec - 90), timestampSec] ordered by timestamp_sec and id", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            { id: chunkId, text: "Chunk 1", timestamp_sec: 20 },
            { id: "44444444-4444-4444-8444-444444444444", text: "Chunk 2", timestamp_sec: 45 },
          ],
          error: null,
        }),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      const text = await repo.getRecentTranscriptText(lectureId, 100);
      expect(text).toBe("Chunk 1\nChunk 2");
      expect(mockClient.from).toHaveBeenCalledWith("transcript_chunks");
      expect(queryObj.eq).toHaveBeenCalledWith("lecture_id", lectureId);
      expect(queryObj.gte).toHaveBeenCalledWith("timestamp_sec", 10);
      expect(queryObj.lte).toHaveBeenCalledWith("timestamp_sec", 100);
      expect(queryObj.order).toHaveBeenCalledWith("timestamp_sec", { ascending: true });
      expect(queryObj.order).toHaveBeenCalledWith("id", { ascending: true });
      expect(queryObj.range).toHaveBeenCalledWith(0, 499);
    });

    it("clamps lower bound to 0 when timestampSec < 90", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [{ id: chunkId, text: "Early chunk", timestamp_sec: 15 }],
          error: null,
        }),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      const text = await repo.getRecentTranscriptText(lectureId, 30);
      expect(text).toBe("Early chunk");
      expect(queryObj.gte).toHaveBeenCalledWith("timestamp_sec", 0);
      expect(queryObj.lte).toHaveBeenCalledWith("timestamp_sec", 30);
    });

    it("returns empty string when no rows found", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      const text = await repo.getRecentTranscriptText(lectureId, 50);
      expect(text).toBe("");
    });

    it("pages queries beyond 500 rows until page is under 500 rows", async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        text: `Row ${i}`,
        timestamp_sec: 10 + i * 0.1,
      }));
      const page2 = [
        {
          id: "00000000-0000-4000-8000-000000000500",
          text: "Row 500",
          timestamp_sec: 65,
        },
      ];

      const rangeMock = vi
        .fn()
        .mockResolvedValueOnce({ data: page1, error: null })
        .mockResolvedValueOnce({ data: page2, error: null });

      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: rangeMock,
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      const text = await repo.getRecentTranscriptText(lectureId, 70);
      expect(rangeMock).toHaveBeenCalledTimes(2);
      expect(rangeMock).toHaveBeenNthCalledWith(1, 0, 499);
      expect(rangeMock).toHaveBeenNthCalledWith(2, 500, 999);
      expect(text.startsWith("Row 0\nRow 1")).toBe(true);
      expect(text.endsWith("Row 499\nRow 500")).toBe(true);
    });

    it("maps transport failure to 503 SERVICE_UNAVAILABLE", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockRejectedValue(new Error("Connection reset")),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getRecentTranscriptText(lectureId, 50)).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("maps database error to 500 INTERNAL_SERVER_ERROR", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: null, error: { message: "query error" } }),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getRecentTranscriptText(lectureId, 50)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });

    it("maps malformed row data to 500 INTERNAL_SERVER_ERROR", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [{ id: "not-a-uuid", text: "", timestamp_sec: -1 }],
          error: null,
        }),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getRecentTranscriptText(lectureId, 50)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });
  });

  describe("getLectureTranscript", () => {
    it("validates lectureId UUID format", async () => {
      const mockClient = { from: vi.fn() } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getLectureTranscript("invalid-uuid")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    it("fetches and paginates all lecture chunks ordered by timestamp_sec and id", async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => ({
        id: "11111111-1111-4111-8111-111111111111",
        text: `Chunk ${i}`,
        timestamp_sec: i,
      }));
      const page2 = [
        {
          id: "22222222-2222-4222-8222-222222222222",
          text: "Chunk 500",
          timestamp_sec: 500,
        },
      ];

      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi
          .fn()
          .mockResolvedValueOnce({ data: page1, error: null })
          .mockResolvedValueOnce({ data: page2, error: null }),
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      const result = await repo.getLectureTranscript(lectureId);
      expect(result).toHaveLength(501);
      expect(result[0]).toEqual({ text: "Chunk 0", timestampSec: 0 });
      expect(result[500]).toEqual({ text: "Chunk 500", timestampSec: 500 });
      expect(queryObj.range).toHaveBeenCalledTimes(2);
      expect(queryObj.range).toHaveBeenNthCalledWith(1, 0, 499);
      expect(queryObj.range).toHaveBeenNthCalledWith(2, 500, 999);
    });

    it("returns empty array when lecture has no transcript chunks", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      const result = await repo.getLectureTranscript(lectureId);
      expect(result).toEqual([]);
    });

    it("maps database transport error to 503 SERVICE_UNAVAILABLE", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockRejectedValue(new Error("Network disconnect")),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getLectureTranscript(lectureId)).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("maps database error to 500 INTERNAL_SERVER_ERROR", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getLectureTranscript(lectureId)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });

    it("maps malformed chunk row to 500 INTERNAL_SERVER_ERROR", async () => {
      const queryObj = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [{ id: "bad-id", text: "", timestamp_sec: -1 }],
          error: null,
        }),
      };
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(queryObj),
        }),
      } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);

      await expect(repo.getLectureTranscript(lectureId)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });

    it("provides getTranscriptChunks alias delegating to getLectureTranscript", async () => {
      const mockClient = { from: vi.fn() } as unknown as TranscriptDatabaseClientPort;
      const repo = new TranscriptRepository(mockClient);
      const spy = vi.spyOn(repo, "getLectureTranscript").mockResolvedValue([{ text: "test", timestampSec: 0 }]);

      const result = await repo.getTranscriptChunks(lectureId);
      expect(spy).toHaveBeenCalledWith(lectureId);
      expect(result).toEqual([{ text: "test", timestampSec: 0 }]);
    });
  });
});
