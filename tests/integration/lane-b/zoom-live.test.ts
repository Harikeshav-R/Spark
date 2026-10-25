import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Clock } from "../../../src/contracts/common.js";
import type { TranscriptChunkEvent } from "../../../src/contracts/realtime.js";
import {
  createZoomAdapter,
  runZoomRtms,
  ZoomMeetingService,
  ZoomOAuth,
} from "../../../src/server/zoom/index.js";
import {
  createAuthGateway,
  createSupabaseClients,
} from "../../../src/server/platform/index.js";
import {
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
} from "../../../src/server/core/index.js";
import {
  createRoomAuthorizer,
  createSocketServer,
} from "../../../src/server/realtime/index.js";
import {
  LectureOperationCoordinator,
  LectureRepository,
  LectureSpeechService,
  readSpeechSourceConfig,
  TranscriptIngestor,
  TranscriptRepository,
} from "../../../src/server/classroom/index.js";
import {
  createFixtureSupabaseClient,
  FIXTURE_IDS,
} from "./helpers/socket-fixture.js";

const runLive =
  process.env.INTEGRATION_MODE === "live" &&
  Boolean(process.env.ZOOM_CLIENT_ID?.trim());

const testOrSkip = runLive ? it : it.skip;

describe("ZoomLive", () => {
  describe("Offline HMAC integrity & absent-credential checks", () => {
    const fixedSecret = "zoom-live-verification-secret";
    const fixedTimestamp = "1792843200";
    const fixedBody =
      '{ "event": "meeting.rtms_started", "payload": { "meeting_uuid": "p7-b-01" } }';
    const fixedSignature =
      "v0=5e6f45f9a14d9a0c2811f38a5f3cc2f49d30b9f51944676d12f7976c12ec9839";

    const fixedClock: Clock = {
      now: () => new Date("2026-10-24T12:00:00.000Z"),
      nowISO: () => "2026-10-24T12:00:00.000Z",
    };

    it("accepts known-answer HMAC vector and rejects tampered bodies, whitespace, or signatures", () => {
      const adapter = createZoomAdapter({
        mode: "live",
        clock: fixedClock,
        webhookSecret: fixedSecret,
        persistRefreshToken: async () => {
          throw new Error("unexpected persistence");
        },
      });

      expect(
        adapter.validateWebhookSignature(
          fixedBody,
          fixedSignature,
          fixedTimestamp,
        ),
      ).toBe(true);

      expect(
        adapter.validateWebhookSignature(
          fixedBody + " ",
          fixedSignature,
          fixedTimestamp,
        ),
      ).toBe(false);

      const reserialized = JSON.stringify(JSON.parse(fixedBody));
      expect(
        adapter.validateWebhookSignature(
          reserialized,
          fixedSignature,
          fixedTimestamp,
        ),
      ).toBe(false);

      const mutatedSig = fixedSignature.slice(0, -1) + "0";
      expect(
        adapter.validateWebhookSignature(
          fixedBody,
          mutatedSig,
          fixedTimestamp,
        ),
      ).toBe(false);
    });

    it("rejects signatures outside the 300-second freshness window or with absent secret", () => {
      const driftedClock: Clock = {
        now: () => new Date("2026-10-24T12:05:01.000Z"), // 301 seconds later
        nowISO: () => "2026-10-24T12:05:01.000Z",
      };

      const driftedAdapter = createZoomAdapter({
        mode: "live",
        clock: driftedClock,
        webhookSecret: fixedSecret,
        persistRefreshToken: async () => {
          throw new Error("unexpected persistence");
        },
      });

      expect(
        driftedAdapter.validateWebhookSignature(
          fixedBody,
          fixedSignature,
          fixedTimestamp,
        ),
      ).toBe(false);

      const noSecretAdapter = createZoomAdapter({
        mode: "live",
        clock: fixedClock,
        webhookSecret: "",
        persistRefreshToken: async () => {
          throw new Error("unexpected persistence");
        },
      });

      expect(
        noSecretAdapter.validateWebhookSignature(
          fixedBody,
          fixedSignature,
          fixedTimestamp,
        ),
      ).toBe(false);
    });

    it.each([
      { zoomClientId: "", zoomClientSecret: "secret", zoomRefreshToken: "token", missing: "zoomClientId" },
      { zoomClientId: "client", zoomClientSecret: "", zoomRefreshToken: "token", missing: "zoomClientSecret" },
      { zoomClientId: "client", zoomClientSecret: "secret", zoomRefreshToken: "", missing: "zoomRefreshToken" },
    ])("rejects createMeeting with 503 SERVICE_UNAVAILABLE when $missing is absent", async (auth) => {
      const adapter = createZoomAdapter({
        mode: "live",
        clock: fixedClock,
        fetch: async () => {
          throw new Error("network transport must not be invoked for missing credentials");
        },
        persistRefreshToken: async () => {
          throw new Error("persistence must not be invoked for missing credentials");
        },
      });

      await expect(
        adapter.createMeeting(
          auth,
          "Spark P7-B-01 Verification",
          "2026-10-24T13:00:00.000Z",
          30,
        ),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it.each([
      { clientId: "", clientSecret: "secret", missing: "clientId" },
      { clientId: "client", clientSecret: "", missing: "clientSecret" },
    ])("rejects runZoomRtms with 503 SERVICE_UNAVAILABLE when $missing is absent", async ({ clientId, clientSecret }) => {
      const controller = new AbortController();
      await expect(
        runZoomRtms(
          {
            classroom: {
              ingestTranscriptChunk: async () => ({
                id: "77777777-7777-4777-8777-777777777771",
                lectureId: "66666666-6666-4666-8666-666666666661",
                text: "test",
                timestampSec: 0,
                detectedConceptIds: [],
                createdAt: "2026-10-24T12:00:00.000Z",
              }),
            },
            actor: {
              userId: "11111111-1111-4111-8111-111111111111",
              authId: "11111111-1111-4111-8111-111111111111",
              email: "teacher@example.edu",
              name: "Prof. Test",
              role: "teacher",
              teacherId: "22222222-2222-4222-8222-222222222221",
              enrolledCourses: [],
            },
            lecture: {
              id: "66666666-6666-4666-8666-666666666661",
              courseId: "55555555-5555-4555-8555-555555555551",
              title: "Test Lecture",
              status: "live",
              startedAt: "2026-10-24T12:00:00.000Z",
            },
            meetingUuid: "valid-meeting-uuid",
            rtmsStreamId: "valid-stream-id",
            serverUrl: "wss://zoom.us/rtms/signaling",
            clientId,
            clientSecret,
            createWebSocket: () => {
              throw new Error("network transport must not be invoked for missing credentials");
            },
          },
          controller.signal,
          () => {},
        ),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });
  });

  describe("Authentic Zoom provider verification", () => {
    testOrSkip(
      "creates authentic Zoom meeting, reads back from provider API, and cleans up [gate: ZOOM_CLIENT_ID & INTEGRATION_MODE=live]",
      async () => {
        const authToken = process.env.ZOOM_LIVE_AUTH_TOKEN?.trim();
        const courseId = process.env.ZOOM_LIVE_COURSE_ID?.trim();
        const supabaseUrl = process.env.SUPABASE_URL?.trim();
        const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
        const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();

        if (
          !authToken ||
          !courseId ||
          !supabaseUrl ||
          !anonKey ||
          !serviceKey ||
          !encryptionKey
        ) {
          throw new Error(
            "Live Zoom meeting test requires ZOOM_LIVE_AUTH_TOKEN, ZOOM_LIVE_COURSE_ID, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and CREDENTIAL_ENCRYPTION_KEY",
          );
        }

        const env = {
          ...process.env,
          INTEGRATION_MODE: "live",
        };

        const clients = createSupabaseClients(env);
        const authGateway = createAuthGateway(clients.authClient, clients.databaseClient);
        const actor = await authGateway.verifyToken(authToken);

        if (actor.role !== "teacher" || !actor.teacherId) {
          throw new Error("ZOOM_LIVE_AUTH_TOKEN must resolve to a verified teacher actor");
        }

        const courseRepo = new CourseRepository(clients.databaseClient);
        const idGen = new CryptoIdGenerator();
        const courseService = new CourseService(courseRepo, idGen);
        const course = await courseService.getCourse(actor, courseId);

        if (course.teacherId !== actor.teacherId) {
          throw new Error("ZOOM_LIVE_COURSE_ID must belong to the authenticated teacher");
        }

        const clock: Clock = {
          now: () => new Date(),
          nowISO: () => new Date().toISOString(),
        };

        let capturedBearerToken: string | null = null;
        const instrumentedFetch: typeof globalThis.fetch = async (input, init) => {
          const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (
            urlStr === "https://api.zoom.us/v2/users/me/meetings" &&
            init?.method === "POST" &&
            init?.headers
          ) {
            const headers = new Headers(init.headers);
            const authHeader = headers.get("Authorization");
            if (authHeader && authHeader.startsWith("Bearer ")) {
              capturedBearerToken = authHeader.slice("Bearer ".length).trim();
            }
          }
          return globalThis.fetch(input, init);
        };

        const oauth = new ZoomOAuth({
          client: clients.databaseClient,
          env,
          clock,
        });

        const meetingService = new ZoomMeetingService({
          oauth,
          courses: courseService,
          env,
          clock,
          fetch: instrumentedFetch,
        });

        let createdMeetingId: string | null = null;
        let testError: unknown = null;
        let teardownError: unknown = null;

        try {
          const meetingStartTime = new Date(Date.now() + 3_600_000).toISOString();
          const result = await meetingService.createForCourse(
            actor,
            courseId,
            "Spark P7-B-01 verification",
            meetingStartTime,
            30,
          );

          createdMeetingId = result.meetingId;
          expect(createdMeetingId).toMatch(/^\d+$/);

          const parsedJoinUrl = new URL(result.joinUrl);
          expect(parsedJoinUrl.protocol).toBe("https:");
          const host = parsedJoinUrl.hostname.toLowerCase();
          const isZoomHost =
            host === "zoom.us" ||
            host.endsWith(".zoom.us") ||
            host === "zoom.com" ||
            host.endsWith(".zoom.com");
          expect(isZoomHost).toBe(true);
          expect(parsedJoinUrl.pathname).toBe(`/j/${createdMeetingId}`);

          if (!capturedBearerToken) {
            throw new Error("Bearer token for Zoom meeting creation was not captured");
          }

          const readbackResponse = await globalThis.fetch(
            `https://api.zoom.us/v2/meetings/${createdMeetingId}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${capturedBearerToken}`,
              },
              redirect: "error",
              signal: AbortSignal.timeout(10_000),
            },
          );

          expect(readbackResponse.status).toBe(200);
          const readbackSchema = z.object({
            id: z.union([z.number(), z.string()]),
            join_url: z.string().min(1),
          });
          const readbackJson: unknown = await readbackResponse.json();
          const readbackParsed = readbackSchema.parse(readbackJson);

          expect(String(readbackParsed.id)).toBe(createdMeetingId);
          expect(readbackParsed.join_url).toBe(result.joinUrl);
        } catch (err) {
          testError = err;
        } finally {
          if (createdMeetingId && capturedBearerToken) {
            try {
              const deleteResponse = await globalThis.fetch(
                `https://api.zoom.us/v2/meetings/${createdMeetingId}`,
                {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${capturedBearerToken}`,
                  },
                  redirect: "error",
                  signal: AbortSignal.timeout(10_000),
                },
              );
              if (deleteResponse.status !== 204) {
                teardownError = new Error(
                  `Failed to delete test meeting ${createdMeetingId}: status ${deleteResponse.status}`,
                );
              }
            } catch (delErr) {
              teardownError = delErr;
            }
          }
        }

        if (testError && teardownError) {
          throw new AggregateError(
            [testError, teardownError],
            "Live Zoom meeting test and teardown both failed",
          );
        }
        if (testError) throw testError;
        if (teardownError) throw teardownError;
      },
      45_000,
    );

    testOrSkip(
      "verifies signed RTMS event and authentic speech delivery via client Socket.IO [gate: ZOOM_CLIENT_ID & INTEGRATION_MODE=live]",
      async () => {
        const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim();
        const secretToken = process.env.ZOOM_SECRET_TOKEN?.trim();
        const rtmsEventRaw = process.env.ZOOM_LIVE_RTMS_EVENT?.trim();

        if (!clientSecret || !secretToken || !rtmsEventRaw) {
          throw new Error(
            "Live RTMS test requires ZOOM_CLIENT_SECRET, ZOOM_SECRET_TOKEN, and ZOOM_LIVE_RTMS_EVENT",
          );
        }

        const rtmsEnvelopeSchema = z.object({
          rawBody: z.string().min(1),
          signature: z.string().min(1),
          timestamp: z.string().min(1),
        });

        let envelopeParsed;
        try {
          envelopeParsed = rtmsEnvelopeSchema.parse(JSON.parse(rtmsEventRaw));
        } catch (parseErr) {
          throw new Error(
            "ZOOM_LIVE_RTMS_EVENT must be a valid JSON envelope { rawBody, signature, timestamp }",
            { cause: parseErr },
          );
        }

        const systemClock: Clock = {
          now: () => new Date(),
          nowISO: () => new Date().toISOString(),
        };

        const liveAdapter = createZoomAdapter({
          mode: "live",
          clock: systemClock,
          webhookSecret: secretToken,
          persistRefreshToken: async () => {},
        });

        const isValid = liveAdapter.validateWebhookSignature(
          envelopeParsed.rawBody,
          envelopeParsed.signature,
          envelopeParsed.timestamp,
        );
        expect(isValid).toBe(true);

        const tamperedValid = liveAdapter.validateWebhookSignature(
          envelopeParsed.rawBody + " ",
          envelopeParsed.signature,
          envelopeParsed.timestamp,
        );
        expect(tamperedValid).toBe(false);

        const payloadSchema = z.object({
          event: z.literal("meeting.rtms_started"),
          payload: z.object({
            meeting_uuid: z.string().min(1),
            rtms_stream_id: z.string().min(1),
            server_urls: z.string().min(1),
          }),
        });

        const parsedEvent = payloadSchema.safeParse(JSON.parse(envelopeParsed.rawBody));
        if (!parsedEvent.success) {
          throw new Error("ZOOM_LIVE_RTMS_EVENT rawBody does not contain required meeting.rtms_started fields");
        }

        const { meeting_uuid: meetingUuid, rtms_stream_id: rtmsStreamId, server_urls: serverUrl } =
          parsedEvent.data.payload;

        const transcriptChunksTable: Record<string, unknown>[] = [];
        const tableRows: Record<string, Record<string, unknown>[]> = {
          transcript_chunks: transcriptChunksTable,
          transcript_concepts: [],
          concept_nodes: [],
          lecture_sessions: [
            {
              id: FIXTURE_IDS.teacher1.lectureId,
              course_id: FIXTURE_IDS.teacher1.courseId,
              title: "Lecture 1",
              status: "live",
              started_at: new Date().toISOString(),
            },
          ],
        };

        const fixtureSupabase = createFixtureSupabaseClient({ tableRows });
        const authGateway = createAuthGateway(fixtureSupabase, fixtureSupabase);
        const roomAuthorizer = createRoomAuthorizer(fixtureSupabase);
        const lectureRepository = new LectureRepository(fixtureSupabase);
        const transcriptRepository = new TranscriptRepository(fixtureSupabase);

        const appServer = http.createServer();
        const { io, publisher, presence } = createSocketServer(appServer, {
          auth: authGateway,
          rooms: roomAuthorizer,
          lectures: lectureRepository,
        });

        const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<void>();
        appServer.listen(0, "127.0.0.1", () => listenResolve());
        await listenPromise;
        const appPort = (appServer.address() as AddressInfo).port;

        let clientSocket: ClientSocket | null = null;
        let speechService: LectureSpeechService | null = null;

        try {
          const ingestor = new TranscriptIngestor({
            lectures: lectureRepository,
            transcripts: transcriptRepository,
            rooms: roomAuthorizer,
            ai: { detectConcepts: async () => [] },
            presence,
            attendance: { recordChunkAttendance: async () => [] },
            publisher,
            ids: { generateId: () => crypto.randomUUID() },
            clock: systemClock,
            operations: new LectureOperationCoordinator(),
          });

          clientSocket = ioc(`http://127.0.0.1:${appPort}`, {
            auth: { token: FIXTURE_IDS.studentCourse1Only.token },
            transports: ["websocket"],
            reconnection: false,
          });

          const { promise: connectPromise, resolve: connectResolve, reject: connectReject } =
            Promise.withResolvers<void>();
          clientSocket.once("connect", () => connectResolve());
          clientSocket.once("connect_error", (err) => connectReject(err));
          await connectPromise;

          const { promise: joinPromise, resolve: joinResolve } = Promise.withResolvers<void>();
          clientSocket.emit(
            "lecture:join",
            { lectureId: FIXTURE_IDS.teacher1.lectureId },
            (res: { success?: boolean }) => {
              if (res?.success) joinResolve();
            },
          );
          await joinPromise;

          const teacherActor = await authGateway.verifyToken(FIXTURE_IDS.teacher1.token);

          const zoomSpeechConfig = readSpeechSourceConfig({
            INTEGRATION_MODE: "live",
            LECTURE_SOURCE: "zoom",
            ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID,
            ZOOM_CLIENT_SECRET: clientSecret,
          });

          speechService = new LectureSpeechService(
            {
              classroom: ingestor,
              lectures: lectureRepository,
              rooms: roomAuthorizer,
            },
            zoomSpeechConfig,
          );

          const targetPhrase = /gradient descent updates parameters/i;
          const matchingEvents: TranscriptChunkEvent[] = [];
          let accumulatedText = "";

          const { promise: speechReceivedPromise, resolve: speechReceivedResolve } =
            Promise.withResolvers<void>();

          clientSocket.on("transcript:chunk", (event: TranscriptChunkEvent) => {
            accumulatedText += (accumulatedText ? " " : "") + event.text;
            matchingEvents.push(event);
            if (targetPhrase.test(accumulatedText)) {
              speechReceivedResolve();
            }
          });

          await speechService.start(teacherActor, FIXTURE_IDS.teacher1.lectureId, {
            meetingUuid,
            rtmsStreamId,
            serverUrl,
          });

          const speechDeadline = AbortSignal.timeout(60_000);
          const { promise: timeoutPromise, reject: timeoutReject } =
            Promise.withResolvers<never>();
          speechDeadline.addEventListener(
            "abort",
            () => {
              timeoutReject(
                new Error(
                  `Timed out waiting for spoken phrase "${targetPhrase}". Accumulated: "${accumulatedText}"`,
                ),
              );
            },
            { once: true },
          );
          await Promise.race([speechReceivedPromise, timeoutPromise]);
          expect(matchingEvents.length).toBeGreaterThanOrEqual(1);
          for (const ev of matchingEvents) {
            expect(ev.isSimulated).toBe(false);
            expect(ev.lectureId).toBe(FIXTURE_IDS.teacher1.lectureId);
            expect(Number.isFinite(ev.timestampSec)).toBe(true);
            expect(ev.timestampSec).toBeGreaterThanOrEqual(0);
          }

          const storedChunks = await transcriptRepository.getRecentChunks(FIXTURE_IDS.teacher1.lectureId);
          const liveChunks = storedChunks.filter((c) => c.isSimulated === false);
          expect(liveChunks.length).toBeGreaterThanOrEqual(matchingEvents.length);
        } finally {
          if (speechService) {
            try {
              await speechService.dispose();
            } catch {
              // Ignore cleanup disposal errors
            }
          }
          if (clientSocket?.connected) {
            clientSocket.disconnect();
          }
          io.close();
          appServer.close();
        }
      },
      90_000,
    );
  });
});
