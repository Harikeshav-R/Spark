"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { z } from "zod";
import type { UUID } from "@/contracts/common";
import {
  lectureSessionSchema,
  lectureSnapshotSchema,
  pollResponseResultSchema,
  type LectureSession,
  type TranscriptChunk,
} from "@/contracts/classroom";
import { courseGraphResponseSchema } from "@/contracts/course";

type CourseGraphResponse = z.infer<typeof courseGraphResponseSchema>;
import {
  transcriptChunkEventSchema,
  conceptDetectedEventSchema,
  lectureEndedEventSchema,
  pollNewQuestionEventSchema,
  pollClosedEventSchema,
  masteryUpdatedEventSchema,
  type TranscriptChunkEvent,
  type ConceptDetectedEvent,
  type PollNewQuestionEvent,
  type PollClosedEvent,
  type MasteryUpdatedEvent,
} from "@/contracts/realtime";
import { AppShell } from "@/components/ui/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignInPrompt } from "@/features/auth/sign-in-prompt";
import { KnowledgeGraph } from "@/features/graph/knowledge-graph";
import { SparkMascot } from "@/features/mascot/spark-mascot";
import {
  SPARK_FORM_LABELS,
  getSparkForm,
  type SparkMood,
} from "@/features/mascot/spark-moods";
import { TranscriptFeed } from "@/features/professor/transcript-feed";
import { requestJson, ClientApiError, getRuntimeAccessToken } from "@/lib/client/http";
import { createLectureSocket, type LectureSocket } from "@/lib/client/socket";
import {
  createStudentLectureState,
  reduceStudentLectureState,
  applyStudentGraphMastery,
  type StudentLectureState,
} from "./student-lecture-state";
import { ActivePollModal } from "./active-poll-modal";
import { EvaluationCard } from "./evaluation-card";
export interface StudentLectureViewProps {
  studentId: UUID;
  courseId: UUID;
  lectureId?: UUID;
  getAccessToken?: () => Promise<string | null>;
}

type FeedConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

const extendedLectureSnapshotSchema = lectureSnapshotSchema.extend({
  isSimulated: z.boolean().optional(),
});

function deriveSnapshotProvenance(chunks: readonly TranscriptChunk[]): boolean | null {
  if (chunks.length === 0) return null;
  if (chunks.some((c) => c.isSimulated === true)) return true;
  if (chunks.every((c) => c.isSimulated === false)) return false;
  return null;
}

