import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext, Clock, UUID } from "../../../src/contracts/common.js";
import type { Course, CourseService } from "../../../src/contracts/course.js";
import { AppError } from "../../../src/contracts/errors.js";
import { HeatmapService, type CourseHeatmapSnapshot } from "../../../src/server/core/mastery/heatmap-service.js";

interface ConceptNodeRow {
  id: string;
  course_id: string;
  label: string;
  category: string;
}

interface StudentRow {
  id: string;
  auth_id: string;
  course_id: string;
}

interface MasteryRow {
  id: string;
  student_id: string;
  concept_id: string;
  confidence: number;
  concept: { course_id: string };
  student: { course_id: string };
}

interface LectureRow {
  id: string;
  course_id: string;
  status: "live" | "completed";
}

interface FakeDbStore {
  conceptNodes: ConceptNodeRow[];
  students: StudentRow[];
  mastery: MasteryRow[];
  lectures: LectureRow[];
  forcedError?: {
    table?: string;
    error: { code: string; message: string };
  };
}

class FakeClock implements Clock {
  constructor(private currentTimeMs: number = 1700000000000) {}

  now(): Date {
    return new Date(this.currentTimeMs);
  }

  nowISO(): string {
    return new Date(this.currentTimeMs).toISOString();
  }

  advance(ms: number): void {
    this.currentTimeMs += ms;
  }

  set(ms: number): void {
    this.currentTimeMs = ms;
  }
}

interface QueryFilter {
  col: string;
  val: unknown;
}

interface QueryResult<T> {
  data: T | null;
  count?: number | null;
  error: { code: string; message: string } | null;
}

interface FakeQueryBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(fields?: string, options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): FakeQueryBuilder<T>;
  eq(col: string, val: unknown): FakeQueryBuilder<T>;
  order(col: string, opts?: { ascending?: boolean }): FakeQueryBuilder<T>;
  range(from: number, to: number): FakeQueryBuilder<T>;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { code: string; message: string } | null }>;
}

