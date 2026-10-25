export {
  TeacherLectureDashboard,
  type TeacherLectureDashboardProps,
} from "./teacher-lecture-dashboard";

export {
  LectureControls,
  LectureElapsedTimer,
  type LectureControlsProps,
  type LectureElapsedTimerProps,
} from "./lecture-controls";

export {
  TranscriptFeed,
  type TranscriptFeedProps,
} from "./transcript-feed";

export {
  mergeTranscriptChunks,
  getElapsedSeconds,
  formatElapsedTimer,
} from "./teacher-lecture-state";

export {
  PollPanel,
  type PollPanelProps,
} from "./poll-panel";

export {
  ClassHeatmap,
  type ClassHeatmapProps,
} from "./class-heatmap";

export {
  useTeacherPolls,
  type UseTeacherPollsOptions,
  type UseTeacherPollsResult,
  type DraftEditState,
} from "./use-teacher-polls";

export {
  createTeacherPollState,
  reduceTeacherPollState,
  getEffectiveResponseCount,
  type TeacherPollState,
  type TeacherPollAction,
} from "./teacher-poll-state";
