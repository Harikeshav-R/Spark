import "dotenv/config";
import http from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import express from "express";
import type { Express, Request, Response } from "express";
import type { Clock, IdGenerator, UUID } from "../src/contracts/common.js";
import next from "next";
import {
  CheckUnderstandingAi,
  DetectConceptsAi,
  EvaluatePollAi,
  ExtractGraphAi,
  GenerateLearningPageAi,
  GeneratePollAi,
  GenerateQuizAi,
  GenerateQuizHintsAi,
  OpenRouterClient,
  ResourceQaAi,
  SearchResourcesAi,
  SocraticTutorAi,
  SuggestInterventionsAi,
  SummarizeLectureAi,
} from "../src/server/ai/index.js";
import {
  LectureOperationCoordinator,
  LectureRepository,
  LectureService,
  LectureSpeechService,
  PollRepository,
  PollService,
  TeacherPollService,
  TranscriptIngestor,
  TranscriptRepository,
  createLectureRouter,
  createLectureSummaryRouter,
  createPollRouter,
  createTranscriptRouter,
  readSpeechSourceConfig,
} from "../src/server/classroom/index.js";
import {
  AttendanceEvidenceService,
  ConceptContextRepository,
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
  EnrollmentRepository,
  EnrollmentService,
  GraphRepository,
  HeatmapService,
  LearningEvidenceService,
  MasteryRepository,
  MasteryService,
  PollEvidenceService,
  createCourseEffortRouter,
  createCourseRouter,
  createGraphRouter,
  createHeatmapRouter,
  createSyllabusRouter,
  CourseEffortService,
  GameRepository,
  ConcreteGameService,
  createGameRouter,
  SyllabusIngestionService,
} from "../src/server/core/index.js";
import {
  EncounterRepository,
  EncounterService,
  LearningPageRepository,
  LearningPageService,
  LectureSummaryRepository,
  LectureSummaryService,
  QuizRepository,
  QuizService,
  TutoringRepository,
  TutoringService,
  createEncounterRouter,
  createLearningRouter,
  createTutoringRouter,
} from "../src/server/learning/index.js";
import {
  type AuthGateway,
  createAuthGateway,
  createAuthRouter,
  createSupabaseClients,
  apiErrorHandler,
} from "../src/server/platform/index.js";
import {
  type RealtimeSocketServer,
  createRoomAuthorizer,
  createSocketServer,
} from "../src/server/realtime/index.js";
import {
  AvailabilityService,
  MatchRepository,
  MessagingRepository,
  MessagingService,
  PoolRepository,
  Scheduler,
  SchedulerRepository,
  StudyGroupService,
  createStudyGroupRouter,
} from "../src/server/study-groups/index.js";
import {
  ZoomMeetingService,
  ZoomOAuth,
  createZoomRouter,
} from "../src/server/zoom/index.js";

export interface ServerDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  databaseClient: SupabaseClient;
  aiClient: OpenRouterClient;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
  origin?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  sessionClientFactory?: () => Pick<SupabaseClient, "auth">;
}

export interface ServerInstance {
  app: Express;
  httpServer: http.Server;
  io: RealtimeSocketServer;
  dispose: () => Promise<void>;
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
  const enrollment = new EnrollmentService(
    new EnrollmentRepository(dependencies.databaseClient)
  );

  app.use(
    createAuthRouter({
      auth: dependencies.auth,
      courses,
      env: dependencies.env,
      sessionClientFactory: dependencies.sessionClientFactory,
    })
  );

  app.use(
    createCourseRouter({
      auth: dependencies.auth,
      courses,
      enrollment,
    })
  );

