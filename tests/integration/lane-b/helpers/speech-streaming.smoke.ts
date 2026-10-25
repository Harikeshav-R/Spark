import http from "node:http";
import { type AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { createAuthGateway } from "../../../../src/server/platform/index.js";
import { createRoomAuthorizer } from "../../../../src/server/realtime/room-authorizer.js";
import { createSocketServer } from "../../../../src/server/realtime/index.js";
import {
  LectureRepository,
  TranscriptRepository,
  TranscriptIngestor,
  LectureSpeechService,
  readSpeechSourceConfig,
} from "../../../../src/server/classroom/index.js";
import {
  createFixtureSupabaseClient,
  FIXTURE_IDS,
} from "./socket-fixture.js";
import type { TranscriptChunkEvent } from "../../../../src/contracts/realtime.js";

// Dynamically resolve ws from engine.io for smoke provider only
const req = createRequire(import.meta.resolve("engine.io"));
interface MockServerWebSocket {
  send(data: string): void;
  on(event: string, listener: (data: Buffer) => void): void;
  close(): void;
}

interface MockWebSocketServer {
  on(event: string, listener: (ws: MockServerWebSocket, req: http.IncomingMessage) => void): void;
}

const { WebSocketServer } = req("ws") as {
  WebSocketServer: new (options: { server: http.Server }) => MockWebSocketServer;
};

async function runSmoke(): Promise<void> {
  console.log("=== P3-B-04 Speech Streaming Smoke Verification ===");

  const transcriptChunksTable: Record<string, unknown>[] = [];
  const transcriptConceptsTable: Record<string, unknown>[] = [];
  const conceptNodesTable: Record<string, unknown>[] = [
    {
      id: "99999999-9999-4999-8999-999999999991",
      course_id: FIXTURE_IDS.teacher1.courseId,
      label: "Gradient Descent",
    },
  ];

  const tableRows: Record<string, Record<string, unknown>[]> = {
    transcript_chunks: transcriptChunksTable,
    transcript_concepts: transcriptConceptsTable,
    concept_nodes: conceptNodesTable,
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
  let mockZoomHttpServer: http.Server | null = null;
  let signalingConn: MockServerWebSocket | null = null;
  let mediaConn: MockServerWebSocket | null = null;
  try {
    const ingestor = new TranscriptIngestor({
      lectures: lectureRepository,
      transcripts: transcriptRepository,
      rooms: roomAuthorizer,
      ai: { detectConcepts: async () => [] },
      presence,
      attendance: { recordChunkAttendance: async () => [] },
      publisher,
      ids: {
        generateId: () => crypto.randomUUID(),
      },
      clock: {
        now: () => new Date(),
        nowISO: () => new Date().toISOString(),
      },
    });

    // 1. Connect student socket to receive broadcasts
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

    // --- Part A: Simulator Smoke (default 4-second cadence) ---
    console.log("-> Testing simulator speech source...");
    const simConfig = readSpeechSourceConfig({
      INTEGRATION_MODE: "fixture",
      LECTURE_SOURCE: "simulator",
      DEMO_TICK_RATE_MS: "4000",
    });

    const simService = new LectureSpeechService(
      {
        classroom: ingestor,
        lectures: lectureRepository,
        rooms: roomAuthorizer,
      },
      simConfig,
    );

    const receivedSimEvents: TranscriptChunkEvent[] = [];
    clientSocket.on("transcript:chunk", (data: TranscriptChunkEvent) => {
      receivedSimEvents.push(data);
    });

    const simHandle = await simService.start(teacherActor, FIXTURE_IDS.teacher1.lectureId);

    // Wait for first 2 simulator events (at ~4s and ~8s)
    const { promise: twoEventsPromise, resolve: twoEventsResolve } = Promise.withResolvers<void>();
    const checkInterval = setInterval(() => {
      if (receivedSimEvents.length >= 2) {
        clearInterval(checkInterval);
        twoEventsResolve();
      }
    }, 200);

    await twoEventsPromise;
    await simHandle.stop();
    await simService.dispose();

    console.log(`   Simulator emitted ${receivedSimEvents.length} events.`);
    if (receivedSimEvents[0].isSimulated !== true || receivedSimEvents[1].isSimulated !== true) {
      throw new Error("Simulator socket events did not contain isSimulated: true");
    }
    if (receivedSimEvents[0].timestampSec !== 0 || receivedSimEvents[1].timestampSec !== 4) {
      throw new Error(
        `Unexpected simulator timestamps: ${receivedSimEvents[0].timestampSec}, ${receivedSimEvents[1].timestampSec}`,
      );
    }

    const simRows = transcriptChunksTable.filter((r) => r.is_simulated === true);
    if (simRows.length < 2) {
      throw new Error(`Expected at least 2 simulated rows, found ${simRows.length}`);
    }
    console.log("   [PASS] Simulator smoke verified: 2 chunks persisted and broadcast with isSimulated: true");

    // --- Part B: Zoom RTMS Provider Smoke ---
    console.log("-> Testing Zoom RTMS provider smoke...");
    mockZoomHttpServer = http.createServer();
    const wss = new WebSocketServer({ server: mockZoomHttpServer });

    const { promise: zoomListenPromise, resolve: zoomListenResolve } = Promise.withResolvers<void>();
    mockZoomHttpServer.listen(0, "127.0.0.1", () => zoomListenResolve());
    await zoomListenPromise;
    const zoomPort = (mockZoomHttpServer.address() as AddressInfo).port;

  signalingConn = null;
  mediaConn = null;
    let signalingHandshakeSignature: string | null = null;
    let mediaHandshakeReceived = false;

    wss.on("connection", (ws: MockServerWebSocket, req: http.IncomingMessage) => {
      const url = req.url ?? "";
      if (url.includes("/signaling")) {
        signalingConn = ws;
        ws.on("message", (raw: Buffer) => {
          const msg = JSON.parse(raw.toString());
          if (msg.msg_type === 1) {
            signalingHandshakeSignature = msg.signature;
            // Send msg_type 2 with transcript media URL
            ws.send(
              JSON.stringify({
                msg_type: 2,
                status: 0,
                media_server: {
                  server_urls: {
                    transcript: "wss://zoom.us/rtms/media/transcript",
                  },
                },
              }),
            );
          } else if (msg.msg_type === 12) {
            ws.send(JSON.stringify({ msg_type: 13, timestamp: msg.timestamp }));
          }
        });
      } else if (url.includes("/media")) {
        mediaConn = ws;
        ws.on("message", (raw: Buffer) => {
          const msg = JSON.parse(raw.toString());
          if (msg.msg_type === 3) {
            mediaHandshakeReceived = true;
            // Send msg_type 4
            ws.send(JSON.stringify({ msg_type: 4, status: 0 }));
          } else if (msg.msg_type === 12) {
            ws.send(JSON.stringify({ msg_type: 13, timestamp: msg.timestamp }));
          }
        });
      }
    });

    const zoomConfig = readSpeechSourceConfig({
      INTEGRATION_MODE: "live",
      LECTURE_SOURCE: "zoom",
      ZOOM_CLIENT_ID: "smoke-client-id",
      ZOOM_CLIENT_SECRET: "smoke-client-secret",
    });

    const zoomService = new LectureSpeechService(
      {
        classroom: ingestor,
        lectures: lectureRepository,
        rooms: roomAuthorizer,
        createWebSocket: (url: string) => {
          // Route valid Zoom-shaped URL to local mock provider
          const targetPath = url.includes("media") ? "/media/transcript" : "/signaling";
          return new WebSocket(`ws://127.0.0.1:${zoomPort}${targetPath}`);
        },
      },
      zoomConfig,
    );

    const receivedZoomEvents: TranscriptChunkEvent[] = [];
    clientSocket.off("transcript:chunk");
    clientSocket.on("transcript:chunk", (data: TranscriptChunkEvent) => {
      receivedZoomEvents.push(data);
    });

    const zoomHandle = await zoomService.start(teacherActor, FIXTURE_IDS.teacher1.lectureId, {
      meetingUuid: "smoke-meeting-uuid",
      rtmsStreamId: "smoke-stream-id",
      serverUrl: "wss://zoom.us/rtms/signaling",
    });

    if (!signalingHandshakeSignature) {
      throw new Error("Zoom RTMS signaling handshake was not received");
    }
    if (!mediaHandshakeReceived) {
      throw new Error("Zoom RTMS media handshake was not received");
    }

    // Send audio transcript frame via media socket
    const lecture = await lectureRepository.getLecture(FIXTURE_IDS.teacher1.lectureId);
    const lectureStartEpoch = Date.parse(lecture.startedAt);

    mediaConn.send(
      JSON.stringify({
        msg_type: 17,
        content: {
          data: "Stochastic gradient descent updates parameters using single training examples.",
          user_name: "Prof. Chen",
          timestamp: lectureStartEpoch + 6250, // 6.25 seconds
        },
      }),
    );

    const { promise: zoomEventPromise, resolve: zoomEventResolve } = Promise.withResolvers<void>();
    const zoomCheck = setInterval(() => {
      if (receivedZoomEvents.length >= 1) {
        clearInterval(zoomCheck);
        zoomEventResolve();
      }
    }, 100);

    await zoomEventPromise;
    await zoomHandle.stop();
    await zoomService.dispose();

    console.log(`   Zoom RTMS emitted ${receivedZoomEvents.length} events.`);
    const zoomEvent = receivedZoomEvents[0];
    if (zoomEvent.isSimulated !== false) {
      throw new Error("Zoom socket event did not contain isSimulated: false");
    }
    if (zoomEvent.timestampSec !== 6.25) {
      throw new Error(`Unexpected Zoom timestampSec: ${zoomEvent.timestampSec} (expected 6.25)`);
    }

    const zoomRows = transcriptChunksTable.filter((r) => r.is_simulated === false);
    if (zoomRows.length < 1) {
      throw new Error("Expected at least 1 Zoom row with is_simulated: false");
    }
    console.log("   [PASS] Zoom RTMS smoke verified: authentic transcript persisted and broadcast with isSimulated: false");

    console.log("=== All Smoke Checks PASSED Cleanly ===");
  } finally {
    if (signalingConn) {
      signalingConn.close();
    }
    if (mediaConn) {
      mediaConn.close();
    }
    if (clientSocket?.connected) {
      clientSocket.disconnect();
    }
    io.close();
    appServer.close();
    if (mockZoomHttpServer) {
      mockZoomHttpServer.close();
    }
  }
}

runSmoke().catch((err) => {
  console.error("FATAL SMOKE ERROR:", err);
  process.exit(1);
});
