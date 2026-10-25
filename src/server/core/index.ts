export {
  CourseRepository,
  type CourseDatabaseClientPort,
} from "./courses/course-repository";

export {
  CourseService,
} from "./courses/course-service";

export {
  createCourseRouter,
  type CourseRouterDependencies,
} from "./courses/course-router";

export {
  ConceptContextRepository,
  type ConceptContext,
} from "./courses/concept-context-repository";

export {
  CryptoIdGenerator,
} from "./id-generator";

export {
  EnrollmentRepository,
} from "./enrollment/enrollment-repository";

export {
  EnrollmentService,
} from "./enrollment/enrollment-service";

export {
  MasteryRepository,
} from "./mastery/mastery-repository";

export {
  MasteryService,
  type MasteryEvidenceObserver,
} from "./mastery/mastery-service";

export {
  HeatmapService,
  type HeatmapServiceDependencies,
} from "./mastery/heatmap-service";

export {
  type HeatmapRouterDependencies,
  createHeatmapRouter,
} from "./mastery/heatmap-router";
export {
  CourseEffortService,
  type CourseEffortServiceDependencies,
} from "./game/course-effort-service";

export {
  createCourseEffortRouter,
  type CourseEffortRouterDependencies,
} from "./game/course-effort-router";


export {
  type AttendanceEvidenceResult,
  AttendanceEvidenceService,
} from "./mastery/attendance-evidence";

export {
  type PollEvidenceResult,
  PollEvidenceService,
} from "./mastery/poll-evidence";

export {
  type LearningEvidenceResult,
  LearningEvidenceService,
} from "./mastery/learning-evidence";

export {
  type GraphNodeInput,
  topologicalSort,
  validateGraph,
} from "./graph/graph-validator";

export {
  calculateNodeImportance,
} from "./graph/importance-calculator";

export {
  GraphRepository,
} from "./graph/graph-repository";

export {
  GraphService,
} from "./graph/graph-service";

export {
  createGraphRouter,
  type GraphRouterDependencies,
} from "./graph/graph-router";

export {
  MAX_SYLLABUS_BYTES,
  MAX_SYLLABUS_PAGES,
  type ProcessedSyllabusPdf,
  assertSyllabusSize,
  hashSyllabusPdf,
  processSyllabusPdf,
} from "./ingestion/pdf-processor";

export {
  type SyllabusGraphExtractor,
  SyllabusIngestionService,
} from "./ingestion/syllabus-ingestion-service";

export {
  createSyllabusRouter,
  type SyllabusRouterDependencies,
} from "./ingestion/syllabus-router";

export {
  GameRepository,
  type DailyQuestRecord,
  type StudentRecord,
  type PracticeRewardRpcResult,
} from "./game/game-repository";

export {
  ConcreteGameService,
  type GameServiceDependencies,
  type PracticeRewardResult,
  calculateStreakDays,
  calculateMascotEvolution,
} from "./game/game-service";

export {
  createGameRouter,
  type GameRouterDependencies,
} from "./game/game-router";

export {
  isConceptReady,
  computeReviewState,
  selectDailyQuestCandidates,
  hydrateDailyQuestItems,
  type ReviewState,
  type SelectDailyQuestCandidatesInput,
} from "./game/daily-quest-generator";

export {
  calculateEclipse,
  type EclipseCalculationInput,
} from "./game/eclipse-service";