  const syllabusIngestion = new SyllabusIngestionService(
    dependencies.databaseClient,
    courses,
    new ExtractGraphAi(dependencies.aiClient)
  );
  app.use(
    createSyllabusRouter({
      auth: dependencies.auth,
      courses,
      syllabusIngestion,
    })
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
  const courseEffort = new CourseEffortService({
    client: dependencies.databaseClient,
    courses,
    heatmap,
  });
  app.use(
    createCourseEffortRouter({
      auth: dependencies.auth,
      game: courseEffort,
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
  const gameRepository = new GameRepository(dependencies.databaseClient);
  const gameService = new ConcreteGameService({
    repository: gameRepository,
    courses,
    graph: graphRepository,
    mastery,
    courseEffort,
    publisher,
    clock: dependencies.clock,
    ids: dependencies.ids,
  });
  app.use(
    createGameRouter({
      auth: dependencies.auth,
      game: gameService,
    })
  );

  const learningEvidence = new LearningEvidenceService(
    dependencies.databaseClient,
    courses,
    mastery
  );
  const learningPageRepository = new LearningPageRepository(dependencies.databaseClient);
  const quizRepository = new QuizRepository(dependencies.databaseClient);
  const tutoringRepository = new TutoringRepository(dependencies.databaseClient);
  const encounterRepository = new EncounterRepository(dependencies.databaseClient);
  const conceptContext = new ConceptContextRepository(dependencies.databaseClient, courses);

  const generateQuizAi = new GenerateQuizAi(dependencies.aiClient);
  const generateQuizHintsAi = new GenerateQuizHintsAi(dependencies.aiClient);
  const generateLearningPageAi = new GenerateLearningPageAi(dependencies.aiClient);
  const searchResourcesAi = new SearchResourcesAi(dependencies.aiClient);
  const resourceQaAi = new ResourceQaAi(dependencies.aiClient);

  const createQuizService = (courseId: UUID) => {
    return new QuizService({
      courseId,
      topology: graphRepository,
      repository: quizRepository,
      ai: generateQuizAi,
      evidence: learningEvidence,
    });
  };

  const createLearningPageService = (courseId: UUID) => {
    return new LearningPageService({
      courseId,
      topology: graphRepository,
      repository: learningPageRepository,
      ai: generateLearningPageAi,
    });
  };

  const tutoringService = new TutoringService({
    repository: tutoringRepository,
    ai: new SocraticTutorAi(dependencies.aiClient),
    understandingChecker: new CheckUnderstandingAi(dependencies.aiClient),
    mastery,
    ids: new CryptoIdGenerator(),
    clock: dependencies.clock,
  });

  const createEncounterService = (courseId: UUID) => {
    return new EncounterService({
      courseId,
      topology: graphRepository,
      quizzes: createQuizService(courseId),
      questions: quizRepository,
      hints: generateQuizHintsAi,
      repository: encounterRepository,
      evidence: learningEvidence,
      game: gameService,
      gameRepository,
      mastery,
      clock: dependencies.clock,
      ids: new CryptoIdGenerator(),
    });
  };

  app.use(
    createLearningRouter({
      auth: dependencies.auth,
      conceptContext,
      createLearningPageService,
      createQuizService,
      searchResourcesAi,
      resourceQaAi,
    })
  );

  app.use(
    createTutoringRouter({
      auth: dependencies.auth,
      conceptContext,
      tutoringService,
      tutoringRepository,
    })
  );

  app.use(
    createEncounterRouter({
      auth: dependencies.auth,
      conceptContext,
      encounterRepository,
      createEncounterService,
    })
  );
  const coordinator = new LectureOperationCoordinator();

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
    operations: coordinator,
  });
  app.use(
    createTranscriptRouter({
      auth: dependencies.auth,
      classroom: transcriptIngestor,
    })
  );
  const speechConfig = readSpeechSourceConfig(dependencies.env ?? process.env);
  const speech = new LectureSpeechService(
    {
      classroom: transcriptIngestor,
      lectures: lectureRepository,
      rooms,
    },
    speechConfig
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
      operations: coordinator,
      stopSpeech: async (lectureId) => {
        await speech.stop(lectureId);
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

  const interventionsAi = new SuggestInterventionsAi(dependencies.aiClient);

  app.use(
    createLectureRouter({
      auth: dependencies.auth,
      courses,
      lectures: lectureRepository,
      lectureService,
      polls: pollRepository,
      transcripts: transcriptRepository,
      rooms,
      speech,
      interventionsAi,
      pollRepository,
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
  const env = dependencies.env ?? process.env;

  const zoomOAuth = new ZoomOAuth({
    client: dependencies.databaseClient,
    env,
    clock: dependencies.clock,
  });

  const zoomMeetingService = new ZoomMeetingService({
    oauth: zoomOAuth,
    courses,
    env,
    clock: dependencies.clock,
    webhookSecret: env.ZOOM_SECRET_TOKEN,
  });

  app.use(
    createZoomRouter({
      auth: dependencies.auth,
      oauth: zoomOAuth,
      env,
    })
  );

  const poolRepository = new PoolRepository(dependencies.databaseClient);
  const matchRepository = new MatchRepository(dependencies.databaseClient);
  const studyGroupService = new StudyGroupService({
    courses,
    pool: poolRepository,
    matches: matchRepository,
    publisher,
    clock: dependencies.clock,
    ids: new CryptoIdGenerator(),
  });

  const messagingRepository = new MessagingRepository(dependencies.databaseClient);
  const messagingService = new MessagingService({
    repository: messagingRepository,
    publisher,
    clock: dependencies.clock,
    ids: new CryptoIdGenerator(),
  });

  const schedulerRepository = new SchedulerRepository(dependencies.databaseClient);
  const scheduler = new Scheduler({
    membership: messagingRepository,
    repository: schedulerRepository,
    meetings: zoomMeetingService,
    publisher,
    clock: dependencies.clock,
    ids: new CryptoIdGenerator(),
  });

  const availabilityService = new AvailabilityService({
    courses,
    repository: schedulerRepository,
  });

  app.use(
    createStudyGroupRouter({
      auth: dependencies.auth,
      studyGroups: studyGroupService,
      messaging: messagingService,
      membership: messagingRepository,
      scheduler,
      schedulerRepository,
      availability: availabilityService,
    })
  );

  app.use(apiErrorHandler);
  const dispose = async (): Promise<void> => {
    await speech.dispose();
    io.close();
    const { promise, resolve } = Promise.withResolvers<void>();
    httpServer.close(() => resolve());
    await promise;
  };

  return { app, httpServer, io, dispose };
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
    env: process.env,
    sessionClientFactory: () => supabase.authClient,
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
  const shutdown = async () => {
    console.log("[server] Shutting down gracefully...");
    await instance.dispose();
    console.log("[server] HTTP and WebSocket server closed.");
    process.exit(0);
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