function createFakeSupabaseClient(store: FakeDbStore): Pick<SupabaseClient, "from"> {
  return {
    from: (table: string) => {
      let selectOptions: { count?: "exact" | "planned" | "estimated"; head?: boolean } | undefined;
      const filters: QueryFilter[] = [];
      let orderBy: string | undefined;
      let orderAsc: boolean = true;
      let rangeFrom: number | undefined;
      let rangeTo: number | undefined;

      const executeQuery = (): QueryResult<unknown> => {
        if (store.forcedError && (!store.forcedError.table || store.forcedError.table === table)) {
          return { data: null, count: null, error: store.forcedError.error };
        }

        if (table === "concept_nodes") {
          let rows = [...store.conceptNodes];
          for (const f of filters) {
            rows = rows.filter((r) => {
              if (f.col === "course_id") return r.course_id === f.val;
              return true;
            });
          }
          if (orderBy === "id") {
            rows.sort((a, b) => (a.id > b.id ? (orderAsc ? 1 : -1) : (orderAsc ? -1 : 1)));
          }
          return {
            data: rows.map((r) => ({ id: r.id, label: r.label, category: r.category })),
            error: null,
          };
        }

        if (table === "students") {
          let rows = [...store.students];
          for (const f of filters) {
            rows = rows.filter((r) => {
              if (f.col === "course_id") return r.course_id === f.val;
              if (f.col === "id") return r.id === f.val;
              if (f.col === "auth_id") return r.auth_id === f.val;
              return true;
            });
          }
          if (selectOptions?.head) {
            return { data: null, count: rows.length, error: null };
          }
          return { data: rows, count: rows.length, error: null };
        }

        if (table === "student_mastery") {
          let rows = [...store.mastery];
          for (const f of filters) {
            if (f.col === "concept.course_id") {
              rows = rows.filter((r) => r.concept.course_id === f.val);
            } else if (f.col === "student.course_id") {
              rows = rows.filter((r) => r.student.course_id === f.val);
            }
          }
          if (orderBy === "id") {
            rows.sort((a, b) => (a.id > b.id ? (orderAsc ? 1 : -1) : (orderAsc ? -1 : 1)));
          }
          if (rangeFrom !== undefined && rangeTo !== undefined) {
            rows = rows.slice(rangeFrom, rangeTo + 1);
          }
          return { data: rows, error: null };
        }

        if (table === "lecture_sessions") {
          let rows = [...store.lectures];
          for (const f of filters) {
            if (f.col === "course_id") {
              rows = rows.filter((r) => r.course_id === f.val);
            } else if (f.col === "status") {
              rows = rows.filter((r) => r.status === f.val);
            }
          }
          if (orderBy === "id") {
            rows.sort((a, b) => (a.id > b.id ? (orderAsc ? 1 : -1) : (orderAsc ? -1 : 1)));
          }
          if (rangeFrom !== undefined && rangeTo !== undefined) {
            rows = rows.slice(rangeFrom, rangeTo + 1);
          }
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }

        return { data: [], error: null };
      };

      const builder: FakeQueryBuilder<unknown> = {
        select: (_fields?: string, options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) => {
          selectOptions = options;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return builder;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderBy = col;
          orderAsc = opts?.ascending ?? true;
          return builder;
        },
        range: (from: number, to: number) => {
          rangeFrom = from;
          rangeTo = to;
          return builder;
        },
        maybeSingle: async () => {
          if (store.forcedError && (!store.forcedError.table || store.forcedError.table === table)) {
            return { data: null, error: store.forcedError.error };
          }
          if (table === "students") {
            let matches = [...store.students];
            for (const f of filters) {
              if (f.col === "id") matches = matches.filter((r) => r.id === f.val);
              if (f.col === "auth_id") matches = matches.filter((r) => r.auth_id === f.val);
            }
            const match = matches[0] ?? null;
            return {
              data: match ? { id: match.id, course_id: match.course_id } : null,
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: <TResult1 = QueryResult<unknown>, TResult2 = never>(
          onfulfilled?: ((value: QueryResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ): Promise<TResult1 | TResult2> => {
          try {
            const res = executeQuery();
            return Promise.resolve(onfulfilled ? onfulfilled(res) : (res as unknown as TResult1));
          } catch (err) {
            return onrejected ? Promise.resolve(onrejected(err)) : Promise.reject(err);
          }
        },
      };

      return builder as unknown as ReturnType<Pick<SupabaseClient, "from">["from"]>;
    },
  };
}

interface PublisherMock {
  emitToTeacher: (lectureId: UUID, event: string, payload: unknown) => Promise<void>;
  calls: Array<{ lectureId: UUID; event: string; payload: unknown }>;
}

interface IdGeneratorMock {
  generateId: () => UUID;
}

describe("HeatmapService", () => {
  const teacherId: UUID = "00000000-0000-4000-8000-000000000030";
  const otherTeacherId: UUID = "00000000-0000-4000-8000-000000000031";
  const courseId: UUID = "00000000-0000-4000-8000-000000000010";
  const foreignCourseId: UUID = "00000000-0000-4000-8000-000000000099";

  const concept1Id: UUID = "00000000-0000-4000-8000-000000000101";
  const concept2Id: UUID = "00000000-0000-4000-8000-000000000102";
  const foreignConceptId: UUID = "00000000-0000-4000-8000-000000000199";

  const student1Id: UUID = "00000000-0000-4000-8000-000000000001";
  const studentAuth1: UUID = "00000000-0000-4000-8000-0000000000a1";

  const teacherActor: ActorContext = {
    userId: "00000000-0000-4000-8000-00000000000c",
    authId: "00000000-0000-4000-8000-00000000000c",
    email: "teacher@example.com",
    name: "Prof C",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const otherTeacherActor: ActorContext = {
    userId: "00000000-0000-4000-8000-00000000000d",
    authId: "00000000-0000-4000-8000-00000000000d",
    email: "teacher2@example.com",
    name: "Prof D",
    role: "teacher",
    teacherId: otherTeacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentAuth1,
    authId: studentAuth1,
    email: "student@example.com",
    name: "Student 1",
    role: "student",
    enrolledCourses: [{ studentId: student1Id, courseId }],
  };

  let store: FakeDbStore;
  let fakeClock: FakeClock;
  let mockPublisher: PublisherMock;
  let mockIdGenerator: IdGeneratorMock;
  let mockCourseService: Pick<CourseService, "getCourse">;
  let service: HeatmapService;

  beforeEach(() => {
    store = {
      conceptNodes: [
        { id: concept1Id, course_id: courseId, label: "Variables", category: "Basics" },
        { id: concept2Id, course_id: courseId, label: "Loops", category: "Control Flow" },
        { id: foreignConceptId, course_id: foreignCourseId, label: "Quantum", category: "Physics" },
      ],
      students: [],
      mastery: [],
      lectures: [],
    };

    fakeClock = new FakeClock(1700000000000);
    const publisherCalls: Array<{ lectureId: UUID; event: string; payload: unknown }> = [];
    mockPublisher = {
      calls: publisherCalls,
      emitToTeacher: vi.fn(async (lectureId: UUID, event: string, payload: unknown): Promise<void> => {
        publisherCalls.push({ lectureId, event, payload });
      }),
    };
    mockIdGenerator = {
      generateId: vi.fn((): UUID => "00000000-0000-4000-8000-000000000777"),
    };

    mockCourseService = {
      getCourse: vi.fn(async (_actor: ActorContext, targetCourseId: string): Promise<Course> => {
        if (targetCourseId === courseId) {
          return {
            id: courseId,
            teacherId,
            name: "CS 101",
            createdAt: "2026-10-20T00:00:00.000Z",
            joinCode: "CS101ABC",
          };
        }
        if (targetCourseId === foreignCourseId) {
          return {
            id: foreignCourseId,
            teacherId: otherTeacherId,
            name: "PHYS 201",
            createdAt: "2026-10-20T00:00:00.000Z",
            joinCode: "PHYS201A",
          };
        }
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Course not found",
        });
      }),
    };

    service = new HeatmapService({
      client: createFakeSupabaseClient(store),
      courses: mockCourseService,
      publisher: mockPublisher,
      clock: fakeClock,
      ids: mockIdGenerator,
    });
  });

  describe("Authorization", () => {
    it("rejects non-teacher actors with 403 FORBIDDEN", async () => {
      await expect(service.getClassHeatmap(studentActor, courseId)).rejects.toThrow(AppError);
      await expect(service.getClassHeatmap(studentActor, courseId)).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only the owning teacher can view course heatmaps",
      });
    });

    it("rejects non-owning teacher with 403 FORBIDDEN", async () => {
      await expect(service.getClassHeatmap(otherTeacherActor, courseId)).rejects.toThrow(AppError);
      await expect(service.getClassHeatmap(otherTeacherActor, courseId)).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("rejects invalid courseId UUID format with 400 VALIDATION_ERROR", async () => {
      await expect(service.getClassHeatmap(teacherActor, "not-a-uuid" as UUID)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("propagates 404 NOT_FOUND if course does not exist", async () => {
      const nonExistent: UUID = "00000000-0000-4000-8000-000000000404";
      await expect(service.getClassHeatmap(teacherActor, nonExistent)).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });
  });

  describe("Distribution and Mean Aggregations", () => {
    it("aggregates exact band distribution and mean for confidence boundary values and unassessed concepts", async () => {
      const confidences = [0, 0.01, 0.3999, 0.4, 0.6999, 0.7, 1];
      for (let i = 0; i < 7; i++) {
        const sId = `00000000-0000-4000-8000-00000000000${i + 1}`;
        store.students.push({
          id: sId,
          auth_id: `00000000-0000-4000-8000-0000000000a${i + 1}`,
          course_id: courseId,
        });
        store.mastery.push({
          id: `00000000-0000-4000-8000-000000000e0${i + 1}`,
          student_id: sId,
          concept_id: concept1Id,
          confidence: confidences[i]!,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        });
      }

      store.mastery.push({
        id: "00000000-0000-4000-8000-000000000e99",
        student_id: "00000000-0000-4000-8000-000000000099",
        concept_id: foreignConceptId,
        confidence: 0.99,
        concept: { course_id: foreignCourseId },
        student: { course_id: foreignCourseId },
      });

      const snapshot: CourseHeatmapSnapshot = await service.getCourseSnapshot(teacherActor, courseId);
      expect(snapshot.courseId).toBe(courseId);
      expect(snapshot.totalStudents).toBe(7);
      expect(snapshot.concepts).toHaveLength(2);

      const c1 = snapshot.concepts.find((c: { conceptId: string }) => c.conceptId === concept1Id)!;
      expect(c1.label).toBe("Variables");
      expect(c1.category).toBe("Basics");
      expect(c1.distribution).toEqual({
        gray: 1,
        red: 2,
        yellow: 2,
        green: 2,
      });
      const expectedSum = 0 + 0.01 + 0.3999 + 0.4 + 0.6999 + 0.7 + 1;
      expect(c1.averageConfidence).toBeCloseTo(expectedSum / 7, 6);

      const c2 = snapshot.concepts.find((c: { conceptId: string }) => c.conceptId === concept2Id)!;
      expect(c2.label).toBe("Loops");
      expect(c2.category).toBe("Control Flow");
      expect(c2.distribution).toEqual({
        gray: 7,
        red: 0,
        yellow: 0,
        green: 0,
      });
      expect(c2.averageConfidence).toBe(0);

      const projected = await service.getClassHeatmap(teacherActor, courseId);
      expect(projected).toHaveLength(2);
      expect(projected[0]).toEqual({
        conceptId: concept1Id,
        distribution: { gray: 1, red: 2, yellow: 2, green: 2 },
        averageConfidence: c1.averageConfidence,
      });
    });

    it("returns zero counts and mean 0 when course has concepts but 0 students", async () => {
      store.students = [];
      const snapshot = await service.getCourseSnapshot(teacherActor, courseId);
      expect(snapshot.totalStudents).toBe(0);
      expect(snapshot.concepts).toHaveLength(2);
      expect(snapshot.concepts[0]!.distribution).toEqual({ gray: 0, red: 0, yellow: 0, green: 0 });
      expect(snapshot.concepts[0]!.averageConfidence).toBe(0);
      expect(snapshot.concepts[1]!.distribution).toEqual({ gray: 0, red: 0, yellow: 0, green: 0 });
      expect(snapshot.concepts[1]!.averageConfidence).toBe(0);
    });

    it("returns empty concepts array and retains student roster count when course has 0 concepts", async () => {
      store.conceptNodes = [];
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      const snapshot = await service.getCourseSnapshot(teacherActor, courseId);
      expect(snapshot.totalStudents).toBe(1);
      expect(snapshot.concepts).toEqual([]);
    });

    it("correctly paginates beyond 500 and 1000 mastery rows without truncation", async () => {
      const count = 1200;
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const hex = i.toString(16).padStart(8, "0");
        const sId = `00000000-0000-4000-8000-${hex}0001`;
        store.students.push({
          id: sId,
          auth_id: `00000000-0000-4000-8000-${hex}0002`,
          course_id: courseId,
        });
        const conf = i % 2 === 0 ? 0.2 : 0.8;
        sum += conf;
        store.mastery.push({
          id: `00000000-0000-4000-8000-${hex}0003`,
          student_id: sId,
          concept_id: concept1Id,
          confidence: conf,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        });
      }

      const snapshot = await service.getCourseSnapshot(teacherActor, courseId);
      expect(snapshot.totalStudents).toBe(count);
      const c1 = snapshot.concepts.find((c: { conceptId: string }) => c.conceptId === concept1Id)!;
      expect(c1.distribution).toEqual({
        gray: 0,
        red: 600,
        yellow: 0,
        green: 600,
      });
      expect(c1.averageConfidence).toBeCloseTo(sum / count, 6);
    });

    it("throws 500 INTERNAL_SERVER_ERROR if database returns corrupted data (more rows than students)", async () => {
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      store.mastery = [
        {
          id: "00000000-0000-4000-8000-000000000001",
          student_id: student1Id,
          concept_id: concept1Id,
          confidence: 0.5,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          student_id: student1Id,
          concept_id: concept1Id,
          confidence: 0.8,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
      ];

      await expect(service.getCourseSnapshot(teacherActor, courseId)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid course heatmap data",
      });
    });

    it("throws 500 INTERNAL_SERVER_ERROR if mastery row references an unknown concept", async () => {
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      store.mastery = [
        {
          id: "00000000-0000-4000-8000-000000000001",
          student_id: student1Id,
          concept_id: "00000000-0000-4000-8000-000000000666",
          confidence: 0.5,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
      ];

      await expect(service.getCourseSnapshot(teacherActor, courseId)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid course heatmap data",
      });
    });

    it("maps database transport errors to 503 SERVICE_UNAVAILABLE", async () => {
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      store.forcedError = {
        table: "student_mastery",
        error: { code: "PGRST001", message: "Connection failed" },
      };
      await expect(service.getCourseSnapshot(teacherActor, courseId)).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to load course heatmap",
      });
    });
  });

  describe("Caching and Invalidation", () => {
    it("serves cached result within 5000ms and reloads after TTL expiry", async () => {
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      store.mastery = [
        {
          id: "00000000-0000-4000-8000-000000000001",
          student_id: student1Id,
          concept_id: concept1Id,
          confidence: 0.5,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
      ];

      const read1 = await service.getCourseSnapshot(teacherActor, courseId);
      expect(read1.concepts[0]!.distribution.yellow).toBe(1);

      store.mastery[0]!.confidence = 0.9;

      fakeClock.advance(4999);
      const read2 = await service.getCourseSnapshot(teacherActor, courseId);
      expect(read2.concepts[0]!.distribution.yellow).toBe(1);

      fakeClock.advance(1);
      const read3 = await service.getCourseSnapshot(teacherActor, courseId);
      expect(read3.concepts[0]!.distribution.green).toBe(1);
      expect(read3.concepts[0]!.distribution.yellow).toBe(0);
    });

    it("mutating returned distribution does not corrupt cache", async () => {
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      store.mastery = [
        {
          id: "00000000-0000-4000-8000-000000000001",
          student_id: student1Id,
          concept_id: concept1Id,
          confidence: 0.5,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
      ];

      const read1 = await service.getCourseSnapshot(teacherActor, courseId);
      read1.concepts[0]!.distribution.yellow = 999;

      const read2 = await service.getCourseSnapshot(teacherActor, courseId);
      expect(read2.concepts[0]!.distribution.yellow).toBe(1);
    });

    it("does not bypass authorization on cached hits", async () => {
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      await service.getCourseSnapshot(teacherActor, courseId);

      await expect(service.getCourseSnapshot(studentActor, courseId)).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      await expect(service.getCourseSnapshot(otherTeacherActor, courseId)).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });
  });

  describe("Realtime Observer and Broadcasts (afterEvidenceApplied)", () => {
    it("invalidates cache and emits heatmap:updated event to live lecture professors", async () => {
      const lectureId: UUID = "00000000-0000-4000-8000-000000000050";
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      store.lectures = [
        { id: lectureId, course_id: courseId, status: "live" },
        { id: "00000000-0000-4000-8000-000000000051", course_id: courseId, status: "completed" },
        { id: "00000000-0000-4000-8000-000000000052", course_id: foreignCourseId, status: "live" },
      ];
      store.mastery = [
        {
          id: "00000000-0000-4000-8000-000000000001",
          student_id: student1Id,
          concept_id: concept1Id,
          confidence: 0.85,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
      ];

      await service.getCourseSnapshot(teacherActor, courseId);
      await service.afterEvidenceApplied(studentActor, student1Id, concept1Id);

      expect(mockPublisher.calls).toHaveLength(1);
      expect(mockPublisher.calls[0]!).toEqual({
        lectureId,
        event: "heatmap:updated",
        payload: {
          eventId: "00000000-0000-4000-8000-000000000777",
          occurredAt: fakeClock.nowISO(),
          courseId,
          totalStudents: 1,
          conceptId: concept1Id,
          distribution: { gray: 0, red: 0, yellow: 0, green: 1 },
          averageConfidence: 0.85,
        },
      });
    });

    it("does not emit event if there are no live lectures for course", async () => {
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      store.lectures = [
        { id: "00000000-0000-4000-8000-000000000051", course_id: courseId, status: "completed" },
      ];
      store.mastery = [
        {
          id: "00000000-0000-4000-8000-000000000001",
          student_id: student1Id,
          concept_id: concept1Id,
          confidence: 0.85,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
      ];

      await service.afterEvidenceApplied(studentActor, student1Id, concept1Id);
      expect(mockPublisher.calls).toHaveLength(0);
    });

    it("serializes concurrent afterEvidenceApplied calls for the same course", async () => {
      const lectureId: UUID = "00000000-0000-4000-8000-000000000050";
      store.students = [
        { id: student1Id, auth_id: studentAuth1, course_id: courseId },
      ];
      store.lectures = [
        { id: lectureId, course_id: courseId, status: "live" },
      ];
      store.mastery = [
        {
          id: "00000000-0000-4000-8000-000000000001",
          student_id: student1Id,
          concept_id: concept1Id,
          confidence: 0.1,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
      ];

      const call1 = service.afterEvidenceApplied(studentActor, student1Id, concept1Id);
      store.mastery[0]!.confidence = 0.9;
      const call2 = service.afterEvidenceApplied(studentActor, student1Id, concept1Id);

      await Promise.all([call1, call2]);
      expect(mockPublisher.calls).toHaveLength(2);
      const secondCallPayload = mockPublisher.calls[1]!.payload as { distribution: { green: number } };
      expect(secondCallPayload.distribution.green).toBe(1);
    });
  });
});
