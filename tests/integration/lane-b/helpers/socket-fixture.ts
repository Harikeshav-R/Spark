import http from "node:http";
import { type AddressInfo } from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { createAuthGateway } from "../../../../src/server/platform/index.js";
import { createRoomAuthorizer } from "../../../../src/server/realtime/room-authorizer.js";
import {
  createSocketServer,
  type RealtimeSocketServer,
  PresenceTracker,
} from "../../../../src/server/realtime/index.js";
import { LectureRepository } from "../../../../src/server/classroom/index.js";
import type { RealtimePublisher } from "../../../../src/contracts/realtime.js";

export const FIXTURE_IDS = {
  teacher1: {
    authId: "11111111-1111-4111-8111-111111111111",
    teacherId: "22222222-2222-4222-8222-222222222221",
    token: "token-teacher-1",
    courseId: "55555555-5555-4555-8555-555555555551",
    lectureId: "66666666-6666-4666-8666-666666666661",
  },
  teacher2: {
    authId: "11111111-1111-4111-8111-111111111112",
    teacherId: "22222222-2222-4222-8222-222222222222",
    token: "token-teacher-2",
    courseId: "55555555-5555-4555-8555-555555555552",
    lectureId: "66666666-6666-4666-8666-666666666662",
  },
  studentDual: {
    authId: "33333333-3333-4333-8333-333333333331",
    token: "token-student-dual",
    studentIdCourse1: "44444444-4444-4444-8444-444444444441",
    studentIdCourse2: "44444444-4444-4444-8444-444444444442",
  },
  studentCourse1Only: {
    authId: "33333333-3333-4333-8333-333333333332",
    token: "token-student-course1",
    studentIdCourse1: "44444444-4444-4444-8444-444444444443",
  },
} as const;

export interface TestFixtureOptions {
  authUnavailable?: boolean;
  databaseError?: boolean;
  tableRows?: Record<string, Record<string, unknown>[]>;
}

