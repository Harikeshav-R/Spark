export {
  LectureService,
  type LectureCompletionDependencies,
} from "./lecture-service.js";
export {
  LectureRepository,
  type LectureDatabaseClientPort,
} from "./lecture-repository.js";

export {
  TranscriptRepository,
  type TranscriptDatabaseClientPort,
  type LectureTranscriptChunk,
} from "./transcript-repository.js";

export {
  TranscriptIngestor,
  type TranscriptIngestorDependencies,
} from "./transcript-ingestor.js";

export {
  createTranscriptRouter,
  type TranscriptRouterDependencies,
} from "./transcript-router.js";

export {
  createLectureSummaryRouter,
  type LectureSummaryRouterDependencies,
} from "./lecture-summary-router.js";

export {
  CS229_TRANSCRIPT_SCRIPT,
  type LectureScriptChunk,
} from "./cs229-transcript.js";

export { runLectureSimulator } from "./simulator.js";

export {
  LectureSpeechService,
  readSpeechSourceConfig,
  type SpeechStreamHandle,
  type SpeechSourceConfig,
  type SpeechSourceDependencies,
  type ZoomRtmsStart,
} from "./speech-source.js";

export {
  PollRepository,
  type PollDatabaseClientPort,
  type PollContext,
  type StoredPollMastery,
  type StoredPollResponse,
} from "./poll-repository.js";

export {
  PollService,
  type PollServiceDependencies,
} from "./poll-service.js";
