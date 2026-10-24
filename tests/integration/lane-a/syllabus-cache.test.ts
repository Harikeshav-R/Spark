import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
  SyllabusIngestionService,
  hashSyllabusPdf,
} from "../../../src/server/core/index.js";
import {
  ExtractGraphAi,
  OpenRouterClient,
} from "../../../src/server/ai/index.js";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness.js";
import { AppError } from "../../../src/contracts/errors.js";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

describe.skipIf(isFixtureMode)("P2-C-01 / Lane A: Syllabus Extraction Persistent Cache Integration", () => {
  let harness: SupabaseTestHarness;
  let context: TestContext;
  let idGenerator: CryptoIdGenerator;
  let courseRepo: CourseRepository;
  let courseService: CourseService;
  let ai: ExtractGraphAi;
  let createdFileHashes: string[];

  beforeEach(() => {
    harness = new SupabaseTestHarness();
    context = {
      users: [],
      teacherIds: [],
      courseIds: [],
    };
    idGenerator = new CryptoIdGenerator();
    courseRepo = new CourseRepository(harness.serviceClient);
    courseService = new CourseService(courseRepo, idGenerator);
    // Explicit fixture-mode AI client so no live OpenRouter key is needed
    ai = new ExtractGraphAi(
      new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } }),
    );
    createdFileHashes = [];
  });

  afterEach(async () => {
    // Delete created cache rows
    for (const hash of createdFileHashes) {
      const { error } = await harness.serviceClient
        .from("pdf_cache")
        .delete()
        .eq("file_hash", hash);
      if (error) {
        throw new Error(`Failed to delete pdf_cache row for ${hash}: ${error.message}`);
      }
    }

    // Clean up harness entities
    await harness.cleanup(context);
  });

  it("persists syllabus extraction in PostgreSQL pdf_cache and deduplicates across separate service instances", async () => {
    // Create zero-concept course with real owner
    const testCourse = await harness.createTestCourse(context, { conceptCount: 0 });
    const teacherUser = context.users.find((u) => u.authId === testCourse.teacherAuthId)!;
    const teacherActor = harness.buildTeacherActor(teacherUser, testCourse.teacherId);

    // Create non-owner teacher and student actors
    const otherTeacherUser = await harness.createTestUser(context, "teacher");
    const otherTeacherId = randomUUID();
    await harness.serviceClient.from("teachers").insert({
      id: otherTeacherId,
      auth_id: otherTeacherUser.authId,
      name: otherTeacherUser.name,
      email: otherTeacherUser.email,
    });
    context.teacherIds.push(otherTeacherId);
    const nonOwnerActor = harness.buildTeacherActor(otherTeacherUser, otherTeacherId);

    const studentUser = await harness.createTestUser(context, "student");
    const studentActor = harness.buildStudentActor(studentUser);

    // Generate unique 11-page PDF
    const uniqueMarker = randomUUID();
    const doc = await PDFDocument.create();
    for (let i = 0; i < 11; i++) {
      const page = doc.addPage([612, 792]);
      page.drawText(`Unique Syllabus: ${uniqueMarker} - Page ${i + 1}`);
    }
    const pdfBytes = Buffer.from(await doc.save());
    const expectedHash = hashSyllabusPdf(pdfBytes);
    createdFileHashes.push(expectedHash);

    // First service instance: process upload on course
    const service1 = new SyllabusIngestionService(harness.serviceClient, courseService, ai);
    const result1 = await service1.processSyllabusUpload(
      teacherActor,
      testCourse.courseId,
      pdfBytes,
      "syllabus-unique.pdf",
    );

    expect(result1.totalPages).toBe(11);
    expect(result1.processedPages).toBe(10);
    expect(result1.truncated).toBe(true);
    expect(result1.concepts).toHaveLength(33);
    expect(result1.edges).toHaveLength(34);

    // Inspect actual PostgreSQL pdf_cache row
    const { data: cacheRow, error: cacheErr } = await harness.serviceClient
      .from("pdf_cache")
      .select("file_hash, filename, result")
      .eq("file_hash", expectedHash)
      .single();

    expect(cacheErr).toBeNull();
    expect(cacheRow).toBeDefined();
    expect(cacheRow?.file_hash).toBe(expectedHash);
    expect(cacheRow?.filename).toBe("syllabus-unique.pdf");

    const parsedResult = cacheRow?.result as {
      integrationMode: string;
      extraction: {
        totalPages: number;
        processedPages: number;
        truncated: boolean;
        concepts: unknown[];
        edges: unknown[];
      };
    };
    expect(parsedResult.integrationMode).toBe("fixture");
    expect(parsedResult.extraction.totalPages).toBe(11);
    expect(parsedResult.extraction.processedPages).toBe(10);
    expect(parsedResult.extraction.truncated).toBe(true);
    expect(parsedResult.extraction.concepts).toHaveLength(33);

    // Second service instance: prove persisted deduplication across separate service instances
    const service2 = new SyllabusIngestionService(harness.serviceClient, courseService, ai);
    const result2 = await service2.processSyllabusUpload(
      teacherActor,
      testCourse.courseId,
      pdfBytes,
      "syllabus-second-upload.pdf",
    );

    expect(result2).toEqual(result1);

    // Reject non-owner even when pdf_cache entry exists
    await expect(
      service2.processSyllabusUpload(nonOwnerActor, testCourse.courseId, pdfBytes),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      return true;
    });

    await expect(
      service2.processSyllabusUpload(studentActor, testCourse.courseId, pdfBytes),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      return true;
    });

    // Invariant check: course graph remains completely untouched (zero concept nodes and zero edges)
    const { data: concepts, error: conceptsErr } = await harness.serviceClient
      .from("concept_nodes")
      .select("id")
      .eq("course_id", testCourse.courseId);
    expect(conceptsErr).toBeNull();
    expect(concepts).toHaveLength(0);

    const { data: edges, error: edgesErr } = await harness.serviceClient
      .from("concept_edges")
      .select("id")
      .eq("course_id", testCourse.courseId);
    expect(edgesErr).toBeNull();
    expect(edges).toHaveLength(0);
  });
});