export function StudentLectureView({
  studentId,
  courseId,
  lectureId: initialLectureId,
  getAccessToken = getRuntimeAccessToken,
}: StudentLectureViewProps): React.JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [authForbidden, setAuthForbidden] = useState<boolean>(false);

  // Course Graph
  const [courseGraph, setCourseGraph] = useState<CourseGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState<boolean>(true);
  const [graphError, setGraphError] = useState<string | null>(null);

  // Lecture & Realtime State
  const [_activeLectureId, setActiveLectureId] = useState<UUID | undefined>(initialLectureId);
  const [availableLiveLectures, setAvailableLiveLectures] = useState<LectureSession[]>([]);
  const [lectureState, setLectureState] = useState<StudentLectureState | null>(null);
  const [lectureLoading, setLectureLoading] = useState<boolean>(false);
  const [lectureError, setLectureError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<FeedConnectionStatus>("idle");

  // Screen reader polite live announcements
  const [activeAnnouncement, setActiveAnnouncement] = useState<string>("");

  // Mobile navigation tab ("graph" or "stream")
  const [mobileTab, setMobileTab] = useState<"graph" | "stream">("graph");

  // Refs for race control & socket
  const socketRef = useRef<LectureSocket | null>(null);
  const lectureStateRef = useRef<StudentLectureState | null>(null);
  lectureStateRef.current = lectureState;

  const inFlightSnapshotRef = useRef<boolean>(false);
  const queuedSnapshotRef = useRef<{ restore: boolean } | null>(null);

  // Poll submission and mastery version arbitration refs
  const conceptVersionsRef = useRef<Map<UUID, number>>(new Map());
  const inFlightPollSubmissionRef = useRef<{
    pollId: UUID;
    conceptId: UUID;
    studentId: UUID;
    generation: number;
  } | null>(null);
  const requestGenerationRef = useRef<number>(0);
  // Maps & Sets derived from graph
  const conceptLabels = useMemo(() => {
    const map = new Map<UUID, string>();
    if (courseGraph) {
      for (const node of courseGraph.nodes) {
        map.set(node.id, node.label);
      }
    }
    return map;
  }, [courseGraph]);

  const conceptLabelsRef = useRef(conceptLabels);
  conceptLabelsRef.current = conceptLabels;

  const knownConceptIds = useMemo(() => {
    const set = new Set<UUID>();
    if (courseGraph) {
      for (const node of courseGraph.nodes) {
        set.add(node.id);
      }
    }
    return set;
  }, [courseGraph]);

  const knownConceptIdsRef = useRef(knownConceptIds);
  knownConceptIdsRef.current = knownConceptIds;

  // 1. Initial Authentication Resolution
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const resolvedToken = await getAccessToken();
        if (cancelled) return;
        setToken(resolvedToken);
      } catch (err: unknown) {
        console.warn("[StudentLectureView] Auth check error", err);
        if (cancelled) return;
        setToken(null);
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  // Snapshot refresh helper with coalescing
  const refreshSnapshot = useCallback(
    async (targetLectureId: UUID, authToken: string, shouldRestoreActiveConcepts: boolean) => {
      const requestedAtRevision = lectureStateRef.current?.eventRevision ?? 0;
      if (inFlightSnapshotRef.current) {
        // Coalesce overlapping requests, keeping restore: true if any request needed it
        queuedSnapshotRef.current = {
          restore: queuedSnapshotRef.current?.restore || shouldRestoreActiveConcepts,
        };
        return;
      }

      inFlightSnapshotRef.current = true;
      try {
        const snapshot = await requestJson(
          `/api/lectures/${encodeURIComponent(targetLectureId)}/snapshot`,
          extendedLectureSnapshotSchema,
          { getAccessToken: async () => authToken }
        );

        if (
          snapshot.lecture.courseId.toLowerCase() !== courseId.toLowerCase() ||
          snapshot.lecture.id.toLowerCase() !== targetLectureId.toLowerCase() ||
          !snapshot.recentChunks.every(
            (c) => c.lectureId.toLowerCase() === targetLectureId.toLowerCase()
          )
        ) {
          setLectureError("Lecture snapshot mismatch.");
          return;
        }

        setLectureState((prev) => {
          if (!prev) return prev;
          return reduceStudentLectureState(
            prev,
            {
              type: "snapshot",
              payload: snapshot,
              requestedAtRevision,
              restoreActiveConcepts: shouldRestoreActiveConcepts,
            },
            knownConceptIdsRef.current
          );
        });
      } catch (err: unknown) {
        console.warn("[StudentLectureView] Snapshot refresh error", err);
        setConnectionStatus("error");
        setLectureError("Failed to reconcile lecture snapshot.");
      } finally {
        inFlightSnapshotRef.current = false;
        if (queuedSnapshotRef.current) {
          const next = queuedSnapshotRef.current;
          queuedSnapshotRef.current = null;
          void refreshSnapshot(targetLectureId, authToken, next.restore);
        }
      }
    },
    [courseId]
  );

  // 2. Fetch Course Graph and Lectures
  useEffect(() => {
    if (!token) return;

    let abort = false;
    setGraphLoading(true);
    setLectureLoading(true);

    void (async () => {
      try {
        const [graphResult, lectureListResult] = await Promise.allSettled([
          requestJson(
            `/api/courses/${encodeURIComponent(courseId)}/graph`,
            courseGraphResponseSchema,
            { getAccessToken: async () => token }
          ),
          requestJson(
            `/api/courses/${encodeURIComponent(courseId)}/lectures`,
            z.array(lectureSessionSchema),
            { getAccessToken: async () => token }
          ),
        ]);

        if (abort) return;

        // Process Course Graph
        let graphNodesSet = new Set<UUID>();
        if (graphResult.status === "fulfilled") {
          setCourseGraph(graphResult.value);
          graphNodesSet = new Set(graphResult.value.nodes.map((n) => n.id));
        } else {
          const err = graphResult.reason;
          if (err instanceof ClientApiError && err.status === 403) {
            setAuthForbidden(true);
            return;
          } else if (err instanceof ClientApiError && err.status === 404) {
            setGraphError("Course not found.");
          } else {
            setGraphError("Failed to load course knowledge graph.");
          }
        }

        // Process Lecture List
        let targetLectureId = initialLectureId;
        if (lectureListResult.status === "fulfilled") {
          const live = lectureListResult.value.filter((l) => l.status === "live");
          setAvailableLiveLectures(live);

          if (!targetLectureId && live.length === 1) {
            targetLectureId = live[0].id;
          }
        } else {
          const err = lectureListResult.reason;
          if (err instanceof ClientApiError && err.status === 403) {
            setAuthForbidden(true);
            return;
          } else {
            setLectureError("Failed to load lecture sessions.");
          }
        }

        // Load Snapshot for target lecture
        if (targetLectureId) {
          setActiveLectureId(targetLectureId);
          try {
            const snapshot = await requestJson(
              `/api/lectures/${encodeURIComponent(targetLectureId)}/snapshot`,
              extendedLectureSnapshotSchema,
              { getAccessToken: async () => token }
            );

            if (abort) return;

            if (
              snapshot.lecture.courseId.toLowerCase() !== courseId.toLowerCase() ||
              snapshot.lecture.id.toLowerCase() !== targetLectureId.toLowerCase() ||
              !snapshot.recentChunks.every(
                (c) => c.lectureId.toLowerCase() === targetLectureId!.toLowerCase()
              )
            ) {
              setLectureError("Selected lecture does not belong to this course.");
              return;
            }

            setLectureState(createStudentLectureState(snapshot, graphNodesSet));
          } catch (snapshotErr: unknown) {
            if (abort) return;
            if (snapshotErr instanceof ClientApiError) {
              if (snapshotErr.status === 404) {
                setLectureError("Requested lecture was not found.");
              } else if (snapshotErr.status === 403) {
                setAuthForbidden(true);
              } else {
                setLectureError(snapshotErr.message);
              }
            } else {
              setLectureError("Failed to load lecture snapshot.");
            }
          }
        }
      } catch (err: unknown) {
        if (abort) return;
        if (err instanceof ClientApiError && err.status === 403) {
          setAuthForbidden(true);
        } else {
          setLectureError("Failed to initialize student lecture workspace.");
        }
      } finally {
        if (!abort) {
          setGraphLoading(false);
          setLectureLoading(false);
        }
      }
    })();

    return () => {
      abort = true;
    };
  }, [courseId, initialLectureId, token]);

  // 3. Manage Live Realtime Connection
  useEffect(() => {
    if (!token || !lectureState || lectureState.lecture.status !== "live") {
      setConnectionStatus("idle");
      return;
    }

    const currentLectureId = lectureState.lecture.id;
    setConnectionStatus("connecting");

    const socket = createLectureSocket(token);
    socketRef.current = socket;

    let ackTimeout: NodeJS.Timeout | null = null;

    // Attach listeners BEFORE connecting
    socket.on("connect", () => {
      setConnectionStatus("connecting");
      ackTimeout = setTimeout(() => {
        setConnectionStatus("error");
        setLectureError("Classroom room authorization timed out.");
        socket.disconnect();
      }, 5000);

      socket.emit("lecture:join", { lectureId: currentLectureId }, (ack) => {
        if (ackTimeout) {
          clearTimeout(ackTimeout);
          ackTimeout = null;
        }

        if (ack && ack.success) {
          setConnectionStatus("connected");
          void refreshSnapshot(currentLectureId, token, true);
        } else {
          setConnectionStatus("error");
          setLectureError(ack?.error || "Failed to join live classroom session.");
          socket.disconnect();
        }
      });
    });

    socket.on("disconnect", () => {
      setConnectionStatus("reconnecting");
    });

    socket.on("connect_error", () => {
      setConnectionStatus("error");
    });

    socket.on("transcript:chunk", (rawPayload: unknown) => {
      const parsed = transcriptChunkEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const event: TranscriptChunkEvent = parsed.data;

      if (event.lectureId !== currentLectureId) return;

      setLectureState((prev) =>
        prev
          ? reduceStudentLectureState(
              prev,
              { type: "transcript:chunk", payload: event },
              knownConceptIdsRef.current
            )
          : null
      );
    });

    socket.on("lecture:concept-detected", (rawPayload: unknown) => {
      const parsed = conceptDetectedEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const event: ConceptDetectedEvent = parsed.data;

      if (event.lectureId !== currentLectureId) return;

      const labels = event.conceptIds
        .map((id) => conceptLabelsRef.current.get(id))
        .filter((l): l is string => Boolean(l));

      if (labels.length > 0) {
        setActiveAnnouncement(`Concept ${labels.join(", ")} detected in lecture.`);
      }

      setLectureState((prev) =>
        prev
          ? reduceStudentLectureState(
              prev,
              { type: "lecture:concept-detected", payload: event },
              knownConceptIdsRef.current
            )
          : null
      );

      // Trigger snapshot refresh without overwriting event-selected active concepts
      void refreshSnapshot(currentLectureId, token, false);
    });

    socket.on("poll:new-question", (rawPayload: unknown) => {
      const parsed = pollNewQuestionEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const event: PollNewQuestionEvent = parsed.data;

      if (event.lectureId !== currentLectureId) return;

      setActiveAnnouncement("New formative poll activated by instructor.");

      setLectureState((prev) =>
        prev
          ? reduceStudentLectureState(
              prev,
              { type: "poll:new-question", payload: event },
              knownConceptIdsRef.current
            )
          : null
      );
    });

    socket.on("poll:closed", (rawPayload: unknown) => {
      const parsed = pollClosedEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const event: PollClosedEvent = parsed.data;

      if (event.lectureId !== currentLectureId) return;

      setLectureState((prev) =>
        prev
          ? reduceStudentLectureState(
              prev,
              { type: "poll:closed", payload: event },
              knownConceptIdsRef.current
            )
          : null
      );
    });

    socket.on("mastery:updated", (rawPayload: unknown) => {
      const parsed = masteryUpdatedEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const event: MasteryUpdatedEvent = parsed.data;

      // Only update mastery for this specific authenticated student
      if (event.studentId !== studentId) return;

      // Reject stale or duplicate version numbers
      const prevVersion = conceptVersionsRef.current.get(event.conceptId);
      if (prevVersion !== undefined && event.version <= prevVersion) {
        return;
      }
      conceptVersionsRef.current.set(event.conceptId, event.version);

      setCourseGraph((prev) =>
        prev ? applyStudentGraphMastery(prev, event, studentId) : null
      );
    });

    socket.on("lecture:ended", (rawPayload: unknown) => {
      const parsed = lectureEndedEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const event = parsed.data;

      if (event.lectureId === currentLectureId) {
        setLectureState((prev) =>
          prev
            ? reduceStudentLectureState(
                prev,
                { type: "lecture:ended", payload: event },
                knownConceptIdsRef.current
              )
            : null
        );
        setConnectionStatus("idle");
        socket.disconnect();
      }
    });
    socket.connect();

    return () => {
      if (ackTimeout) {
        clearTimeout(ackTimeout);
        ackTimeout = null;
      }
      if (socket.connected) {
        socket.emit("lecture:leave", { lectureId: currentLectureId }, (ack) => {
          if (ack && !ack.success) {
            console.warn("[StudentLectureView] Failed to leave lecture room", ack.error);
          }
        });
      }
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [lectureState?.lecture.id, lectureState?.lecture.status, token, studentId, refreshSnapshot]);

  // Derived Active Concept IDs and Mascot State
  const displayedActiveConceptIds = useMemo(() => {
    if (
      !lectureState ||
      lectureState.lecture.status !== "live" ||
      connectionStatus !== "connected"
    ) {
      return [];
    }
    return lectureState.activeConceptIds;
  }, [lectureState, connectionStatus]);

  const sparkMood: SparkMood = useMemo(() => {
    if (lectureState?.poll.submission.status === "evaluated") {
      const outcome = lectureState.poll.submission.result.evaluation.outcome;
      if (outcome === "correct") return "cheer";
      if (outcome === "wrong") return "oops";
      return "think";
    }
    if (lectureState?.poll.submission.status === "submitting") {
      return "think";
    }
    return displayedActiveConceptIds.length > 0 ? "think" : "calm";
  }, [lectureState?.poll.submission, displayedActiveConceptIds]);

  const activeConceptLabels = useMemo(() => {
    return displayedActiveConceptIds
      .map((id) => conceptLabels.get(id))
      .filter((l): l is string => Boolean(l));
  }, [displayedActiveConceptIds, conceptLabels]);

  // Course Mastery derived from graph nodes
  const { skyBrightness, masteryCaption } = useMemo(() => {
    if (!courseGraph || courseGraph.nodes.length === 0) {
      return { skyBrightness: 0, masteryCaption: "Mastery unavailable" };
    }
    const allHaveFinite = courseGraph.nodes.every(
      (n) => typeof n.confidence === "number" && Number.isFinite(n.confidence)
    );
    if (!allHaveFinite) {
      return { skyBrightness: 0, masteryCaption: "Mastery unavailable" };
    }
    const mean =
      courseGraph.nodes.reduce((sum, n) => sum + (n.confidence as number), 0) /
      courseGraph.nodes.length;
    const clamped = Math.max(0, Math.min(1, mean));
    const form = getSparkForm(clamped);
    return {
      skyBrightness: clamped,
      masteryCaption: `${Math.round(clamped * 100)}% Course Mastery (${SPARK_FORM_LABELS[form]})`,
    };
  }, [courseGraph]);

  const provenance = useMemo(() => {
    return lectureState ? deriveSnapshotProvenance(lectureState.chunks) : null;
  }, [lectureState]);

  // Handle switching to a specific live lecture
  const handleSelectLiveLecture = (lectureId: UUID) => {
    setActiveLectureId(lectureId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("lectureId", lectureId);
      window.history.replaceState({}, "", url.toString());
    }
    if (token) {
      void (async () => {
        try {
          const snapshot = await requestJson(
            `/api/lectures/${encodeURIComponent(lectureId)}/snapshot`,
            extendedLectureSnapshotSchema,
            { getAccessToken: async () => token }
          );
          setLectureState(createStudentLectureState(snapshot, knownConceptIdsRef.current));
          conceptVersionsRef.current.clear();
          inFlightPollSubmissionRef.current = null;
        } catch (err: unknown) {
          console.warn("[StudentLectureView] Lecture switch error", err);
          setLectureError("Failed to switch lecture session.");
        }
      })();
    }
  };

  // Handle submitting an answer to the active poll
  const handleSubmitAnswer = async () => {
    if (!lectureState || lectureState.lecture.status !== "live") return;
    if (connectionStatus !== "connected") return;
    const poll = lectureState.poll;
    if (!poll.isActive || !poll.question) return;

    const pollId = poll.question.id;
    const conceptId = poll.question.conceptId;
    const trimmed = poll.answer.trim();
    if (trimmed.length === 0) return;
    if (poll.submission.status === "submitting" || poll.submission.status === "evaluated") return;
    if (inFlightPollSubmissionRef.current !== null) return;

    const currentGen = ++requestGenerationRef.current;
    inFlightPollSubmissionRef.current = {
      pollId,
      conceptId,
      studentId,
      generation: currentGen,
    };

    const startVersion = conceptVersionsRef.current.get(conceptId) ?? 0;

    setLectureState((prev) =>
      prev
        ? reduceStudentLectureState(
            prev,
            { type: "poll:submit-start", pollId, answer: poll.answer },
            knownConceptIdsRef.current
          )
        : null
    );

    try {
      const result = await requestJson(
        `/api/polls/${encodeURIComponent(pollId)}/respond`,
        pollResponseResultSchema,
        {
          method: "POST",
          body: { answer: trimmed },
          getAccessToken: async () => token,
        }
      );

      // Guard against race conditions or workspace changes
      if (inFlightPollSubmissionRef.current?.generation !== currentGen) {
        return;
      }

      setLectureState((prev) =>
        prev
          ? reduceStudentLectureState(
              prev,
              { type: "poll:submit-success", pollId, result },
              knownConceptIdsRef.current
            )
          : null
      );

      // Update course graph mastery unless a newer socket event already arrived
      const currentVersion = conceptVersionsRef.current.get(conceptId) ?? 0;
      if (currentVersion <= startVersion) {
        setCourseGraph((prev) =>
          prev
            ? applyStudentGraphMastery(
                prev,
                {
                  studentId,
                  conceptId,
                  confidence: result.newConfidence,
                  band: result.newBand,
                },
                studentId
              )
            : null
        );
      }
    } catch (err: unknown) {
      if (inFlightPollSubmissionRef.current?.generation !== currentGen) {
        return;
      }

      let code = "SUBMISSION_ERROR";
      let message = "Failed to submit poll response.";

      if (err instanceof ClientApiError) {
        code = err.code || `HTTP_${err.status}`;
        message = err.message || message;

        if (err.status === 400 && code === "INVALID_POLL_STATUS") {
          // Poll was closed by professor
          setLectureState((prev) =>
            prev
              ? reduceStudentLectureState(
                  prev,
                  {
                    type: "poll:closed",
                    payload: {
                      eventId: "00000000-0000-0000-0000-000000000000",
                      occurredAt: new Date().toISOString(),
                      pollId,
                      lectureId: lectureState.lecture.id,
                      status: "closed",
                      closedAt: new Date().toISOString(),
                    },
                  },
                  knownConceptIdsRef.current
                )
              : null
          );
        }
      } else if (err instanceof Error) {
        message = err.message;
      }

      setLectureState((prev) =>
        prev
          ? reduceStudentLectureState(
              prev,
              { type: "poll:submit-error", pollId, code, message },
              knownConceptIdsRef.current
            )
          : null
      );
    } finally {
      if (inFlightPollSubmissionRef.current?.generation === currentGen) {
        inFlightPollSubmissionRef.current = null;
      }
    }
  };

  // Auth checking state
  if (authChecking) {
    return (
      <AppShell
        title="Student workspace"
        description="Access your courses, explore the knowledge graph, and practice with Socratic tutoring."
        workspace="student"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Student workspace", href: `/student/${studentId}` },
        ]}
      >
        <div className="p-8 text-center text-sm text-[var(--color-fg-muted)]">
          Verifying credentials…
        </div>
      </AppShell>
    );
  }

  // Not authenticated
  if (!token) {
    return (
      <AppShell
        title="Student workspace"
        description="Access your courses, explore the knowledge graph, and practice with Socratic tutoring."
        workspace="student"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Student workspace", href: `/student/${studentId}` },
        ]}
      >
        <SignInPrompt />
      </AppShell>
    );
  }

  // Forbidden (403)
  if (authForbidden) {
    return (
      <AppShell
        title="Student workspace"
        description="Access your courses, explore the knowledge graph, and practice with Socratic tutoring."
        workspace="student"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Student workspace", href: `/student/${studentId}` },
        ]}
        sessionStatus="authenticated"
      >
        <div
          role="alert"
          className="rounded-xl border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-danger-soft,#f8e0e3)] p-6 text-[var(--color-fg-default)]"
        >
          <p className="font-semibold text-[var(--color-fg-default)] mb-2">
            Access denied
          </p>
          <p className="text-sm text-[var(--color-fg-muted)]">
            You do not have permission to access this course.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Student workspace"
      description="Access your courses, explore the knowledge graph, and practice with Socratic tutoring."
      workspace="student"
      breadcrumbs={[
        { label: "Home", href: "/" },
        { label: "Student workspace", href: `/student/${studentId}` },
        { label: "Live lecture", href: `/student/${studentId}?courseId=${courseId}` },
      ]}
      sessionStatus="authenticated"
    >
      {/* Screen reader polite announcement region for concept detection */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {activeAnnouncement}
      </div>

      <div className="space-y-4">
        {/* Connection & Status Banner */}
        {lectureState && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-[var(--color-bg-panel)] border border-[var(--color-border-default)] text-xs">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-[#2b7f55]"
                    : connectionStatus === "connecting" || connectionStatus === "reconnecting"
                    ? "bg-[#cf951f] animate-pulse"
                    : "bg-[#b0384a]"
                }`}
              />
              <span className="font-medium text-[var(--color-fg-default)]">
                {connectionStatus === "connected" && "Live feed connected"}
                {connectionStatus === "connecting" && "Connecting to classroom feed…"}
                {connectionStatus === "reconnecting" && "Reconnecting feed…"}
                {connectionStatus === "error" && "Feed connection error"}
                {connectionStatus === "idle" &&
                  (lectureState.lecture.status === "completed"
                    ? "Lecture completed"
                    : "Feed disconnected")}
              </span>
            </div>

            <div className="flex items-center gap-4 text-[var(--color-fg-muted)]">
              <span>{lectureState.lecture.title}</span>
              <span>Room: lecture:{lectureState.lecture.id}</span>
            </div>
          </div>
        )}

        {/* Active Concepts Notice (Non-color indicator) */}
        {displayedActiveConceptIds.length > 0 && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-active-concept-bg,#fbeac2)] border border-[var(--color-active-concept,#ed793c)] text-xs text-[var(--color-active-concept-text,#2b2a2e)]"
          >
            <span className="font-semibold">Active concepts:</span>
            {activeConceptLabels.map((label, idx) => (
              <Badge
                key={idx}
                variant="outline"
                className="border-[var(--color-active-concept,#ed793c)] bg-white text-[var(--color-active-concept-text,#2b2a2e)] font-medium"
              >
                {label}
              </Badge>
            ))}
          </div>
        )}

        {/* Global Errors */}
        {(graphError || lectureError) && (
          <div
            role="alert"
            className="rounded-lg border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-danger-soft,#f8e0e3)] p-4 text-sm text-[var(--color-fg-default)]"
          >
            {graphError || lectureError}
          </div>
        )}
        {/* Compact Poll Status Surface (above mobile tabs, available in both views) */}
        {lectureState?.poll.question && (
          <div id="workspace-poll-status-heading" tabIndex={-1} className="outline-none">
            {lectureState.poll.isActive &&
              !lectureState.poll.isOpen &&
              lectureState.poll.submission.status === "idle" && (
                <div
                  role="region"
                  aria-label="Active lecture poll"
                  className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-[#ed793c] bg-[#fffdf8] shadow-sm"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ed793c] animate-pulse shrink-0" />
                    <span className="text-sm font-semibold text-[#2b2a2e] truncate">
                      Active poll:{" "}
                      {conceptLabels.get(lectureState.poll.question.conceptId) || "Lecture question"}
                    </span>
                  </div>
                  <Button
                    onClick={() => {
                      setLectureState((prev) =>
                        prev
                          ? reduceStudentLectureState(
                              prev,
                              { type: "poll:open", pollId: lectureState.poll.question!.id },
                              knownConceptIdsRef.current
                            )
                          : null
                      );
                    }}
                    className="min-h-[44px] shrink-0 font-semibold"
                  >
                    Answer poll
                  </Button>
                </div>
              )}

            {!lectureState.poll.isOpen &&
              lectureState.poll.submission.status === "submitting" && (
                <div
                  role="status"
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-[#e6d8bd] bg-[#fffdf8] shadow-sm text-sm text-[#2b2a2e]"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-[#f4bc55] animate-pulse shrink-0" />
                  <span className="font-medium">Evaluating your poll answer…</span>
                </div>
              )}

            {!lectureState.poll.isOpen &&
              lectureState.poll.submission.status === "evaluated" && (
                <EvaluationCard
                  result={lectureState.poll.submission.result}
                  conceptLabel={
                    conceptLabels.get(lectureState.poll.question.conceptId) || "Lecture question"
                  }
                  skyBrightness={skyBrightness}
                />
              )}

            {!lectureState.poll.isOpen &&
              lectureState.poll.submission.status === "error" && (
                <div
                  role="alert"
                  className="rounded-xl border border-[#b0384a] bg-[#f8e0e3] p-4 text-sm text-[#2b2a2e]"
                >
                  <p className="font-semibold text-[#b0384a] mb-0.5">Poll submission error</p>
                  <p className="text-xs leading-relaxed">{lectureState.poll.submission.message}</p>
                </div>
              )}
          </div>
        )}


        {/* Mobile View Switcher (segmented controls with 44px hit targets) */}
        <div className="flex gap-2 p-1 bg-[var(--color-bg-canvas)] border border-[var(--color-border-default)] rounded-lg md:hidden">
          <Button
            variant={mobileTab === "graph" ? "default" : "outline"}
            aria-pressed={mobileTab === "graph"}
            className="flex-1 min-h-[44px]"
            onClick={() => setMobileTab("graph")}
          >
            Star Graph
          </Button>
          <Button
            variant={mobileTab === "stream" ? "default" : "outline"}
            aria-pressed={mobileTab === "stream"}
            className="flex-1 min-h-[44px]"
            onClick={() => setMobileTab("stream")}
          >
            Lecture Stream
          </Button>
        </div>

        {/* Responsive Grid Structure:
            - Mobile (<768px): flex column with active tab toggling
            - Tablet (768px-1023px): flex column stacked: Spark -> Graph -> Stream
            - Desktop (1024px-1359px): 2 columns 65/35: Left Graph, Right Spark + Stream
            - Wide (>=1360px): 3 columns 20/55/25: Left Spark Rail, Center Graph, Right Stream
        */}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[65fr_35fr] 2xl:grid-cols-[20fr_55fr_25fr]">
          {/* Panel 1: Spark Companion Rail */}
          <div
            className={`order-1 2xl:order-1 2xl:col-start-1 lg:order-2 lg:col-start-2 lg:row-start-1 ${
              mobileTab === "stream" ? "hidden md:block" : "block"
            }`}
          >
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle as="h2" className="text-sm font-semibold">
                  Spark Companion
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center p-4">
                <div data-testid="spark-mascot-container" className="py-2">
                  <SparkMascot
                    skyBrightness={skyBrightness}
                    mood={sparkMood}
                    size={132}
                  />
                </div>
                <p className="text-xs font-medium text-[var(--color-fg-muted)] text-center mt-2">
                  {masteryCaption}
                </p>
                <p className="text-xs text-center mt-1">
                  {displayedActiveConceptIds.length > 0 ? (
                    <span className="font-semibold text-[var(--color-active-concept,#ed793c)]">
                      Actively following lecture concepts
                    </span>
                  ) : (
                    <span className="text-[var(--color-fg-muted)]">Attentive & listening</span>
                  )}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Panel 2: Knowledge Graph Visualization */}
          <div
            className={`order-2 2xl:order-2 2xl:col-start-2 lg:order-1 lg:col-start-1 lg:row-start-1 lg:row-span-2 ${
              mobileTab === "stream" ? "hidden md:block" : "block"
            }`}
          >
            {graphLoading ? (
              <div className="h-[440px] md:h-[560px] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-panel)] flex items-center justify-center text-[var(--color-fg-muted)] text-sm">
                Loading knowledge graph…
              </div>
            ) : courseGraph ? (
              <KnowledgeGraph
                graph={courseGraph}
                activeConceptIds={displayedActiveConceptIds}
              />
            ) : null}
          </div>

          {/* Panel 3: Live Lecture Stream & Transcript Timeline */}
          <div
            className={`order-3 2xl:order-3 2xl:col-start-3 lg:order-3 lg:col-start-2 lg:row-start-2 ${
              mobileTab === "graph" ? "hidden md:block" : "block"
            }`}
          >
            {/* Live Lectures Picker if no active lecture selected */}
            {!lectureState && availableLiveLectures.length > 0 && (
              <Card className="w-full mb-4">
                <CardHeader>
                  <CardTitle as="h2">Live Lectures in Session</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-[var(--color-fg-muted)] mb-3">
                    Select an ongoing lecture to join the live feed:
                  </p>
                  {availableLiveLectures.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)]"
                    >
                      <div>
                        <p className="font-semibold text-sm text-[var(--color-fg-default)]">
                          {item.title}
                        </p>
                        <p className="text-xs text-[var(--color-fg-muted)]">
                          Started {new Date(item.startedAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSelectLiveLecture(item.id)}
                      >
                        Join
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {!lectureState && availableLiveLectures.length === 0 && !lectureLoading && (
              <Card className="w-full">
                <CardContent className="p-6 text-center text-sm text-[var(--color-fg-muted)]">
                  No live lecture currently in progress for this course.
                </CardContent>
              </Card>
            )}

            {/* Transcript Feed */}
            {lectureState && (
              <TranscriptFeed
                chunks={lectureState.chunks}
                conceptLabels={conceptLabels}
                isSimulated={provenance}
                lectureStatus={lectureState.lecture.status}
              />
            )}
          </div>
        </div>
      </div>

      {/* Active Poll Modal */}
      {lectureState?.poll.question && (
        <ActivePollModal
          poll={lectureState.poll}
          conceptLabel={
            conceptLabels.get(lectureState.poll.question.conceptId) || "Lecture question"
          }
          skyBrightness={skyBrightness}
          canSubmit={
            lectureState.poll.answer.trim().length > 0 &&
            lectureState.poll.submission.status === "idle" &&
            connectionStatus === "connected"
          }
          onAnswerChange={(answer) => {
            if (lectureState.poll.question) {
              setLectureState((prev) =>
                prev
                  ? reduceStudentLectureState(
                      prev,
                      {
                        type: "poll:answer-changed",
                        pollId: lectureState.poll.question!.id,
                        answer,
                      },
                      knownConceptIdsRef.current
                    )
                  : null
              );
            }
          }}
          onSubmit={handleSubmitAnswer}
          onClose={() => {
            if (lectureState.poll.question) {
              setLectureState((prev) =>
                prev
                  ? reduceStudentLectureState(
                      prev,
                      {
                        type: "poll:dismiss",
                        pollId: lectureState.poll.question!.id,
                      },
                      knownConceptIdsRef.current
                    )
                  : null
              );
            }
          }}
        />
      )}
    </AppShell>
  );
}
