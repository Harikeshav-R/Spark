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

export {
  ClassSky,
  type ClassSkyProps,
} from "./class-sky";

export {
  EffortRoster,
  type EffortRosterProps,
} from "./effort-roster";

export {
  buildClassSkyGraph,
  buildEffortRows,
  sortEffortRows,
  type EffortRow,
  type EffortSortKey,
} from "./class-sky-state";
