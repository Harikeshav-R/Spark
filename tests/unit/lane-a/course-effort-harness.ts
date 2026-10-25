import type { SupabaseClient } from "@supabase/supabase-js";
import type { Clock, UUID } from "../../../src/contracts/common.js";

export interface ConceptNodeRow {
  id: UUID;
  course_id: UUID;
  label: string;
  category: string;
}

export interface StudentRow {
  id: UUID;
  course_id: UUID;
  name: string;
  auth_id?: UUID;
  created_at?: string;
}

export interface XpEventRow {
  id: UUID;
  student_id: UUID;
  amount: number;
  student: { course_id: UUID };
}

export interface MasteryRow {
  id: UUID;
  student_id: UUID;
  concept_id: UUID;
  confidence: number;
  concept: { course_id: UUID };
  student: { course_id: UUID };
}

export interface LectureSessionRow {
  id: UUID;
  course_id: UUID;
  status: string;
}

export interface TranscriptChunkRow {
  id: UUID;
  lecture_id: UUID;
  lecture: { course_id: UUID };
  transcript_concepts: Array<{ concept_id: UUID }>;
}

export interface FakeDbStore {
  conceptNodes: ConceptNodeRow[];
  students: StudentRow[];
  xpEvents: XpEventRow[];
  mastery: MasteryRow[];
  lectures: LectureSessionRow[];
  transcriptChunks: TranscriptChunkRow[];
  forcedError?: { table?: string; error: { code: string; message: string } };
  rejectedQuery?: { table?: string; error: Error };
}

export class FakeClock implements Clock {
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

export interface QueryFilter {
  col: string;
  val: unknown;
}

export interface QueryResult<T> {
  data: T | null;
  count?: number | null;
  error: { code: string; message: string } | null;
}

export interface FakeQueryBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(fields?: string, options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): FakeQueryBuilder<T>;
  eq(col: string, val: unknown): FakeQueryBuilder<T>;
  order(col: string, opts?: { ascending?: boolean }): FakeQueryBuilder<T>;
  range(from: number, to: number): FakeQueryBuilder<T>;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { code: string; message: string } | null }>;
}

export function createFakeSupabaseClient(store: FakeDbStore): Pick<SupabaseClient, "from"> {
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
          return {
            data: rows.map((r) => ({
              id: r.id,
              name: r.name,
              course_id: r.course_id,
              created_at: r.created_at ?? "2026-10-01T10:00:00.000Z",
            })),
            count: rows.length,
            error: null,
          };
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
