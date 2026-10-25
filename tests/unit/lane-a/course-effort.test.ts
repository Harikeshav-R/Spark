import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../../src/contracts/common.js";
import type { CourseService } from "../../../src/contracts/course.js";
import { courseEffortSchema } from "../../../src/contracts/game.js";
import { AppError } from "../../../src/contracts/errors.js";
import { HeatmapService } from "../../../src/server/core/mastery/heatmap-service.js";
import {
  CourseEffortService,
  type ClassSkySnapshot,
} from "../../../src/server/core/game/course-effort-service.js";

interface ConceptNodeRow {
  id: UUID;
  course_id: UUID;
  label: string;
  category: string;
}

interface StudentRow {
  id: UUID;
  course_id: UUID;
  name: string;
  auth_id?: UUID;
}

interface XpEventRow {
  id: UUID;
  student_id: UUID;
  amount: number;
  student: { course_id: UUID };
}

interface MasteryRow {
  id: UUID;
  student_id: UUID;
  concept_id: UUID;
  confidence: number;
  concept: { course_id: UUID };
  student: { course_id: UUID };
}

interface LectureSessionRow {
  id: UUID;
  course_id: UUID;
  status: string;
}

interface TranscriptChunkRow {
  id: UUID;
  lecture_id: UUID;
  lecture: { course_id: UUID };
  transcript_concepts: Array<{ concept_id: UUID }>;
}

interface FakeDbStore {
  conceptNodes: ConceptNodeRow[];
  students: StudentRow[];
  xpEvents: XpEventRow[];
  mastery: MasteryRow[];
  lectures: LectureSessionRow[];
  transcriptChunks: TranscriptChunkRow[];
  forcedError?: { table?: string; error: { code: string; message: string } };
  rejectedQuery?: { table?: string; error: Error };
}

