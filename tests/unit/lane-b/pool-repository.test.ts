import { describe, it, expect, vi } from "vitest";
import type { ISOTimestamp, UUID } from "../../../src/contracts/common.js";
import {
  PoolRepository,
  type PoolDatabaseClientPort,
  type QueryResult,
  type PoolSelectFilterBuilder,
  type PoolUpdateFilterBuilder,
  type PoolDeleteFilterBuilder,
} from "../../../src/server/study-groups/pool-repository.js";

describe("P1-B-02: Ephemeral Study Group Pool Repository", () => {
  const student1Id: UUID = "11111111-1111-4111-8111-111111111111";
  const student2Id: UUID = "22222222-2222-4222-8222-222222222222";
  const student3Id: UUID = "33333333-3333-4333-8333-333333333333";
  const courseId: UUID = "44444444-4444-4444-8444-444444444444";
  const otherCourseId: UUID = "55555555-5555-4555-8555-555555555555";
  const concept1Id: UUID = "66666666-6666-4666-8666-666666666666";
  const concept2Id: UUID = "77777777-7777-4777-8777-777777777777";

  const t0: ISOTimestamp = "2026-10-20T14:00:00.000Z";
  const t0Plus3Min: ISOTimestamp = "2026-10-20T14:03:00.000Z";
  const t0Plus5Min: ISOTimestamp = "2026-10-20T14:05:00.000Z";
  const t0Plus6Min: ISOTimestamp = "2026-10-20T14:06:00.000Z";

  // In-memory fake implementation of PoolDatabaseClientPort
  function createInMemoryClient(): {
    client: PoolDatabaseClientPort;
    rows: Map<string, Record<string, unknown>>;
  } {
    const rows = new Map<string, Record<string, unknown>>();

    const client: PoolDatabaseClientPort = {
      from: (table: string) => {
        if (table !== "study_group_pool") {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          select: (_columns?: string) => {
            const filters: Array<(row: Record<string, unknown>) => boolean> = [];

            const builder: PoolSelectFilterBuilder = {
              eq(column: string, value: string) {
                filters.push((row) => row[column] === value);
                return builder;
              },
              neq(column: string, value: string) {
                filters.push((row) => row[column] !== value);
                return builder;
              },
              gt(column: string, value: string) {
                filters.push((row) => {
                  const val = row[column];
                  return typeof val === "string" && val > value;
                });
                return builder;
              },
              gte(column: string, value: string) {
                filters.push((row) => {
                  const val = row[column];
                  return typeof val === "string" && val >= value;
                });
                return builder;
              },
              lt(column: string, value: string) {
                filters.push((row) => {
                  const val = row[column];
                  return typeof val === "string" && val < value;
                });
                return builder;
              },
              single: async () => {
                const filtered = Array.from(rows.values()).filter((r) =>
                  filters.every((f) => f(r)),
                );
                if (filtered.length !== 1) {
                  return {
                    data: null,
                    error: {
                      code: "PGRST116",
                      message: "JSON object requested, multiple or no rows returned",
                    },
                  };
                }
                return { data: { ...filtered[0] }, error: null };
              },
              maybeSingle: async () => {
                const filtered = Array.from(rows.values()).filter((r) =>
                  filters.every((f) => f(r)),
                );
                if (filtered.length === 0) {
                  return { data: null, error: null };
                }
                return { data: { ...filtered[0] }, error: null };
              },
              then(onfulfilled, onrejected) {
                const filtered = Array.from(rows.values())
                  .filter((r) => filters.every((f) => f(r)))
                  .map((r) => ({ ...r }));
                const p: Promise<QueryResult<unknown[]>> = Promise.resolve({
                  data: filtered,
                  error: null,
                });
                return p.then(onfulfilled, onrejected);
              },
            };

            return builder;
          },

          insert: (values: unknown) => {
            const val = values as Record<string, unknown>;
            const studentId = val.student_id;
            const courseIdVal = val.course_id;

            // Check unique(student_id, course_id)
            const exists = Array.from(rows.values()).some(
              (r) =>
                r.student_id === studentId &&
                r.course_id === courseIdVal,
            );

            if (exists) {
              return {
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        'duplicate key value violates unique constraint "study_group_pool_student_id_course_id_key"',
                    },
                  }),
                  maybeSingle: async () => ({
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        'duplicate key value violates unique constraint "study_group_pool_student_id_course_id_key"',
                    },
                  }),
                }),
              };
            }

            const row = {
              id: (val.id as string) || crypto.randomUUID(),
              student_id: val.student_id,
              course_id: val.course_id,
              concept_ids: val.concept_ids,
              status: val.status || "waiting",
              created_at: val.created_at || new Date().toISOString(),
              expires_at:
                val.expires_at ||
                new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            };
            rows.set(row.id, row);

            return {
              select: () => ({
                single: async () => ({ data: { ...row }, error: null }),
                maybeSingle: async () => ({ data: { ...row }, error: null }),
              }),
            };
          },

          update: (values: unknown) => {
            const patch = values as Record<string, unknown>;
            const filters: Array<(row: Record<string, unknown>) => boolean> = [];

            const builder: PoolUpdateFilterBuilder = {
              eq(column: string, value: string) {
                filters.push((row) => row[column] === value);
                return builder;
              },
              lt(column: string, value: string) {
                filters.push((row) => {
                  const val = row[column];
                  return typeof val === "string" && val < value;
                });
                return builder;
              },
              gt(column: string, value: string) {
                filters.push((row) => {
                  const val = row[column];
                  return typeof val === "string" && val > value;
                });
                return builder;
              },
              select: (_columns?: string) => ({
                single: async () => {
                  const matches = Array.from(rows.values()).filter((r) =>
                    filters.every((f) => f(r)),
                  );
                  if (matches.length !== 1) {
                    return { data: null, error: { code: "PGRST116" } };
                  }
                  Object.assign(matches[0], patch);
                  return { data: { ...matches[0] }, error: null };
                },
                maybeSingle: async () => {
                  const matches = Array.from(rows.values()).filter((r) =>
                    filters.every((f) => f(r)),
                  );
                  if (matches.length === 0) {
                    return { data: null, error: null };
                  }
                  Object.assign(matches[0], patch);
                  return { data: { ...matches[0] }, error: null };
                },
                then(onfulfilled, onrejected) {
                  const matches = Array.from(rows.values()).filter((r) =>
                    filters.every((f) => f(r)),
                  );
                  for (const m of matches) {
                    Object.assign(m, patch);
                  }
                  const p: Promise<QueryResult<unknown[]>> = Promise.resolve({
                    data: matches.map((m) => ({ ...m })),
                    error: null,
                    count: matches.length,
                  });
                  return p.then(onfulfilled, onrejected);
                },
              }),
              then(onfulfilled, onrejected) {
                const matches = Array.from(rows.values()).filter((r) =>
                  filters.every((f) => f(r)),
                );
                for (const m of matches) {
                  Object.assign(m, patch);
                }
                const p: Promise<QueryResult<unknown>> = Promise.resolve({
                  data: matches.map((m) => ({ ...m })),
                  error: null,
                  count: matches.length,
                });
                return p.then(onfulfilled, onrejected);
              },
            };

            return builder;
          },

          delete: () => {
            const filters: Array<(row: Record<string, unknown>) => boolean> = [];
            const builder: PoolDeleteFilterBuilder = {
              eq(column: string, value: string) {
                filters.push((row) => row[column] === value);
                return builder;
              },
              lt(column: string, value: string) {
                filters.push((row) => {
                  const val = row[column];
                  return typeof val === "string" && val < value;
                });
                return builder;
              },
              then(onfulfilled, onrejected) {
                const matchingIds = Array.from(rows.entries())
                  .filter(([_, r]) => filters.every((f) => f(r)))
                  .map(([id]) => id);
                for (const id of matchingIds) {
                  rows.delete(id);
                }
                const p: Promise<QueryResult<unknown>> = Promise.resolve({
                  data: null,
                  error: null,
                  count: matchingIds.length,
                });
                return p.then(onfulfilled, onrejected);
              },
            };
            return builder;
          },
        };
      },
    };

    return { client, rows };
  }

  describe("1. Inserts pool entry and returns mapped result", () => {
    it("inserts waiting entry with 5-minute expiration and concept IDs", async () => {
      const { client } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const entry = await repo.insertPoolEntry({
        studentId: student1Id,
        courseId,
        conceptIds: [concept1Id, concept2Id],
        expiresAt: t0Plus5Min,
      });

      expect(entry.id).toBeDefined();
      expect(entry.studentId).toBe(student1Id);
      expect(entry.courseId).toBe(courseId);
      expect(entry.conceptIds).toEqual([concept1Id, concept2Id]);
      expect(entry.status).toBe("waiting");
      expect(entry.expiresAt).toBe(t0Plus5Min);
      expect(entry.createdAt).toBeDefined();
    });

    it("defaults expiration to ~5 minutes if not explicitly provided", async () => {
      const { client } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const before = Date.now();
      const entry = await repo.insertPoolEntry({
        studentId: student2Id,
        courseId,
        conceptIds: [concept1Id],
      });
      const after = Date.now();

      const expiresMs = new Date(entry.expiresAt).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 4.9 * 60 * 1000);
      expect(expiresMs).toBeLessThanOrEqual(after + 5.1 * 60 * 1000);
    });
  });

  describe("2. Duplicate student+course entry returns 409 CONFLICT", () => {
    it("rejects insert if student already in pool for same course", async () => {
      const { client } = createInMemoryClient();
      const repo = new PoolRepository(client);

      await repo.insertPoolEntry({
        studentId: student1Id,
        courseId,
        conceptIds: [concept1Id],
        expiresAt: t0Plus5Min,
      });

      await expect(
        repo.insertPoolEntry({
          studentId: student1Id,
          courseId,
          conceptIds: [concept2Id],
          expiresAt: t0Plus5Min,
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
        message: "Student already has an active pool entry for this course",
      });
    });

    it("translates raw 23505 Postgres error to 409 AppError", async () => {
      const mockClient: PoolDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "study_group_pool_student_id_course_id_key"',
                  details: "Key (student_id, course_id) already exists.",
                },
              }),
            }),
          }),
        }),
      };

      const repo = new PoolRepository(mockClient);

      await expect(
        repo.insertPoolEntry({
          studentId: student1Id,
          courseId,
          conceptIds: [concept1Id],
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });
    });
  });

  describe("3. getActiveEntries returns only unexpired waiting entries", () => {
    it("returns entries where status is waiting and expires_at > now", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      // Student 1: expires at t0 + 5min (unexpired at t0 + 3min)
      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      // Student 2: expires at t0 + 5min (unexpired at t0 + 3min)
      const e2Id = "10000000-0000-4000-8000-000000000002";
      rows.set(e2Id, {
        id: e2Id,
        student_id: student2Id,
        course_id: courseId,
        concept_ids: [concept2Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      // Student 3 in a different course
      const e3Id = "10000000-0000-4000-8000-000000000003";
      rows.set(e3Id, {
        id: e3Id,
        student_id: student3Id,
        course_id: otherCourseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const active = await repo.getActiveEntries(courseId, t0Plus3Min);

      expect(active).toHaveLength(2);
      expect(active.map((a) => a.studentId).sort()).toEqual(
        [student1Id, student2Id].sort(),
      );
    });

    it("filters out entries older than expiration (expires_at <= now)", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      // Student 1: expired (expires_at t0+5min, current time t0+6min)
      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const active = await repo.getActiveEntries(courseId, t0Plus6Min);
      expect(active).toHaveLength(0);
    });

    it("filters out non-waiting entries (matched, cancelled, expired)", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "matched",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const active = await repo.getActiveEntries(courseId, t0Plus3Min);
      expect(active).toHaveLength(0);
    });
  });

  describe("4. getEntryByStudent", () => {
    it("returns null when no waiting entry exists for student", async () => {
      const { client } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const result = await repo.getEntryByStudent(student1Id, courseId);
      expect(result).toBeNull();
    });

    it("returns waiting entry for student in target course", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const entryId = "10000000-0000-4000-8000-000000000001";
      rows.set(entryId, {
        id: entryId,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const found = await repo.getEntryByStudent(student1Id, courseId);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(entryId);
      expect(found?.studentId).toBe(student1Id);
      expect(found?.status).toBe("waiting");
    });
  });

  describe("5. updateEntryStatus transitions status", () => {
    it("transitions waiting entry to matched", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const entryId = "10000000-0000-4000-8000-000000000001";
      rows.set(entryId, {
        id: entryId,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const updated = await repo.updateEntryStatus(entryId, "matched");

      expect(updated.id).toBe(entryId);
      expect(updated.status).toBe("matched");
      expect(rows.get(entryId)?.status).toBe("matched");
    });

    it("throws 404 NOT_FOUND when entry does not exist", async () => {
      const { client } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const nonExistentId: UUID = "99999999-9999-4999-8999-999999999999";

      await expect(
        repo.updateEntryStatus(nonExistentId, "matched"),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });
  });

  describe("6. cancelWaitingEntry", () => {
    it("cancels waiting entry for student in course", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const entryId = "10000000-0000-4000-8000-000000000001";
      rows.set(entryId, {
        id: entryId,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const cancelled = await repo.cancelWaitingEntry(student1Id, courseId);
      expect(cancelled).not.toBeNull();
      expect(cancelled?.status).toBe("cancelled");
      expect(rows.get(entryId)?.status).toBe("cancelled");
    });

    it("returns null when no waiting entry to cancel", async () => {
      const { client } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const cancelled = await repo.cancelWaitingEntry(student1Id, courseId);
      expect(cancelled).toBeNull();
    });
  });

  describe("7. cleanupExpired marks expired entries", () => {
    it("updates expired waiting entries to status 'expired' and returns count", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      // Entry 1: expired (expires at t0+5min, cleanup called at t0+6min)
      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      // Entry 2: expired
      const e2Id = "10000000-0000-4000-8000-000000000002";
      rows.set(e2Id, {
        id: e2Id,
        student_id: student2Id,
        course_id: courseId,
        concept_ids: [concept2Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      // Entry 3: NOT expired (expires at t0+10min)
      const e3Id = "10000000-0000-4000-8000-000000000003";
      rows.set(e3Id, {
        id: e3Id,
        student_id: student3Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: "2026-10-20T14:10:00.000Z",
      });

      const cleanedCount = await repo.cleanupExpired(t0Plus6Min);

      expect(cleanedCount).toBe(2);
      expect(rows.get(e1Id)?.status).toBe("expired");
      expect(rows.get(e2Id)?.status).toBe("expired");
      expect(rows.get(e3Id)?.status).toBe("waiting");
    });
  });

  describe("8. Input validation guards", () => {
    it("rejects invalid UUID formats with 400 VALIDATION_ERROR", async () => {
      const { client } = createInMemoryClient();
      const repo = new PoolRepository(client);

      await expect(
        repo.insertPoolEntry({
          studentId: "invalid-uuid",
          courseId,
          conceptIds: [concept1Id],
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        repo.getActiveEntries("not-a-uuid", t0),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        repo.getEntryByStudent(student1Id, "not-a-uuid"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        repo.updateEntryStatus("not-a-uuid", "matched"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("rejects empty concept array with 400 VALIDATION_ERROR", async () => {
      const { client } = createInMemoryClient();
      const repo = new PoolRepository(client);

      await expect(
        repo.insertPoolEntry({
          studentId: student1Id,
          courseId,
          conceptIds: [],
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });
  });

  describe("9. cleanupExpiredForCourse cleans up only target course", () => {
    it("expires only entries belonging to the specified course", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const e2Id = "10000000-0000-4000-8000-000000000002";
      rows.set(e2Id, {
        id: e2Id,
        student_id: student2Id,
        course_id: otherCourseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const cleaned = await repo.cleanupExpiredForCourse(courseId, t0Plus6Min);
      expect(cleaned).toBe(1);
      expect(rows.get(e1Id)?.status).toBe("expired");
      expect(rows.get(e2Id)?.status).toBe("waiting");
    });
  });

  describe("10. reactivateInactiveEntry", () => {
    it("reactivates expired entry to waiting with updated concepts and timestamps", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "expired",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const reactivated = await repo.reactivateInactiveEntry(
        student1Id,
        courseId,
        [concept2Id],
        t0Plus6Min,
        "2026-10-20T14:11:00.000Z",
      );

      expect(reactivated).not.toBeNull();
      expect(reactivated?.id).toBe(e1Id);
      expect(reactivated?.status).toBe("waiting");
      expect(reactivated?.conceptIds).toEqual([concept2Id]);
      expect(reactivated?.createdAt).toBe(t0Plus6Min);
      expect(reactivated?.expiresAt).toBe("2026-10-20T14:11:00.000Z");
      expect(rows.get(e1Id)?.status).toBe("waiting");
    });

    it("reactivates cancelled entry to waiting", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "cancelled",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const reactivated = await repo.reactivateInactiveEntry(
        student1Id,
        courseId,
        [concept1Id],
        t0Plus6Min,
        "2026-10-20T14:11:00.000Z",
      );

      expect(reactivated).not.toBeNull();
      expect(reactivated?.id).toBe(e1Id);
      expect(reactivated?.status).toBe("waiting");
      expect(rows.get(e1Id)?.status).toBe("waiting");
    });

    it("returns null if row is currently waiting or matched or non-existent", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "matched",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const reactivated = await repo.reactivateInactiveEntry(
        student1Id,
        courseId,
        [concept1Id],
        t0Plus6Min,
        "2026-10-20T14:11:00.000Z",
      );

      expect(reactivated).toBeNull();
      expect(rows.get(e1Id)?.status).toBe("matched");
    });
  });

  describe("11. getActiveEntries inclusive expiry boundary", () => {
    it("includes entry when expires_at equals now (inclusive INV-C01)", async () => {
      const { client, rows } = createInMemoryClient();
      const repo = new PoolRepository(client);

      const e1Id = "10000000-0000-4000-8000-000000000001";
      rows.set(e1Id, {
        id: e1Id,
        student_id: student1Id,
        course_id: courseId,
        concept_ids: [concept1Id],
        status: "waiting",
        created_at: t0,
        expires_at: t0Plus5Min,
      });

      const entriesAtExpiry = await repo.getActiveEntries(courseId, t0Plus5Min);
      expect(entriesAtExpiry).toHaveLength(1);
      expect(entriesAtExpiry[0].id).toBe(e1Id);

      const entriesAfterExpiry = await repo.getActiveEntries(courseId, t0Plus6Min);
      expect(entriesAfterExpiry).toHaveLength(0);
    });
  });
});
