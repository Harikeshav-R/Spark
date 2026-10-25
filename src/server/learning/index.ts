export {
  TutoringRepository,
  type TutoringRepositoryPort,
  type TutoringSessionRecord,
} from "./tutoring-repository.js";

export {
  TutoringService,
  type TutoringServiceDependencies,
} from "./tutoring-service.js";

export {
  LectureSummaryRepository,
  type LectureSummaryRecord,
  type LectureSummaryDatabaseClientPort,
  lectureSummaryRecordSchema,
} from "./lecture-summary-repository.js";

export {
  LectureSummaryService,
  type LectureSummaryServiceDependencies,
} from "./lecture-summary-service.js";

export {
  LearningPageRepository,
  type LearningPageRepositoryPort,
  type LearningPageDatabaseClientPort,
} from "./learning-page-repository.js";

export {
  LearningPageService,
  type LearningPageServiceDependencies,
} from "./learning-page-service.js";

export {
  QuizRepository,
  type QuizRepositoryPort,
  type QuizDatabaseClientPort,
  type QuizAttemptRecord,
} from "./quiz-repository.js";

export {
  QuizService,
  type QuizServiceDependencies,
} from "./quiz-service.js";

export {
  EncounterRepository,
  type EncounterRepositoryPort,
  type EncounterDatabaseClientPort,
  type EncounterRecord,
  type NewEncounterRecord,
  type EncounterAttemptRecord,
  type NewEncounterAttemptRecord,
  type OptionPermutation,
  optionPermutationSchema,
} from "./encounter-repository.js";

export {
  EncounterService,
  type EncounterServiceDependencies,
} from "./encounter-service.js";

export {
  createLearningRouter,
  type LearningRouterDependencies,
} from "./learning-router.js";

export {
  createTutoringRouter,
  type TutoringRouterDependencies,
} from "./tutoring-router.js";

export {
  createEncounterRouter,
  type EncounterRouterDependencies,
} from "./encounter-router.js";
