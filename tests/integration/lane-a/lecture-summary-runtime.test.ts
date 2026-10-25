import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { describe, it, expect, afterEach } from "vitest";
import type { Clock, IdGenerator, UUID } from "../../../src/contracts/common.js";
import { OpenRouterClient } from "../../../src/server/ai/index.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import {
  createServer,
  type ServerInstance,
} from "../../../server/index.js";
import {
  FIXTURE_IDS,
  createFixtureSupabaseClient,
} from "../lane-b/helpers/socket-fixture.js";

function waitForConnect(socket: ClientSocket): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.once("connect", () => resolve());
  socket.once("connect_error", (err) => reject(err));
  return promise;
}

function emitWithAck<T = { success: boolean; error?: string }>(
  socket: ClientSocket,
  event: string,
  payload: unknown
): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  socket.emit(event, payload, (res: T) => resolve(res));
  return promise;
}


describe("P3-C-02 / Lane A: Runtime Server Composition & Post-Lecture Summary Integration", () => {
  let instance: ServerInstance | null = null;
  let clientSocket: ClientSocket | null = null;
  let serverUrl = "";

  const conceptGradientId: UUID = "77777777-7777-4777-8777-777777777777";
  const chunkId: UUID = "88888888-8888-4888-8888-888888888881";

  afterEach(async () => {
    if (clientSocket) {
      clientSocket.disconnect();
      clientSocket = null;
    }
    if (instance) {
      instance.io.close();
      const { promise, resolve } = Promise.withResolvers<void>();
      instance.httpServer.close(() => resolve());
      await promise;
      instance = null;
    }
  });

  async function startTestServer(options?: {
    aiClient?: OpenRouterClient;
    tableRows?: Record<string, Record<string, unknown>[]>;
  }) {
    const supabase = createFixtureSupabaseClient({
      tableRows: options?.tableRows ?? {
        lecture_sessions: [
          {
            id: FIXTURE_IDS.teacher1.lectureId,
            course_id: FIXTURE_IDS.teacher1.courseId,
            title: "Convex Optimization",
            status: "live",
            started_at: "2026-10-23T10:00:00.000Z",
          },
          {
            id: FIXTURE_IDS.teacher2.lectureId,
            course_id: FIXTURE_IDS.teacher2.courseId,
            title: "Advanced Data Structures",
            status: "live",
            started_at: "2026-10-23T10:00:00.000Z",
          },
        ],
        concept_nodes: [
          {
            id: conceptGradientId,
            course_id: FIXTURE_IDS.teacher1.courseId,
            label: "Gradient Descent",
          },
        ],
        transcript_chunks: [
          {
            id: chunkId,
            lecture_id: FIXTURE_IDS.teacher1.lectureId,
            text: "Today we formulate and apply Gradient Descent steps to minimize empirical loss.",
            timestamp_sec: 30,
          },
        ],
        lecture_summaries: [],
      },
    });

    const auth = createAuthGateway(supabase, supabase);

    const aiClient =
      options?.aiClient ??
      new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });

    const clock: Clock = {
      now: () => new Date("2026-10-23T11:00:00.000Z"),
      nowISO: () => "2026-10-23T11:00:00.000Z",
    };

    let idCounter = 1;
    const ids: Pick<IdGenerator, "generateId"> = {
      generateId: () =>
        `99999999-9999-4999-8999-${String(idCounter++).padStart(12, "0")}`,
    };

    instance = createServer({
      auth,
      databaseClient: supabase,
      aiClient,
      clock,
      ids,
      origin: "*",
    });

    const { promise, resolve } = Promise.withResolvers<void>();
    instance.httpServer.listen(0, "127.0.0.1", () => resolve());
    await promise;

    const port = (instance.httpServer.address() as AddressInfo).port;
    serverUrl = `http://127.0.0.1:${port}`;
  }

  describe("1. End Lecture Lifecycle & Summary Broadcast", () => {
    it("owner ends lecture → receives 200, socket receives ended then ready events in order, and GET exposes excerpts", async () => {
      await startTestServer();

      // Connect enrolled student to socket
      clientSocket = ioc(serverUrl, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        auth: { token: FIXTURE_IDS.studentCourse1Only.token },
      });
      await waitForConnect(clientSocket);

      const joinAck = await emitWithAck(clientSocket, "lecture:join", {
        lectureId: FIXTURE_IDS.teacher1.lectureId,
      });
      expect(joinAck).toEqual({ success: true });

      const receivedEvents: Array<{ event: string; payload: unknown }> = [];
      clientSocket.on("lecture:ended", (payload) => {
        receivedEvents.push({ event: "lecture:ended", payload });
      });
      clientSocket.on("lecture:summary-ready", (payload) => {
        receivedEvents.push({ event: "lecture:summary-ready", payload });
      });

      // POST /api/lectures/:lectureId/end with teacher token
      const endResponse = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/end`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}`,
          },
        }
      );

      expect(endResponse.status).toBe(200);
      const endBody = (await endResponse.json()) as {
        id: string;
        status: string;
        endedAt: string;
      };
      expect(endBody.id).toBe(FIXTURE_IDS.teacher1.lectureId);
      expect(endBody.status).toBe("completed");
      expect(endBody.endedAt).toBe("2026-10-23T11:00:00.000Z");

      // Verify socket received both events in strict order
      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0].event).toBe("lecture:ended");
      expect(receivedEvents[1].event).toBe("lecture:summary-ready");

      const readyPayload = receivedEvents[1].payload as {
        lectureId: string;
        summary: string;
        keyConceptsCovered: string[];
      };
      expect(readyPayload.lectureId).toBe(FIXTURE_IDS.teacher1.lectureId);
      expect(readyPayload.keyConceptsCovered).toContain(conceptGradientId);
      expect(readyPayload.summary).toContain("Gradient Descent");

      // GET /api/lectures/:lectureId/summary as enrolled student
      const summaryResponse = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/summary`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${FIXTURE_IDS.studentCourse1Only.token}`,
          },
        }
      );

      expect(summaryResponse.status).toBe(200);
      const summaryBody = (await summaryResponse.json()) as {
        lectureId: string;
        summary: string;
        keyConceptsCovered: string[];
        timelineHighlights: Array<{
          timestampSec: number;
          conceptLabel: string;
          description: string;
        }>;
        generatedAt: string;
      };

      expect(summaryBody.lectureId).toBe(FIXTURE_IDS.teacher1.lectureId);
      expect(summaryBody.keyConceptsCovered).toEqual([conceptGradientId]);
      expect(summaryBody.summary).toBe(readyPayload.summary);
      expect(summaryBody.timelineHighlights).toHaveLength(1);
      expect(summaryBody.timelineHighlights[0].timestampSec).toBe(30);
      expect(summaryBody.timelineHighlights[0].conceptLabel).toBe("Gradient Descent");
      expect(summaryBody.timelineHighlights[0].description).toBe(
        "Today we formulate and apply Gradient Descent steps to minimize empirical loss."
      );
      expect(summaryBody.generatedAt).toBe("2026-10-23T11:00:00.000Z");
    });

    it("duplicate POST end recovers summary and returns completed session without duplicate end event", async () => {
      await startTestServer();

      // First end succeeds
      const firstRes = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/end`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}` },
        }
      );
      expect(firstRes.status).toBe(200);
      const firstData = await firstRes.json();

      // Second end recovers summary and returns completed lecture without mutating endedAt
      const secondRes = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/end`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}` },
        }
      );
      expect(secondRes.status).toBe(200);
      const secondData = await secondRes.json();
      expect(secondData.id).toBe(firstData.id);
      expect(secondData.endedAt).toBe(firstData.endedAt);
      expect(secondData.status).toBe("completed");
    });
  });

  describe("2. Authentication & Authorization Enforcement", () => {
    it("rejects unauthenticated requests with 401 UNAUTHORIZED", async () => {
      await startTestServer();

      const endRes = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/end`,
        { method: "POST" }
      );
      expect(endRes.status).toBe(401);

      const summaryRes = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/summary`,
        { method: "GET" }
      );
      expect(summaryRes.status).toBe(401);
    });

    it("rejects invalid token with 401 UNAUTHORIZED", async () => {
      await startTestServer();

      const res = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/summary`,
        {
          method: "GET",
          headers: { Authorization: "Bearer bogus-token" },
        }
      );
      expect(res.status).toBe(401);
    });

    it("rejects unauthorized teacher ending another teacher's lecture with 403 FORBIDDEN", async () => {
      await startTestServer();

      // Teacher 2 tries to end Teacher 1's lecture
      const res = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/end`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${FIXTURE_IDS.teacher2.token}` },
        }
      );
      expect(res.status).toBe(403);
    });

    it("rejects student from another course reading summary with 403 FORBIDDEN", async () => {
      await startTestServer();

      // End Teacher 2's lecture
      await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher2.lectureId}/end`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${FIXTURE_IDS.teacher2.token}` },
        }
      );

      // Student 1 (enrolled only in course 1) tries to read Teacher 2's lecture summary
      const res = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher2.lectureId}/summary`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${FIXTURE_IDS.studentCourse1Only.token}` },
        }
      );
      expect(res.status).toBe(403);
    });

    it("rejects invalid lectureId UUID with 400 VALIDATION_ERROR", async () => {
      await startTestServer();

      const res = await fetch(`${serverUrl}/api/lectures/not-a-uuid/summary`, {
        method: "GET",
        headers: { Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}` },
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 NOT_FOUND for lecture without a summary", async () => {
      await startTestServer();

      // Lecture 1 has not ended yet
      const res = await fetch(
        `${serverUrl}/api/lectures/${FIXTURE_IDS.teacher1.lectureId}/summary`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${FIXTURE_IDS.teacher1.token}` },
        }
      );
      expect(res.status).toBe(404);
    });
  });

  describe("3. Healthcheck Endpoint", () => {
    it("GET /api/health returns 200 ok with ISO timestamp", async () => {
      await startTestServer();

      const res = await fetch(`${serverUrl}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; timestamp: string };
      expect(body.status).toBe("ok");
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
    });
  });
});
