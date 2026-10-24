import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import type { Course, CourseService } from "../../../src/contracts/course.js";
import type { PrerequisiteGraphExtractionResult } from "../../../src/contracts/ai.js";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  SyllabusIngestionService,
  type SyllabusGraphExtractor,
} from "../../../src/server/core/index.js";

async function createValidPdfBytes(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792]);
  }
  return Buffer.from(await doc.save());
}

describe("P2-C-01 / Lane A: Syllabus Ingestion Service Unit Tests", () => {
  const teacherId: UUID = "22222222-2222-4222-8222-222222222222";
  const otherTeacherId: UUID = "33333333-3333-4333-8333-333333333333";
  const studentId: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const courseId: UUID = "11111111-1111-4111-8111-111111111111";

  const teacherActor: ActorContext = {
    userId: teacherId,
    authId: "auth-teacher-1",
    email: "teacher@example.com",
    name: "Dr. Andrew Ng",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const nonOwnerTeacherActor: ActorContext = {
    userId: otherTeacherId,
    authId: "auth-teacher-2",
    email: "other@example.com",
    name: "Dr. Other",
    role: "teacher",
    teacherId: otherTeacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentId,
    authId: "auth-student-1",
    email: "student@example.com",
    name: "Alice Student",
    role: "student",
    enrolledCourses: [{ studentId, courseId }],
  };

  const mockCourse: Course = {
    id: courseId,
    teacherId,
    name: "CS229 Machine Learning",
    description: "Machine Learning foundations",
    joinCode: "CS229001",
    createdAt: "2026-10-20T12:00:00.000Z",
  };

  const validExtraction: PrerequisiteGraphExtractionResult = {
    totalPages: 5,
    processedPages: 5,
    truncated: false,
    concepts: [
      {
        label: "Vectors",
        description: "Vector spaces and operations",
        category: "Linear Algebra",
        difficulty: 1,
      },
      {
        label: "Matrices",
        description: "Linear maps and transformations",
        category: "Linear Algebra",
        difficulty: 2,
      },
    ],
    edges: [["Vectors", "Matrices"]],
  };

  function createMockCourseService(courseToReturn: Course = mockCourse): Pick<CourseService, "getCourse"> {
    return {
      getCourse: vi.fn().mockResolvedValue(courseToReturn),
    };
  }

  function createMockAi(
    mode: "fixture" | "live" = "fixture",
    extraction: PrerequisiteGraphExtractionResult = validExtraction,
  ): SyllabusGraphExtractor {
    return {
      getIntegrationMode: vi.fn().mockReturnValue(mode),
      extractPrerequisiteGraph: vi.fn().mockResolvedValue(extraction),
    };
  }

  describe("1. Authorization & Parameter Validation", () => {
    it("rejects non-teacher actors with 403 FORBIDDEN without reading cache or calling AI", async () => {
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi();
      const selectFn = vi.fn();
      const mockClient = {
        from: vi.fn().mockReturnValue({ select: selectFn }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);
      const pdfBytes = await createValidPdfBytes(1);

      await expect(
        service.processSyllabusUpload(studentActor, courseId, pdfBytes),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(403);
        expect(appErr.code).toBe(DomainErrorCode.FORBIDDEN);
        expect(appErr.message).toBe("Only the owning teacher can upload a syllabus");
        return true;
      });

      expect(mockCourses.getCourse).not.toHaveBeenCalled();
      expect(mockClient.from).not.toHaveBeenCalled();
      expect(mockAi.extractPrerequisiteGraph).not.toHaveBeenCalled();
    });

    it("rejects teacher actors who do not own the course with 403 FORBIDDEN", async () => {
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi();
      const mockClient = {
        from: vi.fn(),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);
      const pdfBytes = await createValidPdfBytes(1);

      await expect(
        service.processSyllabusUpload(nonOwnerTeacherActor, courseId, pdfBytes),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(403);
        expect(appErr.code).toBe(DomainErrorCode.FORBIDDEN);
        expect(appErr.message).toBe("Only the owning teacher can upload a syllabus");
        return true;
      });

      expect(mockCourses.getCourse).toHaveBeenCalledWith(nonOwnerTeacherActor, courseId);
      expect(mockClient.from).not.toHaveBeenCalled();
      expect(mockAi.extractPrerequisiteGraph).not.toHaveBeenCalled();
    });

    it("rejects empty or excessively long filename with 400 VALIDATION_ERROR", async () => {
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi();
      const mockClient = { from: vi.fn() };
      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);
      const pdfBytes = await createValidPdfBytes(1);

      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes, ""),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.code).toBe(DomainErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toBe("Syllabus filename must contain 1 to 255 characters");
        return true;
      });

      const longFilename = "a".repeat(256);
      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes, longFilename),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.code).toBe(DomainErrorCode.VALIDATION_ERROR);
        return true;
      });
    });
  });

  describe("2. Cache Miss & Ingestion Workflow", () => {
    it("computes SHA-256 on original bytes, calls AI, upserts into pdf_cache, and returns extraction DTO", async () => {
      const pdfBytes = await createValidPdfBytes(2);
      const expectedHash = createHash("sha256").update(pdfBytes).digest("hex");

      const mockCourses = createMockCourseService();
      const mockAi = createMockAi("fixture", validExtraction);

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
      const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          expect(table).toBe("pdf_cache");
          return {
            select: selectMock,
            upsert: upsertMock,
          };
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);
      const result = await service.processSyllabusUpload(teacherActor, courseId, pdfBytes, "my-syllabus.pdf");

      expect(result).toEqual(validExtraction);
      expect(selectMock).toHaveBeenCalledWith("result");
      expect(eqMock).toHaveBeenCalledWith("file_hash", expectedHash);
      expect(mockAi.extractPrerequisiteGraph).toHaveBeenCalledWith(pdfBytes);

      expect(upsertMock).toHaveBeenCalledWith(
        {
          file_hash: expectedHash,
          filename: "my-syllabus.pdf",
          result: {
            integrationMode: "fixture",
            extraction: validExtraction,
          },
        },
        { onConflict: "file_hash", ignoreDuplicates: false },
      );
    });

    it("surfaces 500 when database fails to read pdf_cache", async () => {
      const pdfBytes = await createValidPdfBytes(1);
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi();

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "connection lost", code: "PGRST000" },
              }),
            }),
          }),
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);

      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(500);
        expect(appErr.code).toBe(DomainErrorCode.INTERNAL_SERVER_ERROR);
        expect(appErr.message).toBe("Failed to read syllabus extraction cache");
        return true;
      });

      expect(mockAi.extractPrerequisiteGraph).not.toHaveBeenCalled();
    });

    it("surfaces 500 when database fails to write pdf_cache", async () => {
      const pdfBytes = await createValidPdfBytes(1);
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi();

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({
            error: { message: "disk quota exceeded", code: "53100" },
          }),
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);

      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(500);
        expect(appErr.code).toBe(DomainErrorCode.INTERNAL_SERVER_ERROR);
        expect(appErr.message).toBe("Failed to write syllabus extraction cache");
        return true;
      });
    });

    it("does not write cache if AI extraction fails", async () => {
      const pdfBytes = await createValidPdfBytes(1);
      const mockCourses = createMockCourseService();
      const failingAi: SyllabusGraphExtractor = {
        getIntegrationMode: vi.fn().mockReturnValue("fixture"),
        extractPrerequisiteGraph: vi.fn().mockRejectedValue(
          new AppError({
            code: DomainErrorCode.BAD_GATEWAY,
            statusCode: 502,
            message: "AI provider timeout",
          }),
        ),
      };

      const upsertMock = vi.fn();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          upsert: upsertMock,
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, failingAi);

      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes),
      ).rejects.toThrow("AI provider timeout");

      expect(upsertMock).not.toHaveBeenCalled();
    });

    it("rejects extractor output with invalid page metadata (502 BAD_GATEWAY)", async () => {
      const pdfBytes = await createValidPdfBytes(1);
      const mockCourses = createMockCourseService();
      const invalidPageAi: SyllabusGraphExtractor = {
        getIntegrationMode: vi.fn().mockReturnValue("fixture"),
        extractPrerequisiteGraph: vi.fn().mockResolvedValue({
          totalPages: 10,
          processedPages: 3, // Mismatch: Math.min(10, 10) === 10
          truncated: true, // Mismatch: 10 > 10 is false
          concepts: validExtraction.concepts,
          edges: validExtraction.edges,
        }),
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, invalidPageAi);

      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("Invalid syllabus extraction page metadata");
        return true;
      });
    });
  });

  describe("3. Cache Hit & Envelope Isolation", () => {
    it("returns cached extraction on matching integration mode without invoking AI", async () => {
      const pdfBytes = await createValidPdfBytes(2);
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi("fixture");

      const cachedEnvelope = {
        integrationMode: "fixture",
        extraction: validExtraction,
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { result: cachedEnvelope },
                error: null,
              }),
            }),
          }),
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);
      const result = await service.processSyllabusUpload(teacherActor, courseId, pdfBytes);

      expect(result).toEqual(validExtraction);
      expect(mockAi.extractPrerequisiteGraph).not.toHaveBeenCalled();
    });

    it("treats cached entry from different integration mode as cache miss and updates cache", async () => {
      const pdfBytes = await createValidPdfBytes(2);
      const mockCourses = createMockCourseService();
      // Service runs in live mode, but cache contains fixture entry
      const liveAi = createMockAi("live", validExtraction);

      const cachedFixtureEnvelope = {
        integrationMode: "fixture",
        extraction: validExtraction,
      };

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { result: cachedFixtureEnvelope },
                error: null,
              }),
            }),
          }),
          upsert: upsertMock,
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, liveAi);
      const result = await service.processSyllabusUpload(teacherActor, courseId, pdfBytes);

      expect(result).toEqual(validExtraction);
      expect(liveAi.extractPrerequisiteGraph).toHaveBeenCalledTimes(1);
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          result: {
            integrationMode: "live",
            extraction: validExtraction,
          },
        }),
        expect.any(Object),
      );
    });

    it("treats legacy cache entry missing integrationMode property as cache miss", async () => {
      const pdfBytes = await createValidPdfBytes(2);
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi("fixture", validExtraction);

      const legacyEntry = {
        // Missing integrationMode property
        concepts: validExtraction.concepts,
        edges: validExtraction.edges,
      };

      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { result: legacyEntry },
                error: null,
              }),
            }),
          }),
          upsert: upsertMock,
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);
      const result = await service.processSyllabusUpload(teacherActor, courseId, pdfBytes);

      expect(result).toEqual(validExtraction);
      expect(mockAi.extractPrerequisiteGraph).toHaveBeenCalledTimes(1);
    });

    it("throws 500 when cache entry envelope has invalid JSON structure", async () => {
      const pdfBytes = await createValidPdfBytes(2);
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi("fixture");

      const corruptedEnvelope = {
        integrationMode: "fixture",
        extraction: "not an object conforming to schema",
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { result: corruptedEnvelope },
                error: null,
              }),
            }),
          }),
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);

      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(500);
        expect(appErr.code).toBe(DomainErrorCode.INTERNAL_SERVER_ERROR);
        expect(appErr.message).toBe("Invalid syllabus extraction cache entry");
        return true;
      });
    });

    it("throws 500 when cache entry has invalid page relations", async () => {
      const pdfBytes = await createValidPdfBytes(2);
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi("fixture");

      const invalidPagesEnvelope = {
        integrationMode: "fixture",
        extraction: {
          totalPages: 10,
          processedPages: 5, // invalid: should be 10
          truncated: true, // invalid: 10 > 10 is false
          concepts: validExtraction.concepts,
          edges: validExtraction.edges,
        },
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { result: invalidPagesEnvelope },
                error: null,
              }),
            }),
          }),
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);

      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(500);
        expect(appErr.code).toBe(DomainErrorCode.INTERNAL_SERVER_ERROR);
        expect(appErr.message).toBe("Invalid syllabus extraction cache entry");
        return true;
      });
    });

    it("throws 422 when cached extraction contains a cyclic graph", async () => {
      const pdfBytes = await createValidPdfBytes(2);
      const mockCourses = createMockCourseService();
      const mockAi = createMockAi("fixture");

      const cyclicCachedEnvelope = {
        integrationMode: "fixture",
        extraction: {
          totalPages: 2,
          processedPages: 2,
          truncated: false,
          concepts: [
            { label: "A", description: "Desc A min 10 chars", category: "Core", difficulty: 1 },
            { label: "B", description: "Desc B min 10 chars", category: "Core", difficulty: 2 },
          ],
          edges: [
            ["A", "B"],
            ["B", "A"],
          ],
        },
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { result: cyclicCachedEnvelope },
                error: null,
              }),
            }),
          }),
        }),
      };

      const service = new SyllabusIngestionService(mockClient, mockCourses, mockAi);

      await expect(
        service.processSyllabusUpload(teacherActor, courseId, pdfBytes),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(422);
        expect(appErr.code).toBe(DomainErrorCode.UNPROCESSABLE_ENTITY);
        expect(appErr.message).toContain("Knowledge graph contains a cycle");
        return true;
      });
    });
  });
});