class FakeClock implements Clock {
  currentTimeMs: number;
  constructor(initialMs: number = Date.now()) {
    this.currentTimeMs = initialMs;
  }
  now(): Date {
    return new Date(this.currentTimeMs);
  }
  nowISO(): string {
    return this.now().toISOString();
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
            if (f.col === "course_id") rows = rows.filter((r) => r.course_id === f.val);
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
            if (f.col === "course_id") rows = rows.filter((r) => r.course_id === f.val);
            if (f.col === "id") rows = rows.filter((r) => r.id === f.val);
          }
          if (orderBy === "id") {
            rows.sort((a, b) => (a.id > b.id ? (orderAsc ? 1 : -1) : (orderAsc ? -1 : 1)));
          }
          if (rangeFrom !== undefined && rangeTo !== undefined) {
            rows = rows.slice(rangeFrom, rangeTo + 1);
          }
          if (selectOptions?.head) {
            return { data: null, count: rows.length, error: null };
          }
          return { data: rows.map((r) => ({ id: r.id, name: r.name, course_id: r.course_id })), count: rows.length, error: null };
        }

        if (table === "xp_events") {
          let rows = [...store.xpEvents];
          for (const f of filters) {
            if (f.col === "student.course_id") {
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

        if (table === "transcript_chunks") {
          let rows = [...store.transcriptChunks];
          for (const f of filters) {
            if (f.col === "lecture.course_id") {
              rows = rows.filter((r) => r.lecture.course_id === f.val);
            }
          }
          if (orderBy === "id") {
            rows.sort((a, b) => (a.id > b.id ? (orderAsc ? 1 : -1) : (orderAsc ? -1 : 1)));
          }
          if (rangeFrom !== undefined && rangeTo !== undefined) {
            rows = rows.slice(rangeFrom, rangeTo + 1);
          }
          return {
            data: rows.map((r) => ({
              id: r.id,
              lecture: r.lecture,
              transcript_concepts: r.transcript_concepts,
            })),
            error: null,
          };
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
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): Promise<TResult1 | TResult2> => {
          if (store.rejectedQuery && (!store.rejectedQuery.table || store.rejectedQuery.table === table)) {
            const err = store.rejectedQuery.error;
            return onrejected ? Promise.resolve(onrejected(err)) : Promise.reject(err);
          }
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

describe("CourseEffortService", () => {
  const teacherId: UUID = "00000000-0000-4000-8000-000000000030";
  const otherTeacherId: UUID = "00000000-0000-4000-8000-000000000031";
  const courseId: UUID = "00000000-0000-4000-8000-000000000010";
  const foreignCourseId: UUID = "00000000-0000-4000-8000-000000000099";

  const concept1Id: UUID = "00000000-0000-4000-8000-000000000101";
  const concept2Id: UUID = "00000000-0000-4000-8000-000000000102";
  const foreignConceptId: UUID = "00000000-0000-4000-8000-000000000199";

  const rahulId: UUID = "00000000-0000-4000-8000-000000000001";
  const hariId: UUID = "00000000-0000-4000-8000-000000000002";
  const miraId: UUID = "00000000-0000-4000-8000-000000000003";
  const leeId: UUID = "00000000-0000-4000-8000-000000000004";

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
    userId: "00000000-0000-4000-8000-0000000000a1",
    authId: "00000000-0000-4000-8000-0000000000a1",
    email: "student@example.com",
    name: "Student 1",
    role: "student",
    enrolledCourses: [{ studentId: rahulId, courseId }],
  };

  let store: FakeDbStore;
  let mockCourseService: Pick<CourseService, "getCourse">;
  let heatmapService: HeatmapService;
  let effortService: CourseEffortService;

  beforeEach(() => {
    store = {
      conceptNodes: [
        { id: concept1Id, course_id: courseId, label: "Variables", category: "Basics" },
        { id: concept2Id, course_id: courseId, label: "Loops", category: "Control Flow" },
        { id: foreignConceptId, course_id: foreignCourseId, label: "Quantum", category: "Physics" },
      ],
      students: [
        { id: rahulId, course_id: courseId, name: "Rahul Verma" },
        { id: hariId, course_id: courseId, name: "Hari Ram" },
        { id: miraId, course_id: courseId, name: "Mira" },
        { id: leeId, course_id: courseId, name: "Lee" },
      ],
      xpEvents: [],
      mastery: [],
      lectures: [],
      transcriptChunks: [],
    };

    // Rahul: 10 * 60 = 600 XP, 0.20 on both concepts
    for (let i = 1; i <= 10; i++) {
      const hex = i.toString(16).padStart(12, "0");
      store.xpEvents.push({
        id: `00000000-0000-4000-a000-${hex}` as UUID,
        student_id: rahulId,
        amount: 60,
        student: { course_id: courseId },
      });
    }
    store.mastery.push(
      {
        id: "00000000-0000-4000-b000-000000000001" as UUID,
        student_id: rahulId,
        concept_id: concept1Id,
        confidence: 0.2,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
      {
        id: "00000000-0000-4000-b000-000000000002" as UUID,
        student_id: rahulId,
        concept_id: concept2Id,
        confidence: 0.2,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
    );

    // Hari: 8 * 60 = 480 XP, 0.80 on both concepts
    for (let i = 1; i <= 8; i++) {
      const hex = (i + 10).toString(16).padStart(12, "0");
      store.xpEvents.push({
        id: `00000000-0000-4000-a000-${hex}` as UUID,
        student_id: hariId,
        amount: 60,
        student: { course_id: courseId },
      });
    }
    store.mastery.push(
      {
        id: "00000000-0000-4000-b000-000000000003" as UUID,
        student_id: hariId,
        concept_id: concept1Id,
        confidence: 0.8,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
      {
        id: "00000000-0000-4000-b000-000000000004" as UUID,
        student_id: hariId,
        concept_id: concept2Id,
        confidence: 0.8,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
    );

    // Mira: 2 * 60 = 120 XP, 0.40 on both concepts
    for (let i = 1; i <= 2; i++) {
      const hex = (i + 20).toString(16).padStart(12, "0");
      store.xpEvents.push({
        id: `00000000-0000-4000-a000-${hex}` as UUID,
        student_id: miraId,
        amount: 60,
        student: { course_id: courseId },
      });
    }
    store.mastery.push(
      {
        id: "00000000-0000-4000-b000-000000000005" as UUID,
        student_id: miraId,
        concept_id: concept1Id,
        confidence: 0.4,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
      {
        id: "00000000-0000-4000-b000-000000000006" as UUID,
        student_id: miraId,
        concept_id: concept2Id,
        confidence: 0.4,
        concept: { course_id: courseId },
        student: { course_id: courseId },
      },
    );

    // Lee: 0 events, 0 mastery

    mockCourseService = {
      getCourse: vi.fn(async (_actor: ActorContext, targetCourseId: UUID) => {
        if (targetCourseId === courseId) {
          return {
            id: courseId,
            teacherId,
            name: "Intro to CS",
            joinCode: "CS101",
            createdAt: new Date().toISOString(),
          };
        }
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Course not found",
        });
      }),
    };

    const fakeClient = createFakeSupabaseClient(store);
    const fakeClock = new FakeClock();
    const noopPublisher = {
      emitToTeacher: vi.fn(async () => {}),
    };
    const mockIds: Pick<IdGenerator, "generateId"> = {
      generateId: () => "00000000-0000-4000-c000-000000000001" as UUID,
    };

    heatmapService = new HeatmapService({
      client: fakeClient,
      courses: mockCourseService,
      publisher: noopPublisher,
      clock: fakeClock,
      ids: mockIds,
    });

    effortService = new CourseEffortService({
      client: fakeClient,
      courses: mockCourseService,
      heatmap: heatmapService,
    });
  });

  describe("getCourseEffort", () => {
    it("returns exact 4-student cohort DTOs with Rahul flagged high_effort_low_mastery", async () => {
      const result = await effortService.getCourseEffort(teacherActor, courseId);

      expect(result).toHaveLength(4);
      for (const item of result) {
        expect(() => courseEffortSchema.parse(item)).not.toThrow();
      }

      // Result is sorted by student enrollment UUID (id ascending)
      expect(result).toEqual([
        {
          studentId: rahulId,
          name: "Rahul Verma",
          xp: 600,
          averageConfidence: 0.2,
          flag: "high_effort_low_mastery",
        },
        {
          studentId: hariId,
          name: "Hari Ram",
          xp: 480,
          averageConfidence: 0.8,
          flag: null,
        },
        {
          studentId: miraId,
          name: "Mira",
          xp: 120,
          averageConfidence: 0.4,
          flag: null,
        },
        {
          studentId: leeId,
          name: "Lee",
          xp: 0,
          averageConfidence: 0,
          flag: null,
        },
      ]);
    });

    it("handles tied top XP: 4-student cohort with two tied top students receives rank 67 and neither flags", async () => {
      // Give Hari 600 XP (tied with Rahul)
      store.xpEvents.push(
        {
          id: "00000000-0000-4000-a000-000000000015" as UUID,
          student_id: hariId,
          amount: 60,
          student: { course_id: courseId },
        },
        {
          id: "00000000-0000-4000-a000-000000000016" as UUID,
          student_id: hariId,
          amount: 60,
          student: { course_id: courseId },
        },
      );

      const result = await effortService.getCourseEffort(teacherActor, courseId);
      const rahul = result.find((r) => r.studentId === rahulId);
      const hari = result.find((r) => r.studentId === hariId);

      expect(rahul?.xp).toBe(600);
      expect(hari?.xp).toBe(600);
      // Both tied top students have 2 lower students out of 3 -> rank 67 < 75 -> neither flags
      expect(rahul?.flag).toBeNull();
      expect(hari?.flag).toBeNull();
    });

    it("pins inclusive threshold boundaries: 5-student cohort (ranks 75 and 25) flags; 6-student cohort (ranks 80 and 40) flags", async () => {
      // 5-student cohort: N=5, N-1=4. Ranks: 0/4=0, 1/4=25, 2/4=50, 3/4=75, 4/4=100.
      // Target student at index 3: XP rank = 75, confidence rank = 25 (index 1) -> flags!
      const s1: UUID = "00000000-0000-4000-8000-000000000051";
      const s2: UUID = "00000000-0000-4000-8000-000000000052";
      const s3: UUID = "00000000-0000-4000-8000-000000000053";
      const s4: UUID = "00000000-0000-4000-8000-000000000054";
      const s5: UUID = "00000000-0000-4000-8000-000000000055";

      store.students = [
        { id: s1, course_id: courseId, name: "Student 1" },
        { id: s2, course_id: courseId, name: "Student 2" },
        { id: s3, course_id: courseId, name: "Student 3" },
        { id: s4, course_id: courseId, name: "Student 4" },
        { id: s5, course_id: courseId, name: "Student 5" },
      ];
      // XP: s1=10, s2=20, s3=30, s4=40, s5=50
      // s4 has XP 40 -> 3 lower students (s1, s2, s3) -> 3/4 = 75%
      // Confidence: s1=0.1, s4=0.2, s2=0.3, s3=0.4, s5=0.5
      // s4 has confidence 0.2 -> 1 lower student (s1) -> 1/4 = 25% (<= 40)
      store.xpEvents = [
        { id: "00000000-0000-4000-8000-0000000000e1" as UUID, student_id: s1, amount: 10, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000e2" as UUID, student_id: s2, amount: 20, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000e3" as UUID, student_id: s3, amount: 30, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000e4" as UUID, student_id: s4, amount: 40, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000e5" as UUID, student_id: s5, amount: 50, student: { course_id: courseId } },
      ];
      store.mastery = [
        { id: "00000000-0000-4000-8000-0000000000a1" as UUID, student_id: s1, concept_id: concept1Id, confidence: 0.1, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000a2" as UUID, student_id: s1, concept_id: concept2Id, confidence: 0.1, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000a3" as UUID, student_id: s4, concept_id: concept1Id, confidence: 0.2, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000a4" as UUID, student_id: s4, concept_id: concept2Id, confidence: 0.2, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000a5" as UUID, student_id: s2, concept_id: concept1Id, confidence: 0.3, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000a6" as UUID, student_id: s2, concept_id: concept2Id, confidence: 0.3, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000a7" as UUID, student_id: s3, concept_id: concept1Id, confidence: 0.4, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000a8" as UUID, student_id: s3, concept_id: concept2Id, confidence: 0.4, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000a9" as UUID, student_id: s5, concept_id: concept1Id, confidence: 0.5, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000aa" as UUID, student_id: s5, concept_id: concept2Id, confidence: 0.5, concept: { course_id: courseId }, student: { course_id: courseId } },
      ];

      const res5 = await effortService.getCourseEffort(teacherActor, courseId);
      const student4 = res5.find((r) => r.studentId === s4);
      expect(student4?.flag).toBe("high_effort_low_mastery");

      // 6-student cohort: N=6, N-1=5. Ranks: 0/5=0, 1/5=20, 2/5=40, 3/5=60, 4/5=80, 5/5=100.
      const s6: UUID = "00000000-0000-4000-8000-000000000056";
      store.students.push({ id: s6, course_id: courseId, name: "Student 6" });
      // XP: s1=10, s2=20, s3=30, s4=40, s6=45, s5=50
      // s6 has XP 45 -> 4 lower students -> 4/5 = 80% (>= 75)
      // Confidence: s1=0.1, s2=0.2, s6=0.25, s3=0.3, s4=0.4, s5=0.5
      // s6 has confidence 0.25 -> 2 lower students -> 2/5 = 40% (<= 40)
      store.xpEvents.push({ id: "00000000-0000-4000-8000-0000000000e6" as UUID, student_id: s6, amount: 45, student: { course_id: courseId } });
      store.mastery.push(
        { id: "00000000-0000-4000-8000-0000000000b1" as UUID, student_id: s6, concept_id: concept1Id, confidence: 0.25, concept: { course_id: courseId }, student: { course_id: courseId } },
        { id: "00000000-0000-4000-8000-0000000000b2" as UUID, student_id: s6, concept_id: concept2Id, confidence: 0.25, concept: { course_id: courseId }, student: { course_id: courseId } },
      );

      const res6 = await effortService.getCourseEffort(teacherActor, courseId);
      const student6 = res6.find((r) => r.studentId === s6);
      expect(student6?.flag).toBe("high_effort_low_mastery");

      // Verify that student with XP rank 60 does not flag
      // In 6-student cohort, index 3 (s4 with XP 40) has 3 lower students -> 3/5 = 60% < 75% -> no flag
      const student4_in_6 = res6.find((r) => r.studentId === s4);
      expect(student4_in_6?.flag).toBeNull();
    });

    it("returns empty array for empty roster, and single student never flags", async () => {
      // Single student
      store.students = [{ id: rahulId, course_id: courseId, name: "Rahul Verma" }];
      store.xpEvents = store.xpEvents.filter((e) => e.student_id === rahulId);
      store.mastery = store.mastery.filter((m) => m.student_id === rahulId);
      const singleResult = await effortService.getCourseEffort(teacherActor, courseId);
      expect(singleResult).toHaveLength(1);
      expect(singleResult[0]?.xp).toBe(600);
      expect(singleResult[0]?.averageConfidence).toBe(0.2);
      expect(singleResult[0]?.flag).toBeNull();

      // Empty roster
      store.students = [];
      store.xpEvents = [];
      store.mastery = [];
      const emptyResult = await effortService.getCourseEffort(teacherActor, courseId);
      expect(emptyResult).toEqual([]);
    });

    it("computes XP and returns mean 0 when course has no concepts", async () => {
      store.conceptNodes = [];
      const result = await effortService.getCourseEffort(teacherActor, courseId);
      expect(result).toHaveLength(4);
      const rahul = result.find((r) => r.studentId === rahulId);
      expect(rahul?.xp).toBe(600);
      expect(rahul?.averageConfidence).toBe(0);
      expect(rahul?.flag).toBeNull();
    });

    it("treats missing mastery rows as zero in full concept denominator", async () => {
      // Clear mastery and give Rahul only one mastery row with 0.80 on concept1 (out of 2 concepts)
      store.mastery = [
        {
          id: "00000000-0000-4000-b000-000000000099" as UUID,
          student_id: rahulId,
          concept_id: concept1Id,
          confidence: 0.8,
          concept: { course_id: courseId },
          student: { course_id: courseId },
        },
      ];

      const result = await effortService.getCourseEffort(teacherActor, courseId);
      const rahul = result.find((r) => r.studentId === rahulId);
      // 0.80 / 2 concepts = 0.40
      expect(rahul?.averageConfidence).toBe(0.4);
    });

    it("isolates foreign course data: foreign enrollment XP and foreign mastery do not leak", async () => {
      const foreignStudentId: UUID = "00000000-0000-4000-8000-000000000099";
      store.students.push({
        id: foreignStudentId,
        course_id: foreignCourseId,
        name: "Foreign Student",
      });
      // Foreign XP
      store.xpEvents.push({
        id: "00000000-0000-4000-a000-000000000999" as UUID,
        student_id: foreignStudentId,
        amount: 9999,
        student: { course_id: foreignCourseId },
      });
      // Foreign mastery
      store.mastery.push({
        id: "00000000-0000-4000-b000-000000000999" as UUID,
        student_id: foreignStudentId,
        concept_id: foreignConceptId,
        confidence: 0.99,
        concept: { course_id: foreignCourseId },
        student: { course_id: foreignCourseId },
      });

      const result = await effortService.getCourseEffort(teacherActor, courseId);
      expect(result).toHaveLength(4);
      expect(result.some((r) => r.studentId === foreignStudentId)).toBe(false);
    });

    it("paginates queries exceeding 500 rows correctly across pages", async () => {
      // Create 505 students
      store.students = [];
      store.xpEvents = [];
      store.mastery = [];

      for (let i = 1; i <= 505; i++) {
        const hex = i.toString(16).padStart(12, "0");
        const sId = `00000000-0000-4000-8000-${hex}` as UUID;
        store.students.push({
          id: sId,
          course_id: courseId,
          name: `Student ${i}`,
        });
        // Give student 505 a large XP event
        if (i === 505) {
          store.xpEvents.push({
            id: `00000000-0000-4000-a000-${hex}` as UUID,
            student_id: sId,
            amount: 1000,
            student: { course_id: courseId },
          });
        }
      }

      const result = await effortService.getCourseEffort(teacherActor, courseId);
      expect(result).toHaveLength(505);
      const lastStudent = result.find((r) => r.name === "Student 505");
      expect(lastStudent?.xp).toBe(1000);
    });

    it("enforces teacher ownership authorization", async () => {
      // Student actor -> 403
      await expect(effortService.getCourseEffort(studentActor, courseId)).rejects.toMatchObject({
        statusCode: 403,
        message: "Only the owning teacher can view course effort",
      });

      // Other teacher -> 403
      await expect(effortService.getCourseEffort(otherTeacherActor, courseId)).rejects.toMatchObject({
        statusCode: 403,
        message: "Only the owning teacher can view course effort",
      });

      // Missing teacherId -> 403
      const teacherWithoutId: ActorContext = {
        ...teacherActor,
        teacherId: undefined,
      };
      await expect(effortService.getCourseEffort(teacherWithoutId, courseId)).rejects.toMatchObject({
        statusCode: 403,
        message: "Only the owning teacher can view course effort",
      });

      // Malformed course UUID -> 400
      await expect(effortService.getCourseEffort(teacherActor, "not-a-uuid" as UUID)).rejects.toMatchObject({
        statusCode: 400,
        message: "Invalid course ID format",
      });

      // Missing course -> 404
      const missingCourseId: UUID = "00000000-0000-4000-8000-000000000404";
      await expect(effortService.getCourseEffort(teacherActor, missingCourseId)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("translates database failures into AppError (503/403/500)", async () => {
      // 503 for PGRST000
      store.forcedError = {
        table: "students",
        error: { code: "PGRST000", message: "Connection refused" },
      };
      await expect(effortService.getCourseEffort(teacherActor, courseId)).rejects.toMatchObject({
        statusCode: 503,
      });

      // 403 for 42501 (RLS denial)
      store.forcedError = {
        table: "students",
        error: { code: "42501", message: "permission denied for table students" },
      };
      await expect(effortService.getCourseEffort(teacherActor, courseId)).rejects.toMatchObject({
        statusCode: 403,
      });

      // 500 for rejected promise
      store.forcedError = undefined;
      store.rejectedQuery = {
        table: "students",
        error: new Error("Network timeout"),
      };
      await expect(effortService.getCourseEffort(teacherActor, courseId)).rejects.toMatchObject({
        statusCode: 500,
      });
    });
  });

  describe("getClassSky", () => {
    it("returns concepts with taught boolean based on committed transcript links", async () => {
      // Create a lecture and transcript chunks
      const lecture1Id: UUID = "00000000-0000-4000-9000-000000000001";
      store.lectures.push({
        id: lecture1Id,
        course_id: courseId,
        status: "completed",
      });

      // Link concept1 to transcript chunk
      store.transcriptChunks.push(
        {
          id: "00000000-0000-4000-8000-000000000101" as UUID,
          lecture_id: lecture1Id,
          lecture: { course_id: courseId },
          transcript_concepts: [{ concept_id: concept1Id }],
        },
        // Duplicate link to concept1 in another chunk to verify boolean idempotent handling
        {
          id: "00000000-0000-4000-8000-000000000102" as UUID,
          lecture_id: lecture1Id,
          lecture: { course_id: courseId },
          transcript_concepts: [{ concept_id: concept1Id }],
        },
      );

      const snapshot: ClassSkySnapshot = await effortService.getClassSky(teacherActor, courseId);

      expect(snapshot.courseId).toBe(courseId);
      expect(snapshot.totalStudents).toBe(4);
      expect(snapshot.concepts).toHaveLength(2);

      const c1 = snapshot.concepts.find((c) => c.conceptId === concept1Id);
      const c2 = snapshot.concepts.find((c) => c.conceptId === concept2Id);

      // Mean confidence is (0.2 + 0.8 + 0.4 + 0) / 4 = 0.35 -> band: "red"
      expect(c1?.averageConfidence).toBe(0.35);
      expect(c1?.band).toBe("red");
      expect(c1?.taught).toBe(true);

      expect(c2?.averageConfidence).toBe(0.35);
      expect(c2?.band).toBe("red");
      expect(c2?.taught).toBe(false);
    });

    it("ignores foreign course transcript links", async () => {
      const foreignLectureId: UUID = "00000000-0000-4000-9000-000000000099";
      store.lectures.push({
        id: foreignLectureId,
        course_id: foreignCourseId,
        status: "completed",
      });
      // Link concept1 under a foreign course lecture
      store.transcriptChunks.push({
        id: "00000000-0000-4000-8000-000000000199" as UUID,
        lecture_id: foreignLectureId,
        lecture: { course_id: foreignCourseId },
        transcript_concepts: [{ concept_id: concept1Id }],
      });

      const snapshot = await effortService.getClassSky(teacherActor, courseId);
      const c1 = snapshot.concepts.find((c) => c.conceptId === concept1Id);
      expect(c1?.taught).toBe(false);
    });
  });
});
