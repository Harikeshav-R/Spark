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

export { SocraticTutorAi } from "./pipelines/socratic-tutor.js";
export { fixtureSocraticTutorTurn } from "./fixtures/tutoring-turn.js";
export { CheckUnderstandingAi } from "./pipelines/check-understanding.js";
export { fixtureCheckUnderstanding } from "./fixtures/understanding-check.js";
export {
  FIXTURE_COURSE_ID,
  FIXTURE_33_CONCEPTS,
  FIXTURE_34_EDGES,
  fixturePrerequisiteGraph,
} from "./fixtures/prerequisite-graph.js";

export { ExtractGraphAi } from "./pipelines/extract-graph.js";
export { DetectConceptsAi } from "./pipelines/detect-concepts.js";
export { fixtureDetectConcepts } from "./fixtures/detected-concepts.js";
export { SummarizeLectureAi } from "./pipelines/summarize-lecture.js";
export { fixtureSummarizeLecture } from "./fixtures/summarized-lecture.js";
export { GeneratePollAi } from "./pipelines/generate-poll.js";
export { fixturePollQuestion } from "./fixtures/poll-question.js";
export { EvaluatePollAi } from "./pipelines/evaluate-poll.js";
export { fixturePollEvaluation } from "./fixtures/poll-evaluation.js";
export { SuggestInterventionsAi } from "./pipelines/suggest-interventions.js";
export { fixtureSuggestedInterventions } from "./fixtures/suggested-interventions.js";
export { GenerateLearningPageAi } from "./pipelines/generate-learning-page.js";
export { fixtureGenerateLearningPage } from "./fixtures/learning-page.js";
export { GenerateQuizAi } from "./pipelines/generate-quiz.js";
export { fixtureGenerateQuizQuestions } from "./fixtures/quiz-questions.js";