export function createFixtureSupabaseClient(options: TestFixtureOptions = {}): SupabaseClient {
  const users: Record<string, { id: string; email: string; user_metadata?: { name?: string } }> = {
    [FIXTURE_IDS.teacher1.token]: {
      id: FIXTURE_IDS.teacher1.authId,
      email: "teacher1@example.edu",
      user_metadata: { name: "Prof. Teacher One" },
    },
    [FIXTURE_IDS.teacher2.token]: {
      id: FIXTURE_IDS.teacher2.authId,
      email: "teacher2@example.edu",
      user_metadata: { name: "Prof. Teacher Two" },
    },
    [FIXTURE_IDS.studentDual.token]: {
      id: FIXTURE_IDS.studentDual.authId,
      email: "student_dual@example.edu",
      user_metadata: { name: "Dual Student" },
    },
    [FIXTURE_IDS.studentCourse1Only.token]: {
      id: FIXTURE_IDS.studentCourse1Only.authId,
      email: "student_c1@example.edu",
      user_metadata: { name: "Course1 Student" },
    },
  };

  const teachers = [
    {
      id: FIXTURE_IDS.teacher1.teacherId,
      auth_id: FIXTURE_IDS.teacher1.authId,
      name: "Prof. Teacher One",
      email: "teacher1@example.edu",
    },
    {
      id: FIXTURE_IDS.teacher2.teacherId,
      auth_id: FIXTURE_IDS.teacher2.authId,
      name: "Prof. Teacher Two",
      email: "teacher2@example.edu",
    },
  ];

  const students = [
    {
      id: FIXTURE_IDS.studentDual.studentIdCourse1,
      auth_id: FIXTURE_IDS.studentDual.authId,
      course_id: FIXTURE_IDS.teacher1.courseId,
      name: "Dual Student",
      email: "student_dual@example.edu",
    },
    {
      id: FIXTURE_IDS.studentDual.studentIdCourse2,
      auth_id: FIXTURE_IDS.studentDual.authId,
      course_id: FIXTURE_IDS.teacher2.courseId,
      name: "Dual Student",
      email: "student_dual@example.edu",
    },
    {
      id: FIXTURE_IDS.studentCourse1Only.studentIdCourse1,
      auth_id: FIXTURE_IDS.studentCourse1Only.authId,
      course_id: FIXTURE_IDS.teacher1.courseId,
      name: "Course1 Student",
      email: "student_c1@example.edu",
    },
  ];

  const courses = [
    {
      id: FIXTURE_IDS.teacher1.courseId,
      teacher_id: FIXTURE_IDS.teacher1.teacherId,
      name: "CS101",
      join_code: "COURSE01",
      created_at: "2026-10-20T14:00:00.000Z",
    },
    {
      id: FIXTURE_IDS.teacher2.courseId,
      teacher_id: FIXTURE_IDS.teacher2.teacherId,
      name: "CS201",
      join_code: "COURSE02",
      created_at: "2026-10-20T14:00:00.000Z",
    },
  ];

  const lecture_sessions = [
    {
      id: FIXTURE_IDS.teacher1.lectureId,
      course_id: FIXTURE_IDS.teacher1.courseId,
      title: "Lecture 1",
      status: "live",
      started_at: "2026-10-20T14:00:00.000Z",
    },
    {
      id: FIXTURE_IDS.teacher2.lectureId,
      course_id: FIXTURE_IDS.teacher2.courseId,
      title: "Lecture 2",
      status: "live",
      started_at: "2026-10-20T14:00:00.000Z",
    },
  ];

  const tables: Record<string, Record<string, unknown>[]> = {
    teachers,
    students,
    courses,
    lecture_sessions,
    concept_nodes: [],
    transcript_chunks: [],
    transcript_concepts: [],
  };

  if (options.tableRows) {
    for (const [name, rows] of Object.entries(options.tableRows)) {
      tables[name] = rows;
    }
  }

  const fixtureFetch = async (
    urlInput: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = new URL(urlInput.toString());
    const path = url.pathname;

    if (options.authUnavailable) {
      return new Response(JSON.stringify({ message: "Auth service down", status: 503 }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/auth/v1/user") {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const authHeader =
        headers.Authorization ||
        headers.authorization ||
        (init?.headers instanceof Headers ? init.headers.get("Authorization") : null) ||
        "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const user = users[token];
      if (!user) {
        return new Response(JSON.stringify({ message: "Invalid or expired token", status: 401 }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (options.databaseError) {
      return new Response(JSON.stringify({ message: "Database connection failed", status: 500 }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const method = init?.method?.toUpperCase() ?? "GET";
    const tableMatch = path.match(/^\/rest\/v1\/([^/?]+)/);
    if (tableMatch) {
      const tableName = tableMatch[1]!;
      if (!tables[tableName]) {
        tables[tableName] = [];
      }
      const records = tables[tableName]!;

      const headers = (init?.headers ?? {}) as Record<string, string>;
      const acceptHeader =
        headers.Accept ||
        headers.accept ||
        (init?.headers instanceof Headers ? init.headers.get("Accept") : null) ||
        "";

      if (method === "POST") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        let bodyParsed: unknown;
        try {
          bodyParsed = JSON.parse(bodyText);
        } catch {
          return new Response(JSON.stringify({ message: "Invalid JSON in POST", status: 400 }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const itemsToInsert = Array.isArray(bodyParsed) ? bodyParsed : [bodyParsed];
        if (tableName === "lecture_summaries") {
          for (const item of itemsToInsert) {
            if (item && typeof item === "object" && "lecture_id" in item) {
              const exists = records.some((r) => r["lecture_id"] === (item as Record<string, unknown>)["lecture_id"]);
              if (exists) {
                return new Response(
                  JSON.stringify({
                    code: "23505",
                    message: "duplicate key value violates unique constraint",
                  }),
                  {
                    status: 409,
                    headers: { "Content-Type": "application/json" },
                  }
                );
              }
            }
          }
        }
        for (const item of itemsToInsert) {
          if (item && typeof item === "object") {
            records.push(item as Record<string, unknown>);
          }
        }

        if (acceptHeader.includes("application/vnd.pgrst.object+json")) {
          const singleItem = Array.isArray(bodyParsed) ? bodyParsed[0] : bodyParsed;
          return new Response(JSON.stringify(singleItem ?? {}), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(itemsToInsert), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "PATCH") {
        let bodyParsed: unknown;
        try {
          bodyParsed = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        } catch {
          return new Response(JSON.stringify({ message: "Invalid JSON in PATCH", status: 400 }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const updatedRecords: Record<string, unknown>[] = [];
        for (let i = 0; i < records.length; i++) {
          const r = records[i]!;
          let matches = true;
          for (const [key, val] of url.searchParams.entries()) {
            if (key === "select" || key === "order" || key === "offset" || key === "limit") continue;
            if (val.startsWith("eq.")) {
              const target = val.slice(3);
              if (String(r[key]) !== target) {
                matches = false;
                break;
              }
            }
          }
          if (matches && bodyParsed && typeof bodyParsed === "object") {
            records[i] = { ...r, ...(bodyParsed as Record<string, unknown>) };
            updatedRecords.push(records[i]!);
          }
        }

        if (acceptHeader.includes("application/vnd.pgrst.object+json")) {
          if (updatedRecords.length === 0) {
            return new Response(
              JSON.stringify({
                code: "PGRST116",
                details: "The result contains 0 rows",
                message: "JSON object requested, multiple (or no) rows returned",
              }),
              {
                status: 406,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
          return new Response(JSON.stringify(updatedRecords[0]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(updatedRecords), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      let filtered = [...records];

      for (const [key, val] of url.searchParams.entries()) {
        if (key === "select" || key === "order" || key === "offset" || key === "limit") continue;
        if (val.startsWith("eq.")) {
          const target = val.slice(3);
          filtered = filtered.filter((r) => String(r[key]) === target);
        } else if (val.startsWith("gte.")) {
          const target = Number(val.slice(4));
          filtered = filtered.filter((r) => Number(r[key]) >= target);
        } else if (val.startsWith("lte.")) {
          const target = Number(val.slice(4));
          filtered = filtered.filter((r) => Number(r[key]) <= target);
        } else if (val.startsWith("in.(") && val.endsWith(")")) {
          const targets = val.slice(4, -1).split(",").map(decodeURIComponent);
          filtered = filtered.filter((r) => targets.includes(String(r[key])));
        }
      }

      const orderParams = url.searchParams.getAll("order");
      const orderClauses = orderParams
        .flatMap((p) => p.split(","))
        .map((c) => c.trim())
        .filter(Boolean);

      if (orderClauses.length > 0) {
        filtered.sort((a, b) => {
          for (const clause of orderClauses) {
            const parts = clause.split(".");
            const col = parts[0]!;
            const isDesc = parts[1]?.toLowerCase() === "desc";
            const valA = a[col];
            const valB = b[col];
            if (valA === valB) continue;
            if (valA === undefined || valA === null) return isDesc ? -1 : 1;
            if (valB === undefined || valB === null) return isDesc ? 1 : -1;
            if (typeof valA === "number" && typeof valB === "number") {
              return isDesc ? valB - valA : valA - valB;
            }
            const strA = String(valA);
            const strB = String(valB);
            const cmp = strA.localeCompare(strB);
            if (cmp !== 0) {
              return isDesc ? -cmp : cmp;
            }
          }
          return 0;
        });
      }

      let offset = 0;
      let limit: number | undefined;

      const offsetParam = url.searchParams.get("offset");
      if (offsetParam !== null) {
        offset = Math.max(0, parseInt(offsetParam, 10) || 0);
      }
      const limitParam = url.searchParams.get("limit");
      if (limitParam !== null) {
        limit = parseInt(limitParam, 10);
      }

      const rangeHeader =
        headers.Range ||
        headers.range ||
        (init?.headers instanceof Headers ? init.headers.get("Range") : null);

      if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/(?:items=)?(\d+)-(\d+)/);
        if (rangeMatch) {
          const from = parseInt(rangeMatch[1]!, 10);
          const to = parseInt(rangeMatch[2]!, 10);
          offset = from;
          limit = to - from + 1;
        }
      }

      if (offset > 0 || limit !== undefined) {
        const end = limit !== undefined ? offset + limit : undefined;
        filtered = filtered.slice(offset, end);
      }
      if (acceptHeader.includes("application/vnd.pgrst.object+json")) {
        if (filtered.length === 0) {
          return new Response(
            JSON.stringify({
              code: "PGRST116",
              details: "The result contains 0 rows",
              message: "JSON object requested, multiple (or no) rows returned",
            }),
            {
              status: 406,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify(filtered[0]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const preferHeader = headers.Prefer || headers.prefer || "";
      const isHead = method === "HEAD";
      const totalCount = filtered.length;
      const respHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (preferHeader.includes("count=exact") || isHead) {
        respHeaders["Content-Range"] = `0-${Math.max(0, totalCount - 1)}/${totalCount}`;
      }

      if (isHead) {
        return new Response(null, {
          status: 200,
          headers: respHeaders,
        });
      }

      return new Response(JSON.stringify(filtered), {
        status: 200,
        headers: respHeaders,
      });
    }

    return new Response(JSON.stringify({ message: "Not found", status: 404 }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  return createClient("http://127.0.0.1:54321", "sb_anon_fixture_key", {
    auth: { persistSession: false },
    global: { fetch: fixtureFetch },
  });
}

export interface TestRealtimeHarness {
  httpServer: http.Server;
  io: RealtimeSocketServer;
  publisher: RealtimePublisher;
  presence: PresenceTracker;
  port: number;
  connectClient(authOrOptions?: Record<string, unknown>): Promise<ClientSocket>;
  cleanup(): Promise<void>;
}

export async function createTestRealtimeHarness(
  options: TestFixtureOptions = {}
): Promise<TestRealtimeHarness> {
  const supabase = createFixtureSupabaseClient(options);
  const auth = createAuthGateway(supabase, supabase);
  const rooms = createRoomAuthorizer(supabase);

  const httpServer = http.createServer();
  const lectures = new LectureRepository(supabase);

  const { io, publisher, presence } = createSocketServer(httpServer, {
    auth,
    rooms,
    lectures,
    origin: "*",
  });

  const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<void>();
  httpServer.listen(0, "127.0.0.1", () => listenResolve());
  await listenPromise;

  const address = httpServer.address() as AddressInfo;
  const port = address.port;

  const openClients: ClientSocket[] = [];

  async function connectClient(
    authOrOptions: Record<string, unknown> = {}
  ): Promise<ClientSocket> {
    const socket = ioc(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      auth: authOrOptions,
    });

    openClients.push(socket);
    return socket;
  }

  async function cleanup(): Promise<void> {
    for (const socket of openClients) {
      if (socket.connected) {
        socket.disconnect();
      }
    }
    openClients.length = 0;

    const { promise: ioClosePromise, resolve: ioCloseResolve } = Promise.withResolvers<void>();
    io.close(() => {
      ioCloseResolve();
    });
    await ioClosePromise;

    if (httpServer.listening) {
      const { promise: httpClosePromise, resolve: httpCloseResolve } = Promise.withResolvers<void>();
      httpServer.close(() => httpCloseResolve());
      await httpClosePromise;
    }
  }

  return {
    httpServer,
    io,
    publisher,
    presence,
    port,
    connectClient,
    cleanup,
  };
}
