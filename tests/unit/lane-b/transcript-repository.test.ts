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
});
