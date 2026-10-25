import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { UUID } from "@/contracts/common";
import type {
  PollQuestion,
  PollDraftInput,
} from "@/contracts/classroom";
import {
  teacherPollSnapshotSchema,
  pollQuestionSchema,
} from "@/contracts/classroom";
import { courseHeatmapSnapshotSchema } from "@/contracts/mastery";
import { requestJson, ClientApiError } from "@/lib/client/http";
import {
  createTeacherPollState,
  reduceTeacherPollState,
  type TeacherPollAction,
  type TeacherPollState,
} from "./teacher-poll-state";

export interface DraftEditState {
  question: string;
  expectedAnswer: string;
  isDirty: boolean;
}


export interface UseTeacherPollsOptions {
  courseId: UUID;
  lectureId: UUID | null;
  getAccessToken: () => Promise<string | null>;
}

export interface UseTeacherPollsResult {
  state: TeacherPollState;
  pollsLoading: boolean;
  pollsError: string | null;
  heatmapLoading: boolean;
  heatmapError: string | null;
  actionPending: boolean;
  actionError: string | null;
  activeDraftEdits: DraftEditState;
  refresh: () => Promise<void>;
  refreshPolls: () => Promise<void>;
  refreshHeatmap: () => Promise<void>;
  handleEvent: (action: TeacherPollAction) => void;
  updateDraftField: (
    field: "question" | "expectedAnswer",
    value: string
  ) => void;
  generatePoll: (conceptId?: UUID) => Promise<PollQuestion>;
  saveDraft: () => Promise<PollQuestion>;
  activatePoll: () => Promise<PollQuestion>;
  closePoll: (pollId: UUID) => Promise<PollQuestion>;
  clearActionError: () => void;
}

