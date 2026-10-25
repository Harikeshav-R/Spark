export {
  CourseRepository,
  type CourseDatabaseClientPort,
} from "./courses/course-repository";

export {
  CourseService,
} from "./courses/course-service";

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
  type CourseHeatmapSnapshot,
  HeatmapService,
  type HeatmapServiceDependencies,
} from "./mastery/heatmap-service";

export {
  type HeatmapRouterDependencies,
  createHeatmapRouter,
} from "./mastery/heatmap-router";

export {
  type AttendanceEvidenceResult,
  AttendanceEvidenceService,
} from "./mastery/attendance-evidence";

export {
  type PollEvidenceResult,
  PollEvidenceService,
} from "./mastery/poll-evidence";

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
