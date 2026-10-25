import "dotenv/config";
import http from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import express from "express";
import type { Express, Request, Response } from "express";
import type { Clock, IdGenerator } from "../src/contracts/common.js";
import next from "next";
import {
  DetectConceptsAi,
  EvaluatePollAi,
  GeneratePollAi,
  OpenRouterClient,
  SummarizeLectureAi,
} from "../src/server/ai/index.js";
import {
  LectureRepository,
  LectureService,
  PollRepository,
  PollService,
  TeacherPollService,
  TranscriptIngestor,
  TranscriptRepository,
  createLectureRouter,
  createLectureSummaryRouter,
  createPollRouter,
  createTranscriptRouter,
} from "../src/server/classroom/index.js";
import {
  AttendanceEvidenceService,
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
  GraphRepository,
  HeatmapService,
  MasteryRepository,
  MasteryService,
  PollEvidenceService,
  createGraphRouter,
  createHeatmapRouter,
} from "../src/server/core/index.js";
import {
  LectureSummaryRepository,
  LectureSummaryService,
} from "../src/server/learning/index.js";
import {
  type AuthGateway,
  createAuthGateway,
  createSupabaseClients,
} from "../src/server/platform/index.js";
import {
  type RealtimeSocketServer,
  createRoomAuthorizer,
  createSocketServer,
} from "../src/server/realtime/index.js";

export interface ServerDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  databaseClient: SupabaseClient;
  aiClient: OpenRouterClient;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
  origin?: string;
}

export interface ServerInstance {
  app: Express;
  httpServer: http.Server;
  io: RealtimeSocketServer;
}

export function createServer(dependencies: ServerDependencies): ServerInstance {
  const app = express();
  app.use(express.json());

  // Base preflight healthcheck endpoint
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  const httpServer = http.createServer(app);

  const rooms = createRoomAuthorizer(dependencies.databaseClient);
  const lectureRepository = new LectureRepository(dependencies.databaseClient);
  const transcriptRepository = new TranscriptRepository(
    dependencies.databaseClient
  );

  const { io, publisher, presence } = createSocketServer(httpServer, {
    auth: dependencies.auth,
    rooms,
    lectures: lectureRepository,
    origin:
      dependencies.origin ?? process.env.APP_ORIGIN ?? "http://localhost:3000",
  });

  const courseRepository = new CourseRepository(dependencies.databaseClient);
  const courses = new CourseService(
    courseRepository,
    new CryptoIdGenerator()
  );
  const heatmap = new HeatmapService({
    client: dependencies.databaseClient,
    courses,
    publisher,
    clock: dependencies.clock,
    ids: dependencies.ids,
  });
  const masteryRepository = new MasteryRepository(dependencies.databaseClient);
  const mastery = new MasteryService(
    masteryRepository,
    (actor, studentId, conceptId) =>
      heatmap.afterEvidenceApplied(actor, studentId, conceptId)
  );
  app.use(
    createHeatmapRouter({
      auth: dependencies.auth,
      heatmap,
    })
  );

  const graphRepository = new GraphRepository(
    dependencies.databaseClient,
    courseRepository
  );
  app.use(
    createGraphRouter({
      auth: dependencies.auth,
      courses: courseRepository,
      graphRepository,
      masteryRepository,
    })
  );
  const attendance = new AttendanceEvidenceService(
    dependencies.databaseClient,
    courses,
    mastery
  );
  const transcriptIngestor = new TranscriptIngestor({
    lectures: lectureRepository,
    transcripts: transcriptRepository,
    rooms,
    ai: new DetectConceptsAi(dependencies.aiClient),
    presence,
    attendance,
    publisher,
    ids: dependencies.ids,
    clock: dependencies.clock,
  });
  app.use(
    createTranscriptRouter({
      auth: dependencies.auth,
      classroom: transcriptIngestor,
    })
  );

  const summaryRepository = new LectureSummaryRepository(
    dependencies.databaseClient
  );
  const summarizer = new SummarizeLectureAi(dependencies.aiClient);

  const summaryService = new LectureSummaryService({
    classroom: {
      getLecture: (id) => lectureRepository.getLecture(id),
      getLectureTranscript: (id) =>
        transcriptRepository.getLectureTranscript(id),
      getCandidateConcepts: (courseId) =>
        transcriptRepository.getCandidateConcepts(courseId),
    },
    rooms,
    repository: summaryRepository,
    summarizer,
    publisher,
    clock: dependencies.clock,
    ids: dependencies.ids,
  });

  const lectureService = new LectureService(
    lectureRepository,
    dependencies.ids,
    dependencies.clock,
    {
      rooms,
      publisher,
      summarize: async (actor, lectureId) => {
        await summaryService.generateForLecture(actor, lectureId);
      },
    }
  );

  const lectureSummaryRouter = createLectureSummaryRouter({
    auth: dependencies.auth,
    classroom: lectureService,
    summaries: summaryService,
  });
  app.use(lectureSummaryRouter);

  const pollRepository = new PollRepository(dependencies.databaseClient);
  const pollEvidenceService = new PollEvidenceService(
    dependencies.databaseClient,
    courses,
    mastery
  );
  const pollService = new PollService({
    polls: pollRepository,
    rooms,
    presence,
    ai: new EvaluatePollAi(dependencies.aiClient),
    evidence: pollEvidenceService,
    publisher,
    ids: dependencies.ids,
    clock: dependencies.clock,
  });

  const teacherPollService = new TeacherPollService({
    lectures: lectureRepository,
    rooms,
    graph: graphRepository,
    transcripts: transcriptRepository,
    ai: new GeneratePollAi(dependencies.aiClient),
    polls: pollRepository,
    clock: dependencies.clock,
    ids: dependencies.ids,
  });

  app.use(
    createLectureRouter({
      auth: dependencies.auth,
      courses,
      lectures: lectureRepository,
      lectureService,
      polls: pollRepository,
      transcripts: transcriptRepository,
      rooms,
    })
  );

  app.use(
    createPollRouter({
      auth: dependencies.auth,
      polls: pollService,
      teacherPolls: teacherPollService,
      pollRepo: pollRepository,
    })
  );

  return { app, httpServer, io };
}