export function useTeacherPolls({
  courseId,
  lectureId,
  getAccessToken,
}: UseTeacherPollsOptions): UseTeacherPollsResult {
  const [state, dispatch] = useReducer(
    reduceTeacherPollState,
    createTeacherPollState(courseId, lectureId)
  );

  const [pollsLoading, setPollsLoading] = useState(false);
  const [pollsError, setPollsError] = useState<string | null>(null);

  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);

  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [draftEditsByPollId, setDraftEditsByPollId] = useState<
    Record<UUID, DraftEditState>
  >({});

  const stateRef = useRef(state);
  stateRef.current = state;

  const lectureIdRef = useRef(lectureId);
  lectureIdRef.current = lectureId;

  const courseIdRef = useRef(courseId);
  courseIdRef.current = courseId;

  const activeDraftPollId = state.polls?.draft?.poll.id ?? null;

  // Initialize or update draft edit state from server draft if not dirty
  useEffect(() => {
    const draftPoll = state.polls?.draft?.poll;
    if (!draftPoll) return;

    setDraftEditsByPollId((prev) => {
      const existing = prev[draftPoll.id];
      if (existing && existing.isDirty) {
        return prev;
      }
      return {
        ...prev,
        [draftPoll.id]: {
          question: draftPoll.question,
          expectedAnswer: draftPoll.expectedAnswer,
          isDirty: false,
        },
      };
    });
  }, [state.polls?.draft?.poll]);

  // Clean up activated or closed drafts from edit map
  useEffect(() => {
    if (!activeDraftPollId) return;
    if (state.polls?.active?.poll.id === activeDraftPollId) {
      setDraftEditsByPollId((prev) => {
        const next = { ...prev };
        delete next[activeDraftPollId];
        return next;
      });
    }
  }, [activeDraftPollId, state.polls?.active?.poll.id]);

  // Reset state when lecture changes
  useEffect(() => {
    dispatch({ type: "reset", courseId, lectureId });
    setDraftEditsByPollId({});
    setPollsError(null);
    setActionError(null);
  }, [courseId, lectureId]);

  const refreshHeatmap = useCallback(async (): Promise<void> => {
    setHeatmapLoading(true);
    setHeatmapError(null);
    const startRevision = stateRef.current.eventRevision;

    try {
      const parsed = await requestJson(
        `/api/courses/${encodeURIComponent(courseId)}/heatmap`,
        courseHeatmapSnapshotSchema,
        { getAccessToken }
      );
      dispatch({
        type: "heatmap:snapshot",
        payload: parsed,
        requestedAtRevision: startRevision,
      });
    } catch (err: unknown) {
      setHeatmapError(
        err instanceof Error ? err.message : "Failed to load course heatmap"
      );
    } finally {
      setHeatmapLoading(false);
    }
  }, [courseId, getAccessToken]);

  const refreshPolls = useCallback(async (): Promise<void> => {
    if (!lectureId) {
      return;
    }

    setPollsLoading(true);
    setPollsError(null);
    const startRevision = stateRef.current.eventRevision;

    try {
      const parsed = await requestJson(
        `/api/lectures/${encodeURIComponent(lectureId)}/polls`,
        teacherPollSnapshotSchema,
        { getAccessToken }
      );
      dispatch({
        type: "snapshot",
        payload: parsed,
        requestedAtRevision: startRevision,
      });
    } catch (err: unknown) {
      setPollsError(
        err instanceof Error ? err.message : "Failed to load teacher polls"
      );
    } finally {
      setPollsLoading(false);
    }
  }, [lectureId, getAccessToken]);

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.allSettled([refreshPolls(), refreshHeatmap()]);
  }, [refreshPolls, refreshHeatmap]);

  // Initial load and lecture change hydration
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cancelled) {
        await refresh();
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleEvent = useCallback((action: TeacherPollAction) => {
    dispatch(action);
    if (action.type === "poll:new-question") {
      // Trigger private hydration on announced question
      void refreshPolls();
    }
    if (action.type === "heatmap:updated") {
      // If totalStudents changed or concept unknown, full heatmap refresh
      const evt = action.payload;
      const cur = stateRef.current.heatmap;
      if (!cur || cur.totalStudents !== evt.totalStudents || !cur.concepts.some((c) => c.conceptId === evt.conceptId)) {
        void refreshHeatmap();
      }
    }
  }, [refreshPolls, refreshHeatmap]);

  const updateDraftField = useCallback(
    (field: "question" | "expectedAnswer", value: string) => {
      const draftPoll = stateRef.current.polls?.draft?.poll;
      if (!draftPoll) return;

      setDraftEditsByPollId((prev) => {
        const existing = prev[draftPoll.id] ?? {
          question: draftPoll.question,
          expectedAnswer: draftPoll.expectedAnswer,
          isDirty: false,
        };
        return {
          ...prev,
          [draftPoll.id]: {
            ...existing,
            [field]: value,
            isDirty: true,
          },
        };
      });
    },
    []
  );

  const generatePoll = useCallback(
    async (conceptId?: UUID): Promise<PollQuestion> => {
      if (!lectureIdRef.current) {
        throw new Error("No live lecture selected");
      }

      setActionPending(true);
      setActionError(null);

      try {
        const poll = await requestJson(
          `/api/lectures/${encodeURIComponent(lectureIdRef.current)}/poll/generate`,
          pollQuestionSchema,
          {
            getAccessToken,
            method: "POST",
            body: conceptId ? { conceptId } : {},
          }
        );
        dispatch({ type: "poll:confirmed", payload: poll });
        setDraftEditsByPollId((prev) => ({
          ...prev,
          [poll.id]: {
            question: poll.question,
            expectedAnswer: poll.expectedAnswer,
            isDirty: false,
          },
        }));
        return poll;
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Failed to generate poll";
        setActionError(msg);
        throw err;
      } finally {
        setActionPending(false);
      }
    },
    [getAccessToken]
  );

  const saveDraft = useCallback(async (): Promise<PollQuestion> => {
    const draftPoll = stateRef.current.polls?.draft?.poll;
    if (!draftPoll) {
      throw new Error("No draft poll to save");
    }

    const currentEdits = draftEditsByPollId[draftPoll.id] ?? {
      question: draftPoll.question,
      expectedAnswer: draftPoll.expectedAnswer,
      isDirty: false,
    };

    const payload: PollDraftInput = {
      question: currentEdits.question,
      expectedAnswer: currentEdits.expectedAnswer,
    };

    setActionPending(true);
    setActionError(null);

    try {
      const updated = await requestJson(
        `/api/polls/${encodeURIComponent(draftPoll.id)}`,
        pollQuestionSchema,
        {
          getAccessToken,
          method: "PATCH",
          body: payload,
        }
      );
      dispatch({ type: "poll:confirmed", payload: updated });
      setDraftEditsByPollId((prev) => ({
        ...prev,
        [draftPoll.id]: {
          question: updated.question,
          expectedAnswer: updated.expectedAnswer,
          isDirty: false,
        },
      }));
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save draft";
      setActionError(msg);
      throw err;
    } finally {
      setActionPending(false);
    }
  }, [draftEditsByPollId, getAccessToken]);

  const activatePoll = useCallback(async (): Promise<PollQuestion> => {
    const draftPoll = stateRef.current.polls?.draft?.poll;
    if (!draftPoll) {
      throw new Error("No draft poll to activate");
    }

    setActionPending(true);
    setActionError(null);

    try {
      const currentEdits = draftEditsByPollId[draftPoll.id];
      if (currentEdits && currentEdits.isDirty) {
        await requestJson(
          `/api/polls/${encodeURIComponent(draftPoll.id)}`,
          pollQuestionSchema,
          {
            getAccessToken,
            method: "PATCH",
            body: {
              question: currentEdits.question,
              expectedAnswer: currentEdits.expectedAnswer,
            },
          }
        );
      }

      let activated: PollQuestion;
      try {
        activated = await requestJson(
          `/api/polls/${encodeURIComponent(draftPoll.id)}/activate`,
          pollQuestionSchema,
          {
            getAccessToken,
            method: "POST",
          }
        );
      } catch (actErr: unknown) {
        if (actErr instanceof ClientApiError && actErr.status === 409) {
          void refreshPolls();
        }
        throw actErr;
      }

      dispatch({ type: "poll:confirmed", payload: activated });
      setDraftEditsByPollId((prev) => {
        const next = { ...prev };
        delete next[draftPoll.id];
        return next;
      });
      return activated;
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to activate poll";
      setActionError(msg);
      throw err;
    } finally {
      setActionPending(false);
    }
  }, [draftEditsByPollId, getAccessToken, refreshPolls]);

  const closePoll = useCallback(
    async (pollId: UUID): Promise<PollQuestion> => {
      setActionPending(true);
      setActionError(null);

      try {
        const closed = await requestJson(
          `/api/polls/${encodeURIComponent(pollId)}/close`,
          pollQuestionSchema,
          {
            getAccessToken,
            method: "POST",
          }
        );
        dispatch({ type: "poll:confirmed", payload: closed });
        return closed;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to close poll";
        setActionError(msg);
        throw err;
      } finally {
        setActionPending(false);
      }
    },
    [getAccessToken]
  );

  const clearActionError = useCallback(() => {
    setActionError(null);
  }, []);

  const activeDraft = state.polls?.draft?.poll;
  const activeDraftEdits: DraftEditState = activeDraft
    ? draftEditsByPollId[activeDraft.id] ?? {
        question: activeDraft.question,
        expectedAnswer: activeDraft.expectedAnswer,
        isDirty: false,
      }
    : {
        question: "",
        expectedAnswer: "",
        isDirty: false,
      };

  return {
    state,
    pollsLoading,
    pollsError,
    heatmapLoading,
    heatmapError,
    actionPending,
    actionError,
    activeDraftEdits,
    refresh,
    refreshPolls,
    refreshHeatmap,
    handleEvent,
    updateDraftField,
    generatePoll,
    saveDraft,
    activatePoll,
    closePoll,
    clearActionError,
  };
}
