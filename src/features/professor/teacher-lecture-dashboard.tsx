"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import type { UUID } from "@/contracts/common";
import {
  lectureSessionSchema,
  lectureSnapshotSchema,
  type LectureSession,
  type TranscriptChunk,
} from "@/contracts/classroom";
import { courseGraphResponseSchema } from "@/contracts/course";
import {
  transcriptChunkEventSchema,
  conceptDetectedEventSchema,
  lectureEndedEventSchema,
  pollNewQuestionEventSchema,
  pollClosedEventSchema,
  pollResponseCountEventSchema,
  heatmapUpdatedEventSchema,
  type TranscriptChunkEvent,
  type ConceptDetectedEvent,
} from "@/contracts/realtime";
import { AppShell } from "@/components/ui/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SignInPrompt } from "@/features/auth/sign-in-prompt";
import { requestJson, ClientApiError, getRuntimeAccessToken } from "@/lib/client/http";
import { createLectureSocket, type LectureSocket } from "@/lib/client/socket";
import { LectureControls } from "./lecture-controls";
import { TranscriptFeed } from "./transcript-feed";
import { mergeTranscriptChunks } from "./teacher-lecture-state";
import { useTeacherPolls } from "./use-teacher-polls";
import { PollPanel } from "./poll-panel";
import { ClassHeatmap } from "./class-heatmap";
import { ClassSky } from "./class-sky";
import { cn } from "@/lib/client/utils";

export interface TeacherLectureDashboardProps {
  courseId: UUID;
  lectureId?: UUID;
  getAccessToken?: () => Promise<string | null>;
  initialToken?: string | null;
}

type FeedConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

function deriveSnapshotProvenance(chunks: readonly TranscriptChunk[]): boolean | null {
  if (chunks.length === 0) return null;
  if (chunks.some((c) => c.isSimulated === true)) return true;
  if (chunks.every((c) => c.isSimulated === false)) return false;
  return null;
}


