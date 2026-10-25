import { describe, it, expect, vi } from "vitest";
import { MasteryService } from "../../../src/server/core/mastery/mastery-service";
import type { MasteryRepository } from "../../../src/server/core/mastery/mastery-repository";
import type {
  ActorContext,
  MasteryEvidence,
  StudentMastery,
  UUID,
} from "../../../src/contracts";

describe("MasteryService", () => {
  const studentId: UUID = "00000000-0000-4000-8000-000000000001";
  const courseId: UUID = "00000000-0000-4000-8000-000000000010";
  const conceptId: UUID = "00000000-0000-4000-8000-000000000100";

  const studentActor: ActorContext = {
    userId: "00000000-0000-4000-8000-00000000000a",
    authId: "00000000-0000-4000-8000-00000000000a",
    email: "student@example.com",
    name: "Student A",
    role: "student",
    enrolledCourses: [{ studentId, courseId }],
  };

  const otherStudentActor: ActorContext = {
    userId: "00000000-0000-4000-8000-00000000000b",
    authId: "00000000-0000-4000-8000-00000000000b",
    email: "student-b@example.com",
    name: "Student B",
    role: "student",
    enrolledCourses: [
      {
        studentId: "00000000-0000-4000-8000-000000000002",
        courseId,
      },
    ],
  };

  const teacherActor: ActorContext = {
    userId: "00000000-0000-4000-8000-00000000000c",
    authId: "00000000-0000-4000-8000-00000000000c",
    email: "teacher@example.com",
    name: "Prof C",
    role: "teacher",
    teacherId: "00000000-0000-4000-8000-000000000030",
    enrolledCourses: [],
  };

  const validPollEvidence: MasteryEvidence = {
    type: "poll",
    outcome: "correct",
    sourceId: "00000000-0000-4000-8000-000000000099",
  };

  describe("getMastery", () => {
    it("rejects student actor querying another student's mastery with 403 FORBIDDEN", async () => {
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn(),
        initializeStudentMastery: vi.fn(),
      };
      const service = new MasteryService(mockRepo);

      await expect(
        service.getMastery(otherStudentActor, studentId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      expect(mockRepo.getMastery).not.toHaveBeenCalled();
    });

    it("rejects invalid student UUID with 400 VALIDATION_ERROR", async () => {
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn(),
        initializeStudentMastery: vi.fn(),
      };
      const service = new MasteryService(mockRepo);

      await expect(
        service.getMastery(teacherActor, "not-a-uuid"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      expect(mockRepo.getMastery).not.toHaveBeenCalled();
    });

    it("allows target student actor and delegates to repository", async () => {
      const expectedMastery: StudentMastery[] = [
        {
          id: "00000000-0000-4000-8000-000000000050",
          studentId,
          conceptId,
          confidence: 0.85,
          attempts: 1,
          version: 2,
          lastUpdated: "2026-10-21T00:00:00.000Z",
        },
      ];
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn().mockResolvedValue(expectedMastery),
        applyEvidence: vi.fn(),
        initializeStudentMastery: vi.fn(),
      };
      const service = new MasteryService(mockRepo);

      const result = await service.getMastery(studentActor, studentId);
      expect(result).toEqual(expectedMastery);
      expect(mockRepo.getMastery).toHaveBeenCalledWith(studentActor, studentId);
    });

    it("allows teacher actor and delegates to repository", async () => {
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn().mockResolvedValue([]),
        applyEvidence: vi.fn(),
        initializeStudentMastery: vi.fn(),
      };
      const service = new MasteryService(mockRepo);

      const result = await service.getMastery(teacherActor, studentId);
      expect(result).toEqual([]);
      expect(mockRepo.getMastery).toHaveBeenCalledWith(teacherActor, studentId);
    });
  });

  describe("applyEvidence", () => {
    it("rejects student actor applying evidence to another student with 403 FORBIDDEN", async () => {
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn(),
        initializeStudentMastery: vi.fn(),
      };
      const service = new MasteryService(mockRepo);

      await expect(
        service.applyEvidence(otherStudentActor, studentId, conceptId, validPollEvidence),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      expect(mockRepo.applyEvidence).not.toHaveBeenCalled();
    });

    it.each([
      ["invalid studentId", "not-a-uuid", conceptId, validPollEvidence],
      ["invalid conceptId", studentId, "not-a-uuid", validPollEvidence],
      [
        "invalid evidence type",
        studentId,
        conceptId,
        { type: "unsupported" as unknown as "poll", sourceId: "00000000-0000-4000-8000-000000000099" } as unknown as MasteryEvidence,
      ],
      [
        "invalid quiz score > 1.0",
        studentId,
        conceptId,
        { type: "quiz" as const, score: 1.5, sourceId: "00000000-0000-4000-8000-000000000099" },
      ],
      [
        "invalid quiz score < 0.0",
        studentId,
        conceptId,
        { type: "quiz" as const, score: -0.1, sourceId: "00000000-0000-4000-8000-000000000099" },
      ],
      [
        "invalid poll outcome",
        studentId,
        conceptId,
        { type: "poll" as const, outcome: "invalid" as unknown as "correct", sourceId: "00000000-0000-4000-8000-000000000099" },
      ],
    ])("rejects %s with 400 VALIDATION_ERROR without repo call", async (_, sId, cId, ev) => {
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn(),
        initializeStudentMastery: vi.fn(),
      };
      const service = new MasteryService(mockRepo);

      await expect(
        service.applyEvidence(studentActor, sId, cId, ev as unknown as MasteryEvidence),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      expect(mockRepo.applyEvidence).not.toHaveBeenCalled();
    });

    it("delegates valid applyEvidence to repository", async () => {
      const expectedResult = {
        confidence: 0.85,
        band: "green" as const,
        attempts: 1,
        version: 2,
      };
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn().mockResolvedValue(expectedResult),
        initializeStudentMastery: vi.fn(),
      };
      const service = new MasteryService(mockRepo);

      const result = await service.applyEvidence(studentActor, studentId, conceptId, validPollEvidence);
      expect(result).toEqual(expectedResult);
      expect(mockRepo.applyEvidence).toHaveBeenCalledWith(studentActor, studentId, conceptId, validPollEvidence);
    });

    it("invokes onEvidenceApplied observer after successful repository persistence", async () => {
      const expectedResult = {
        confidence: 0.85,
        band: "green" as const,
        attempts: 1,
        version: 2,
      };
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn().mockResolvedValue(expectedResult),
        initializeStudentMastery: vi.fn(),
      };
      const mockObserver = vi.fn().mockResolvedValue(undefined);
      const service = new MasteryService(mockRepo, mockObserver);

      const result = await service.applyEvidence(studentActor, studentId, conceptId, validPollEvidence);
      expect(result).toEqual(expectedResult);
      expect(mockObserver).toHaveBeenCalledWith(studentActor, studentId, conceptId);
    });

    it("does not invoke observer if repository persistence fails", async () => {
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn().mockRejectedValue(new Error("RPC failed")),
        initializeStudentMastery: vi.fn(),
      };
      const mockObserver = vi.fn();
      const service = new MasteryService(mockRepo, mockObserver);

      await expect(service.applyEvidence(studentActor, studentId, conceptId, validPollEvidence)).rejects.toThrow("RPC failed");
      expect(mockObserver).not.toHaveBeenCalled();
    });

    it("returns committed evidence result even if observer throws an error", async () => {
      const expectedResult = {
        confidence: 0.85,
        band: "green" as const,
        attempts: 1,
        version: 2,
      };
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn().mockResolvedValue(expectedResult),
        initializeStudentMastery: vi.fn(),
      };
      const mockObserver = vi.fn().mockRejectedValue(new Error("Observer network error"));
      const service = new MasteryService(mockRepo, mockObserver);

      const result = await service.applyEvidence(studentActor, studentId, conceptId, validPollEvidence);
      expect(result).toEqual(expectedResult);
    });
  });

  describe("initializeStudentMastery", () => {
    it.each([
      ["invalid studentId", "not-a-uuid", courseId],
      ["invalid courseId", studentId, "not-a-uuid"],
    ])("rejects %s with 400 VALIDATION_ERROR without repo call", async (_, sId, cId) => {
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn(),
        initializeStudentMastery: vi.fn(),
      };
      const service = new MasteryService(mockRepo);

      await expect(
        service.initializeStudentMastery(sId, cId),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      expect(mockRepo.initializeStudentMastery).not.toHaveBeenCalled();
    });

    it("delegates valid initializeStudentMastery to repository", async () => {
      const mockRepo: Pick<MasteryRepository, "getMastery" | "applyEvidence" | "initializeStudentMastery"> = {
        getMastery: vi.fn(),
        applyEvidence: vi.fn(),
        initializeStudentMastery: vi.fn().mockResolvedValue(33),
      };
      const service = new MasteryService(mockRepo);

      const count = await service.initializeStudentMastery(studentId, courseId);
      expect(count).toBe(33);
      expect(mockRepo.initializeStudentMastery).toHaveBeenCalledWith(studentId, courseId);
    });
  });
});
