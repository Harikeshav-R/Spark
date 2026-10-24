import { describe, it, expect } from "vitest";
import {
  // common
  uuidSchema,
  isoTimestampSchema,
  userRoleSchema,
  masteryBandSchema,
  actorContextSchema,
  loginResponseSchema,
  paginatedListSchema,
  // course
  courseSchema,
  studentSchema,
  conceptNodeSchema,
  conceptEdgeSchema,
  syllabusUploadPreviewResponseSchema,
  courseGraphResponseSchema,
  // mastery
  confidenceSchema,
  studentMasterySchema,
  masteryEvidenceSchema,
  masteryUpdatedEventSchema,
  classHeatmapItemSchema,
  confidenceToBand,
  applyMasteryEvidence,
  // errors
  apiErrorSchema,
  DomainErrorCode,
  AppError,
} from "../../../src/contracts/index";

describe("Lane A: Shared Contracts & Zod Domain Schemas (P0-A-03)", () => {
  describe("1. Common Schemas & Identity Context", () => {
    it("validates UUIDs according to RFC 4122 format", () => {
      const validUuid = "11111111-1111-4111-8111-111111111111";
      const invalidUuid = "not-a-valid-uuid";

      expect(uuidSchema.safeParse(validUuid).success).toBe(true);
      expect(uuidSchema.safeParse(invalidUuid).success).toBe(false);
    });

    it("validates UTC ISO-8601 timestamps", () => {
      const validIso = "2026-10-20T14:30:00.000Z";
      const invalidIso = "2026/10/20 14:30:00";

      expect(isoTimestampSchema.safeParse(validIso).success).toBe(true);
      expect(isoTimestampSchema.safeParse(invalidIso).success).toBe(false);
    });

    it("enforces allowed UserRole values", () => {
      expect(userRoleSchema.safeParse("teacher").success).toBe(true);
      expect(userRoleSchema.safeParse("student").success).toBe(true);
      expect(userRoleSchema.safeParse("admin").success).toBe(false);
    });

    it("enforces four canonical MasteryBand values", () => {
      const bands = ["gray", "red", "yellow", "green"];
      for (const band of bands) {
        expect(masteryBandSchema.safeParse(band).success).toBe(true);
      }
      expect(masteryBandSchema.safeParse("orange").success).toBe(false);
      expect(masteryBandSchema.safeParse("lime").success).toBe(false);
    });

    it("validates ActorContext structure", () => {
      const actor = {
        userId: "11111111-1111-4111-8111-111111111111",
        authId: "22222222-2222-4222-8222-222222222222",
        email: "prof.chen@example.test",
        name: "Prof. Sarah Chen",
        role: "teacher" as const,
        teacherId: "33333333-3333-4333-8333-333333333301",
        enrolledCourses: [
          {
            studentId: "44444444-4444-4444-8444-444444444401",
            courseId: "55555555-5555-4555-8555-555555555555",
          },
        ],
      };
      expect(actorContextSchema.safeParse(actor).success).toBe(true);
    });

    it("parses POST /api/auth/login response fixture from examples.md", () => {
      const fixture = {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "sarah.chen@example.test",
          name: "Prof. Sarah Chen",
          role: "teacher",
        },
        session: {
          accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic_teacher_jwt",
          refreshToken: "synthetic_refresh_token_xyz",
        },
      };
      const result = loginResponseSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it("validates PaginatedList envelope", () => {
      const schema = paginatedListSchema(courseSchema);
      const data = {
        items: [],
        nextCursor: "base64cursor==",
      };
      expect(schema.safeParse(data).success).toBe(true);
    });
  });

  describe("2. Course & Knowledge Graph Schemas", () => {
    it("validates Course model", () => {
      const course = {
        id: "22222222-2222-4222-8222-222222222222",
        teacherId: "11111111-1111-4111-8111-111111111111",
        name: "CS229: Machine Learning",
        description: "Stanford CS229 Machine Learning Course",
        joinCode: "CS229-ML",
        createdAt: "2026-10-20T14:30:00.000Z",
      };
      expect(courseSchema.safeParse(course).success).toBe(true);
    });

    it("validates Student model", () => {
      const student = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        authId: "11111111-1111-4111-8111-111111111111",
        courseId: "22222222-2222-4222-8222-222222222222",
        name: "Alex Rivera",
        email: "alex.rivera@example.test",
        createdAt: "2026-10-20T14:30:00.000Z",
      };
      expect(studentSchema.safeParse(student).success).toBe(true);
    });

    it("validates ConceptNode and ConceptEdge models", () => {
      const node = {
        id: "33333333-3333-4333-8333-333333333301",
        courseId: "22222222-2222-4222-8222-222222222222",
        label: "Vectors",
        description: "Mathematical objects with magnitude and direction",
        category: "Linear Algebra",
        difficulty: 1,
        createdAt: "2026-10-20T14:30:00.000Z",
      };
      const edge = {
        id: "44444444-4444-4444-8444-444444444401",
        courseId: "22222222-2222-4222-8222-222222222222",
        sourceId: "33333333-3333-4333-8333-333333333301",
        targetId: "33333333-3333-4333-8333-333333333302",
        relationship: "prerequisite" as const,
        createdAt: "2026-10-20T14:30:00.000Z",
      };

      expect(conceptNodeSchema.safeParse(node).success).toBe(true);
      expect(conceptEdgeSchema.safeParse(edge).success).toBe(true);
    });

    it("parses POST /api/courses/:courseId/upload (Preview Response) fixture from examples.md", () => {
      const fixture = {
        courseId: "22222222-2222-4222-8222-222222222222",
        totalPages: 11,
        processedPages: 10,
        truncated: true,
        preview: {
          concepts: [
            {
              label: "Vectors",
              description: "Mathematical objects with magnitude and direction",
              category: "Linear Algebra",
              difficulty: 1,
            },
            {
              label: "Matrices",
              description: "Rectangular arrays of numbers used for linear transformations",
              category: "Linear Algebra",
              difficulty: 2,
            },
            {
              label: "Gradient Descent",
              description: "Iterative optimization algorithm following negative gradient",
              category: "Gradient Descent",
              difficulty: 3,
            },
          ],
          edges: [
            ["Vectors", "Matrices"],
            ["Matrices", "Gradient Descent"],
          ],
        },
      };

      const result = syllabusUploadPreviewResponseSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it("parses GET /api/courses/:courseId/graph (Response) fixture from examples.md", () => {
      const fixture = {
        nodes: [
          {
            id: "33333333-3333-4333-8333-333333333301",
            label: "Vectors",
            description: "Mathematical objects with magnitude and direction",
            category: "Linear Algebra",
            difficulty: 1,
            importance: 0.5,
            confidence: 0.85,
            band: "green",
          },
          {
            id: "33333333-3333-4333-8333-333333333302",
            label: "Matrices",
            description: "Rectangular arrays of numbers used for linear transformations",
            category: "Linear Algebra",
            difficulty: 2,
            importance: 0.731,
            confidence: 0.4,
            band: "yellow",
          },
          {
            id: "33333333-3333-4333-8333-333333333317",
            label: "Gradient Descent",
            description: "Iterative optimization algorithm following negative gradient",
            category: "Gradient Descent",
            difficulty: 3,
            importance: 0.88,
            confidence: 0.2,
            band: "red",
          },
        ],
        edges: [
          {
            id: "44444444-4444-4444-8444-444444444401",
            source: "33333333-3333-4333-8333-333333333301",
            target: "33333333-3333-4333-8333-333333333302",
            relationship: "prerequisite",
          },
        ],
      };

      const result = courseGraphResponseSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    });
  });

  describe("3. Mastery & Mathematical Invariants", () => {
    it("enforces INV-M01: Confidence is a finite number in [0.0, 1.0]", () => {
      expect(confidenceSchema.safeParse(0.0).success).toBe(true);
      expect(confidenceSchema.safeParse(0.5).success).toBe(true);
      expect(confidenceSchema.safeParse(1.0).success).toBe(true);

      expect(confidenceSchema.safeParse(-0.01).success).toBe(false);
      expect(confidenceSchema.safeParse(1.01).success).toBe(false);
      expect(confidenceSchema.safeParse(NaN).success).toBe(false);
      expect(confidenceSchema.safeParse(Infinity).success).toBe(false);
      expect(confidenceSchema.safeParse(-Infinity).success).toBe(false);
    });

    it("enforces INV-M02: confidenceToBand deterministic mapping", () => {
      const inputs = [0, 0.3999, 0.4, 0.6999, 0.7, 1];
      const expected = ["gray", "red", "yellow", "yellow", "green", "green"];
      expect(inputs.map(confidenceToBand)).toEqual(expected);

      expect(confidenceToBand(0.0)).toBe("gray");
      expect(confidenceToBand(0.01)).toBe("red");
      expect(confidenceToBand(0.399)).toBe("red");
      expect(confidenceToBand(0.40)).toBe("yellow");
      expect(confidenceToBand(0.699)).toBe("yellow");
      expect(confidenceToBand(0.70)).toBe("green");
      expect(confidenceToBand(1.0)).toBe("green");

      expect(() => confidenceToBand(-0.01)).toThrow();
      expect(() => confidenceToBand(1.01)).toThrow();
      expect(() => confidenceToBand(NaN)).toThrow();
      expect(() => confidenceToBand(Infinity)).toThrow();
      expect(() => confidenceToBand(-Infinity)).toThrow();
    });

    it("validates StudentMastery schema", () => {
      const mastery = {
        id: "11111111-1111-4111-8111-111111111111",
        studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conceptId: "33333333-3333-4333-8333-333333333317",
        confidence: 0.85,
        attempts: 1,
        version: 2,
        lastUpdated: "2026-10-20T14:36:02.120Z",
      };
      expect(studentMasterySchema.safeParse(mastery).success).toBe(true);
    });

    it("validates MasteryEvidence discriminated union", () => {
      const pollEvidence = {
        type: "poll" as const,
        outcome: "correct" as const,
        sourceId: "77777777-7777-4777-8777-777777777777",
      };
      const tutorEvidence = {
        type: "tutor" as const,
        sourceId: "88888888-8888-4888-8888-888888888888",
      };
      const quizEvidence = {
        type: "quiz" as const,
        score: 0.8,
        sourceId: "99999999-9999-4999-8999-999999999999",
      };
      const attendanceEvidence = {
        type: "attendance" as const,
        sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      };

      expect(masteryEvidenceSchema.safeParse(pollEvidence).success).toBe(true);
      expect(masteryEvidenceSchema.safeParse(tutorEvidence).success).toBe(true);
      expect(masteryEvidenceSchema.safeParse(quizEvidence).success).toBe(true);
      expect(masteryEvidenceSchema.safeParse(attendanceEvidence).success).toBe(true);
    });

    it("parses mastery:updated Socket Event Payload from examples.md", () => {
      const fixture = {
        eventId: "66666666-6666-4666-8666-666666666602",
        occurredAt: "2026-10-20T14:36:02.120Z",
        studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conceptId: "33333333-3333-4333-8333-333333333317",
        confidence: 0.85,
        band: "green",
        evidenceType: "poll",
        attempts: 1,
        version: 2,
      };
      expect(masteryUpdatedEventSchema.safeParse(fixture).success).toBe(true);
    });

    it("validates ClassHeatmapItem schema", () => {
      const item = {
        conceptId: "33333333-3333-4333-8333-333333333317",
        distribution: {
          gray: 1,
          red: 2,
          yellow: 5,
          green: 12,
        },
        averageConfidence: 0.68,
      };
      expect(classHeatmapItemSchema.safeParse(item).success).toBe(true);
    });

    describe("Evidence-Driven Mutation Formulas (docs/03-invariants.md § 1.3)", () => {
      it("Poll outcome mutations", () => {
        // correct: max(c_old, 0.85)
        expect(applyMasteryEvidence(0.2, { type: "poll", outcome: "correct", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.85,
          band: "green",
        });
        expect(applyMasteryEvidence(0.9, { type: "poll", outcome: "correct", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.9,
          band: "green",
        });

        // partial: max(c_old, 0.50)
        expect(applyMasteryEvidence(0.2, { type: "poll", outcome: "partial", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.50,
          band: "yellow",
        });
        expect(applyMasteryEvidence(0.7, { type: "poll", outcome: "partial", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.7,
          band: "green",
        });

        // wrong: if c_old == 0.0 -> 0.20; if c_old > 0.0 -> min(c_old, 0.20)
        expect(applyMasteryEvidence(0.0, { type: "poll", outcome: "wrong", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.20,
          band: "red",
        });
        expect(applyMasteryEvidence(0.85, { type: "poll", outcome: "wrong", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.20,
          band: "red",
        });
        expect(applyMasteryEvidence(0.15, { type: "poll", outcome: "wrong", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.15,
          band: "red",
        });
      });

      it("Tutor turn mutations: min(c_old + 0.20, 1.0)", () => {
        expect(applyMasteryEvidence(0.3, { type: "tutor", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.50,
          band: "yellow",
        });
        expect(applyMasteryEvidence(0.9, { type: "tutor", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 1.0,
          band: "green",
        });
      });

      it("Quiz score mutations: based on score thresholds", () => {
        // score >= 0.80 -> +0.15
        expect(applyMasteryEvidence(0.40, { type: "quiz", score: 0.80, sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.55,
          band: "yellow",
        });
        // 0.60 <= score < 0.80 -> +0.10
        expect(applyMasteryEvidence(0.40, { type: "quiz", score: 0.60, sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.50,
          band: "yellow",
        });
        // 0.40 <= score < 0.60 -> +0.05
        expect(applyMasteryEvidence(0.40, { type: "quiz", score: 0.40, sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.45,
          band: "yellow",
        });
        // score < 0.40 -> +0.02
        expect(applyMasteryEvidence(0.40, { type: "quiz", score: 0.20, sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.42,
          band: "yellow",
        });
        // clamped at 1.0
        expect(applyMasteryEvidence(0.95, { type: "quiz", score: 1.0, sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 1.0,
          band: "green",
        });
      });

      it("Attendance exposure mutations: min(c_old + 0.05, 0.30) if c < 0.30, else unchanged", () => {
        expect(applyMasteryEvidence(0.10, { type: "attendance", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.15,
          band: "red",
        });
        expect(applyMasteryEvidence(0.28, { type: "attendance", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.30,
          band: "red",
        });
        expect(applyMasteryEvidence(0.50, { type: "attendance", sourceId: "11111111-1111-4111-8111-111111111111" })).toEqual({
          confidence: 0.50,
          band: "yellow",
        });
      });

      it("rejects invalid current confidence or invalid evidence with ZodError", () => {
        const validPoll = {
          type: "poll" as const,
          outcome: "correct" as const,
          sourceId: "11111111-1111-4111-8111-111111111111",
        };
        expect(() => applyMasteryEvidence(-0.01, validPoll)).toThrow();
        expect(() => applyMasteryEvidence(1.01, validPoll)).toThrow();
        expect(() => applyMasteryEvidence(NaN, validPoll)).toThrow();
        expect(() =>
          applyMasteryEvidence(0.5, {
            type: "quiz",
            score: -0.1,
            sourceId: "11111111-1111-4111-8111-111111111111",
          }),
        ).toThrow();
        expect(() =>
          applyMasteryEvidence(0.5, {
            type: "quiz",
            score: 1.1,
            sourceId: "11111111-1111-4111-8111-111111111111",
          }),
        ).toThrow();
        expect(() =>
          applyMasteryEvidence(0.5, {
            type: "invalid" as unknown as "poll",
            sourceId: "11111111-1111-4111-8111-111111111111",
          } as unknown as Parameters<typeof applyMasteryEvidence>[1]),
        ).toThrow();
      });
    });
  });

  describe("4. Error Envelopes & Domain Error Codes", () => {
    it("validates ApiError envelope (docs/06-http-api.md § 1.2)", () => {
      const errorObj = {
        error: {
          code: DomainErrorCode.UNAUTHORIZED,
          message: "Bearer token missing, expired, or invalid.",
          requestId: "11111111-1111-4111-8111-111111111111",
        },
      };
      expect(apiErrorSchema.safeParse(errorObj).success).toBe(true);
    });

    it("instantiates AppError and formats standard API error payload", () => {
      const appError = new AppError({
        code: DomainErrorCode.NOT_FOUND,
        message: "Course not found",
        statusCode: 404,
        requestId: "22222222-2222-4222-8222-222222222222",
      });

      expect(appError.code).toBe("NOT_FOUND");
      expect(appError.statusCode).toBe(404);
      expect(appError.requestId).toBe("22222222-2222-4222-8222-222222222222");
      expect(appError.toResponse()).toEqual({
        error: {
          code: "NOT_FOUND",
          message: "Course not found",
          requestId: "22222222-2222-4222-8222-222222222222",
        },
      });
    });
  });
});