export async function startServer(
  port = Number(process.env.PORT) || 3000
): Promise<ServerInstance> {
  const supabase = createSupabaseClients(process.env);
  const auth = createAuthGateway(
    supabase.authClient,
    supabase.databaseClient
  );
  const aiClient = new OpenRouterClient({ env: process.env });
  const ids = new CryptoIdGenerator();
  const clock: Clock = {
    now: () => new Date(),
    nowISO: () => new Date().toISOString(),
  };

  const instance = createServer({
    auth,
    databaseClient: supabase.databaseClient,
    aiClient,
    clock,
    ids,
  });

  // Attach Next.js custom server after Express API routers
  const nextApp = next({
    dev: process.env.NODE_ENV !== "production",
  });
  await nextApp.prepare();
  const nextHandler = nextApp.getRequestHandler();

  instance.app.all(/^\/api(\/.*)?$/, (_req: Request, res: Response) => {
    res.status(404).json({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "API endpoint not found",
    });
  });

  instance.app.use((req: Request, res: Response) => {
    return nextHandler(req, res);
  });

  const { promise, resolve } = Promise.withResolvers<ServerInstance>();

  instance.httpServer.listen(port, () => {
    console.log(
      `[server] Spark composition root running on http://localhost:${port}`
    );
    resolve(instance);
  });
  const shutdown = () => {
    console.log("[server] Shutting down gracefully...");
    instance.io.close();
    instance.httpServer.close(() => {
      console.log("[server] HTTP and WebSocket server closed.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return promise;
}

// Direct execution guard
if (
  process.env.NODE_ENV !== "test" &&
  process.argv[1]?.replace(/\\/g, "/").endsWith("server/index.ts")
) {
  void startServer();
}