export function TeacherLectureDashboard({
  courseId,
  lectureId: initialLectureId,
  getAccessToken = getRuntimeAccessToken,
  initialToken,
}: TeacherLectureDashboardProps): React.JSX.Element {
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [authChecking, setAuthChecking] = useState<boolean>(initialToken === undefined);
  const [authForbidden, setAuthForbidden] = useState<boolean>(false);

  const [activeLectureId, setActiveLectureId] = useState<UUID | undefined>(initialLectureId);
  const [lecture, setLecture] = useState<LectureSession | null>(null);
  const [availableLiveLectures, setAvailableLiveLectures] = useState<LectureSession[]>([]);
  const [chunks, setChunks] = useState<TranscriptChunk[]>([]);
  const [conceptLabels, setConceptLabels] = useState<Map<UUID, string>>(new Map());
  const [isSimulated, setIsSimulated] = useState<boolean | null>(null);
  const [courseConcepts, setCourseConcepts] = useState<Array<{ id: UUID; label: string; category?: string }>>([]);
  const [activeTab, setActiveTab] = useState<"live" | "class-sky">("live");
  const liveTabRef = useRef<HTMLButtonElement>(null);
  const classSkyTabRef = useRef<HTMLButtonElement>(null);

  const handleClassSkyAuthError = useCallback((status: 401 | 403) => {
    if (status === 401) {
      setToken(null);
    } else if (status === 403) {
      setAuthForbidden(true);
    }
  }, []);

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    current: "live" | "class-sky",
  ) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      if (current === "live") {
        setActiveTab("class-sky");
        classSkyTabRef.current?.focus();
      } else {
        setActiveTab("live");
        liveTabRef.current?.focus();
      }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      if (current === "class-sky") {
        setActiveTab("live");
        liveTabRef.current?.focus();
      } else {
        setActiveTab("class-sky");
        classSkyTabRef.current?.focus();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveTab("live");
      liveTabRef.current?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveTab("class-sky");
      classSkyTabRef.current?.focus();
    }
  };

  const getEffectiveToken = useCallback(async () => {
    if (token) return token;
    if (getAccessToken) return getAccessToken();
    return getRuntimeAccessToken();
  }, [token, getAccessToken]);

  const currentLectureId = lecture?.id ?? activeLectureId ?? null;
  const teacherPolls = useTeacherPolls({
    courseId,
    lectureId: currentLectureId,
    getAccessToken: getEffectiveToken,
  });
  const teacherPollsRef = useRef(teacherPolls);
  teacherPollsRef.current = teacherPolls;

  const [isLoadingCourseData, setIsLoadingCourseData] = useState<boolean>(false);
  const [lifecyclePending, setLifecyclePending] = useState<"start" | "end" | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<FeedConnectionStatus>("idle");

  const socketRef = useRef<LectureSocket | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const inFlightSnapshotRef = useRef<boolean>(false);
  const dirtySnapshotRef = useRef<boolean>(false);
  const lectureGenerationRef = useRef<number>(0);

  // 1. Resolve authentication on mount
  useEffect(() => {
    if (initialToken !== undefined) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const resolvedToken = await getAccessToken();
        if (active) {
          setToken(resolvedToken);
          setAuthChecking(false);
        }
      } catch {
        if (active) {
          setToken(null);
          setAuthChecking(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [getAccessToken, initialToken]);

  // Snapshot fetching helper with deduplication and dirty flag coalescing
  const refreshSnapshot = useCallback(
    async (targetLectureId: UUID, currentToken: string, generation: number) => {
      if (inFlightSnapshotRef.current) {
        dirtySnapshotRef.current = true;
        return;
      }
      inFlightSnapshotRef.current = true;

      try {
        const snapshot = await requestJson(
          `/api/lectures/${encodeURIComponent(targetLectureId)}/snapshot`,
          lectureSnapshotSchema,
          {
            getAccessToken: async () => currentToken,
          }
        );

        if (generation !== lectureGenerationRef.current) {
          return;
        }

        setLecture((prev) => {
          if (prev && prev.status === "completed" && snapshot.lecture.status === "live") {
            return prev;
          }
          return snapshot.lecture;
        });

        const snapshotProvenance = deriveSnapshotProvenance(snapshot.recentChunks);
        setIsSimulated(snapshotProvenance);

        setChunks((prev) => mergeTranscriptChunks(prev, snapshot.recentChunks));
      } catch (err: unknown) {
        console.error("[Dashboard] Snapshot refresh failed", err);
      } finally {
        inFlightSnapshotRef.current = false;
        if (dirtySnapshotRef.current && generation === lectureGenerationRef.current) {
          dirtySnapshotRef.current = false;
          void refreshSnapshot(targetLectureId, currentToken, generation);
        }
      }
    },
    []
  );

  // 2. Load course graph and lecture details once authenticated
  useEffect(() => {
    if (!token) return;

    let abort = false;
    const generation = ++lectureGenerationRef.current;
    setIsLoadingCourseData(true);
    setDashboardError(null);

    void (async () => {
      try {
        // Parallel fetch: course graph and lectures
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

        // Process Graph
        if (graphResult.status === "fulfilled") {
          const map = new Map<UUID, string>();
          for (const node of graphResult.value.nodes) {
            map.set(node.id, node.label);
          }
          setConceptLabels(map);
          setCourseConcepts(graphResult.value.nodes.map((n) => ({ id: n.id, label: n.label, category: n.category })));
        } else {
          console.warn("[Dashboard] Course graph unavailable, concept labels fallback active");
        }

        // Process Lecture List
        if (lectureListResult.status === "fulfilled") {
          const live = lectureListResult.value.filter((l) => l.status === "live");
          setAvailableLiveLectures(live);
        }

        // If an initial lectureId was provided, load its snapshot
        if (activeLectureId) {
          try {
            const snapshot = await requestJson(
              `/api/lectures/${encodeURIComponent(activeLectureId)}/snapshot`,
              lectureSnapshotSchema,
              { getAccessToken: async () => token }
            );

            if (abort || generation !== lectureGenerationRef.current) return;

            if (snapshot.lecture.courseId.toLowerCase() !== courseId.toLowerCase()) {
              setDashboardError("Selected lecture does not belong to this course.");
              setLecture(null);
              setChunks([]);
              return;
            }

            setLecture(snapshot.lecture);
            setChunks(snapshot.recentChunks);
            const snapshotProvenance = deriveSnapshotProvenance(snapshot.recentChunks);
            setIsSimulated(snapshotProvenance);
          } catch (snapshotErr: unknown) {
            if (abort) return;
            if (snapshotErr instanceof ClientApiError) {
              if (snapshotErr.status === 404) {
                setDashboardError("Requested lecture was not found.");
              } else if (snapshotErr.status === 403) {
                setAuthForbidden(true);
              } else {
                setDashboardError(snapshotErr.message);
              }
            } else {
              setDashboardError("Failed to load lecture snapshot.");
            }
          }
        }
      } catch (err: unknown) {
        if (abort) return;
        if (err instanceof ClientApiError && err.status === 403) {
          setAuthForbidden(true);
        } else {
          setDashboardError("Failed to initialize course lecture workspace.");
        }
      } finally {
        if (!abort) {
          setIsLoadingCourseData(false);
        }
      }
    })();

    return () => {
      abort = true;
    };
  }, [courseId, activeLectureId, token]);

  // 3. Manage live Socket.IO connection for live lectures
  useEffect(() => {
    if (!token || !lecture || lecture.status !== "live") {
      setConnectionStatus("idle");
      return;
    }

    const currentLectureId = lecture.id;
    const generation = lectureGenerationRef.current;
    setConnectionStatus("connecting");

    const socket = createLectureSocket(token);
    socketRef.current = socket;

    // Attach validated event handlers BEFORE connecting
    socket.on("connect", () => {
      setConnectionStatus("connecting");
      let ackTimeout: NodeJS.Timeout | null = setTimeout(() => {
        setConnectionStatus("error");
        setDashboardError("Classroom room authorization timed out.");
      }, 5000);

      socket.emit("lecture:join", { lectureId: currentLectureId }, (ack) => {
        if (ackTimeout) {
          clearTimeout(ackTimeout);
          ackTimeout = null;
        }

        if (ack && ack.success) {
          setConnectionStatus("connected");
          // Re-fetch snapshot to reconcile any chunks missed during connection/reconnection
          void refreshSnapshot(currentLectureId, token, generation);
          void teacherPollsRef.current.refresh();
        } else {
          setConnectionStatus("error");
          setDashboardError(ack?.error || "Failed to join live classroom session.");
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
      if (seenEventIdsRef.current.has(event.eventId)) return;
      seenEventIdsRef.current.add(event.eventId);

      if (typeof event.isSimulated === "boolean") {
        setIsSimulated(event.isSimulated);
      }

      const newChunk: TranscriptChunk = {
        id: event.chunkId,
        lectureId: event.lectureId,
        text: event.text,
        timestampSec: event.timestampSec,
        speakerName: event.speakerName,
        detectedConceptIds: [],
        isSimulated: event.isSimulated,
        createdAt: event.occurredAt,
      };

      setChunks((prev) => mergeTranscriptChunks(prev, [newChunk]));
    });

    socket.on("lecture:concept-detected", (rawPayload: unknown) => {
      const parsed = conceptDetectedEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const event: ConceptDetectedEvent = parsed.data;

      if (event.lectureId !== currentLectureId) return;
      if (seenEventIdsRef.current.has(event.eventId)) return;
      seenEventIdsRef.current.add(event.eventId);

      // Trigger snapshot refresh to attach authoritative per-chunk detected concepts
      void refreshSnapshot(currentLectureId, token, generation);
    });

    socket.on("poll:new-question", (rawPayload: unknown) => {
      const parsed = pollNewQuestionEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      if (parsed.data.lectureId !== currentLectureId) return;
      teacherPollsRef.current.handleEvent({ type: "poll:new-question", payload: parsed.data });
    });

    socket.on("poll:closed", (rawPayload: unknown) => {
      const parsed = pollClosedEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      if (parsed.data.lectureId !== currentLectureId) return;
      teacherPollsRef.current.handleEvent({ type: "poll:closed", payload: parsed.data });
    });

    socket.on("poll:response-count", (rawPayload: unknown) => {
      const parsed = pollResponseCountEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      if (parsed.data.lectureId !== currentLectureId) return;
      teacherPollsRef.current.handleEvent({ type: "poll:response-count", payload: parsed.data });
    });

    socket.on("heatmap:updated", (rawPayload: unknown) => {
      const parsed = heatmapUpdatedEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      if (parsed.data.courseId !== courseId) return;
      teacherPollsRef.current.handleEvent({ type: "heatmap:updated", payload: parsed.data });
    });

    socket.on("lecture:ended", (rawPayload: unknown) => {
      const parsed = lectureEndedEventSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.lectureId === currentLectureId) {
        setLecture((prev) => (prev ? { ...prev, status: "completed", endedAt: event.occurredAt } : null));
        setConnectionStatus("idle");
        socket.disconnect();
      }
        teacherPollsRef.current.handleEvent({ type: "lecture:ended", payload: event });
    });

    socket.connect();

    return () => {
      if (socket.connected) {
        socket.emit("lecture:leave", { lectureId: currentLectureId }, () => {});
      }
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [lecture?.id, lecture?.status, token, refreshSnapshot]);

  // Lifecycle actions
  const handleStartLecture = async (title: string) => {
    if (!token) return;
    setLifecyclePending("start");
    setDashboardError(null);

    try {
      const created = await requestJson(
        `/api/courses/${encodeURIComponent(courseId)}/lectures`,
        lectureSessionSchema,
        {
          method: "POST",
          body: { title },
          getAccessToken: async () => token,
        }
      );

      if (created.courseId.toLowerCase() !== courseId.toLowerCase()) {
        throw new Error("Created lecture course mismatch");
      }

      lectureGenerationRef.current++;
      setLecture(created);
      setActiveLectureId(created.id);
      setChunks([]);
      setIsSimulated(null);
      seenEventIdsRef.current.clear();

      // Persist lectureId in URL query without page reload
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("lectureId", created.id);
        window.history.replaceState({}, "", url.toString());
      }
    } catch (err: unknown) {
      if (err instanceof ClientApiError) {
        setDashboardError(err.message);
      } else {
        setDashboardError("Failed to start lecture session. Please try again.");
      }
    } finally {
      setLifecyclePending(null);
    }
  };

  const handleEndLecture = async () => {
    if (!token || !lecture) return;
    setLifecyclePending("end");
    setDashboardError(null);

    try {
      const ended = await requestJson(
        `/api/lectures/${encodeURIComponent(lecture.id)}/end`,
        lectureSessionSchema,
        {
          method: "POST",
          getAccessToken: async () => token,
        }
      );

      setLecture(ended);
      if (socketRef.current?.connected) {
        socketRef.current.disconnect();
      }
      setConnectionStatus("idle");
    } catch (err: unknown) {
      if (err instanceof ClientApiError) {
        if (err.status === 409) {
          // Conflict: reconcile with fresh snapshot
          void refreshSnapshot(lecture.id, token, lectureGenerationRef.current);
        } else {
          setDashboardError(err.message);
        }
      } else {
        setDashboardError("Failed to end lecture session. Please try again.");
      }
    } finally {
      setLifecyclePending(null);
    }
  };

  // Render branches
  if (authChecking) {
    return (
      <AppShell
        title="Instructor workspace"
        description="Manage courses, monitor student progress across knowledge graphs, and run interactive lectures."
        workspace="teacher"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Instructor workspace", href: "/professor/dashboard" },
        ]}
      >
        <div className="flex items-center justify-center p-12 text-sm text-[var(--color-fg-muted)]">
          Verifying instructor session…
        </div>
      </AppShell>
    );
  }

  if (!token) {
    return (
      <AppShell
        title="Instructor workspace"
        description="Manage courses, monitor student progress across knowledge graphs, and run interactive lectures."
        workspace="teacher"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Instructor workspace", href: "/professor/dashboard" },
        ]}
        sessionStatus="anonymous"
      >
        <SignInPrompt />
      </AppShell>
    );
  }

  if (authForbidden) {
    return (
      <AppShell
        title="Instructor workspace"
        description="Manage courses, monitor student progress across knowledge graphs, and run interactive lectures."
        workspace="teacher"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Instructor workspace", href: "/professor/dashboard" },
        ]}
        sessionStatus="authenticated"
      >
        <div
          role="alert"
          className="rounded-xl border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-danger-soft,#f8e0e3)] p-6 text-[var(--color-fg-default)]"
        >
          <p className="font-semibold text-[var(--color-fg-default)] mb-2">
            Access Restricted
          </p>
          <p className="text-sm text-[var(--color-fg-muted)]">
            You do not have instructor permissions for this course.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Live Lecture Dashboard"
      description="Start and manage lecture sessions, monitor streaming transcripts, and inspect real-time concept highlights."
      workspace="teacher"
      breadcrumbs={[
        { label: "Home", href: "/" },
        { label: "Instructor workspace", href: "/professor/dashboard" },
        { label: "Live lecture", href: `/professor/dashboard?courseId=${courseId}` },
      ]}
      sessionStatus="authenticated"
    >
      <div className="space-y-6">
        {/* Workspace Tab Navigation */}
        <div className="border-b border-paper-line">
          <div
            role="tablist"
            aria-label="Instructor workspace views"
            className="flex items-center gap-2 -mb-px"
          >
            <button
              ref={liveTabRef}
              type="button"
              role="tab"
              id="tab-live-lecture"
              aria-controls="panel-live-lecture"
              aria-selected={activeTab === "live"}
              tabIndex={activeTab === "live" ? 0 : -1}
              onClick={() => setActiveTab("live")}
              onKeyDown={(e) => handleTabKeyDown(e, "live")}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                activeTab === "live"
                  ? "border-accent text-ink font-semibold bg-paper"
                  : "border-transparent text-muted hover:text-ink hover:bg-paper-muted/50",
              )}
            >
              Live lecture
            </button>
            <button
              ref={classSkyTabRef}
              type="button"
              role="tab"
              id="tab-class-sky"
              aria-controls="panel-class-sky"
              aria-selected={activeTab === "class-sky"}
              tabIndex={activeTab === "class-sky" ? 0 : -1}
              onClick={() => setActiveTab("class-sky")}
              onKeyDown={(e) => handleTabKeyDown(e, "class-sky")}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                activeTab === "class-sky"
                  ? "border-accent text-ink font-semibold bg-paper"
                  : "border-transparent text-muted hover:text-ink hover:bg-paper-muted/50",
              )}
            >
              Class Sky
            </button>
          </div>
        </div>

        {/* Tab Panel 1: Live lecture content (kept mounted when inactive) */}
        <div
          role="tabpanel"
          id="panel-live-lecture"
          aria-labelledby="tab-live-lecture"
          hidden={activeTab !== "live"}
          className={cn("space-y-6", activeTab !== "live" && "hidden")}
        >
          {isLoadingCourseData && (
            <div className="text-xs text-[var(--color-fg-muted)] animate-pulse">
              Syncing course data…
            </div>
          )}
        {/* Connection & Status Banner */}
        {lecture && lecture.status === "live" && (
          <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-[var(--color-bg-panel)] border border-[var(--color-border-default)] text-xs">
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
                {connectionStatus === "idle" && "Feed disconnected"}
              </span>
            </div>
            <span className="text-[var(--color-fg-muted)]">Room: lecture:{lecture.id}</span>
          </div>
        )}

        {dashboardError && (
          <div
            role="alert"
            className="rounded-lg border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-danger-soft,#f8e0e3)] p-4 text-sm text-[var(--color-fg-default)]"
          >
            {dashboardError}
          </div>
        )}

        {/* Existing Live Lectures Picker (if none currently selected) */}
        {!lecture && availableLiveLectures.length > 0 && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle as="h2">Resume Active Lecture</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[var(--color-fg-muted)] mb-3">
                There are ongoing live lecture sessions for this course:
              </p>
              <div className="space-y-2">
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
                      onClick={() => {
                        setActiveLectureId(item.id);
                        if (typeof window !== "undefined") {
                          const url = new URL(window.location.href);
                          url.searchParams.set("lectureId", item.id);
                          window.history.replaceState({}, "", url.toString());
                        }
                      }}
                    >
                      Resume
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Lecture Controls */}
        <LectureControls
          lecture={lecture}
          pending={lifecyclePending}
          error={dashboardError}
          onStart={handleStartLecture}
          onEnd={handleEndLecture}
        />

        {/* Transcript Timeline Feed & Formative Polls Side-by-Side on Desktop */}
        {lecture && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
            <TranscriptFeed
              chunks={chunks}
              conceptLabels={conceptLabels}
              isSimulated={isSimulated}
              lectureStatus={lecture.status}
            />
            <PollPanel
              isLive={lecture.status === "live"}
              concepts={courseConcepts}
              hook={teacherPolls}
            />
          </div>
        )}

        {/* Course Mastery Heatmap Full Width Below */}
          <ClassHeatmap
            heatmap={teacherPolls.state.heatmap}
            loading={teacherPolls.heatmapLoading}
            error={teacherPolls.heatmapError}
          />
        </div>

        {/* Tab Panel 2: Class Sky content (mounted when tab is active) */}
        <div
          role="tabpanel"
          id="panel-class-sky"
          aria-labelledby="tab-class-sky"
          hidden={activeTab !== "class-sky"}
          className={cn("space-y-6", activeTab !== "class-sky" && "hidden")}
        >
          {activeTab === "class-sky" && (
            <ClassSky
              key={courseId}
              courseId={courseId}
              getAccessToken={getEffectiveToken}
              onAuthError={handleClassSkyAuthError}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
