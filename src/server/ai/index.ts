export {
  OpenRouterClient,
  type OpenRouterClientOptions,
  type OpenRouterCompletionRequest,
  type AiCapability,
  type ModelTier,
  type CapabilityPolicy,
  AI_CAPABILITIES,
  CAPABILITY_POLICIES,
  DEFAULT_MODELS,
} from "./providers/openrouter-client.js";

export { SocraticTutorAi } from "./tutoring-ai.js";
export { fixtureSocraticTutorTurn } from "./fixtures/tutoring-turn.js";
export {
  FIXTURE_COURSE_ID,
  FIXTURE_33_CONCEPTS,
  FIXTURE_34_EDGES,
  fixturePrerequisiteGraph,
} from "./fixtures/prerequisite-graph.js";

export { ExtractGraphAi } from "./pipelines/extract-graph.js";
export { DetectConceptsAi } from "./pipelines/detect-concepts.js";
export { fixtureDetectConcepts } from "./fixtures/detected-concepts.js";
export {
  SummarizeLectureAi,
  LectureSummaryRepository,
  PostLectureSummarizer,
  lectureSummaryRecordSchema,
  type LectureSummaryRecord,
  type LectureSummaryDatabaseClientPort,
  type TranscriptSourcePort,
  type LectureSummaryRepositoryPort,
  type PostLectureSummarizerDependencies,
  type SummarizerAiPort,
} from "./pipelines/summarize-lecture.js";
export {
  fixtureSummarizeLecture,
  ZERO_CHUNKS_SUMMARY_TEXT,
  FIXTURE_SUMMARY_CONCEPT_ID_1,
  FIXTURE_SUMMARY_CONCEPT_ID_2,
} from "./fixtures/lecture-summary.js";
