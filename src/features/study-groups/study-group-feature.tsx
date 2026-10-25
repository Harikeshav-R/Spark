"use client";

import React, { useState, useEffect, useCallback, useId, useRef } from "react";
import type { UUID } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import { courseGraphResponseSchema } from "@/contracts/course";
import { studyGroupOptInResponseSchema } from "@/contracts/classroom";
import { studyGroupMatchedEventSchema, type StudyGroupMatchedEvent } from "@/contracts/realtime";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
import { createLectureSocket, type LectureSocket } from "@/lib/client/socket";
import {
  FeatureErrorBoundary,
  FeatureErrorNotice,
} from "@/features/learning/feature-error-boundary";
import { z } from "zod";

export interface StudyGroupFeatureProps {
  studentId: UUID;
  courseId: UUID;
  initialConcepts?: ConceptNode[];
  className?: string;
}

export type ConceptView = {
  id: UUID;
  label: string;
  description: string;
  category: string;
  difficulty: number;
};

export type LobbyState =
  | "idle"
  | "joining"
  | "waiting"
  | "leaving"
  | "matched"
  | "expired";

function formatSeconds(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function InnerStudyGroupView({
  studentId,
  courseId,
  initialConcepts,
  className = "",
}: StudyGroupFeatureProps): React.JSX.Element {
  const baseId = useId();

  // Concepts state
  const [concepts, setConcepts] = useState<ConceptView[]>(() => {
    if (initialConcepts) {
      return initialConcepts.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        category: c.category,
        difficulty: c.difficulty,
      }));
    }
    return [];
  });
  const [isLoadingConcepts, setIsLoadingConcepts] = useState<boolean>(initialConcepts === undefined);
  const [conceptError, setConceptError] = useState<string | null>(null);

  // Selection state (1 to 3 concepts)
  const [selectedConceptIds, setSelectedConceptIds] = useState<UUID[]>([]);

  // Lobby state
  const [lobbyState, setLobbyState] = useState<LobbyState>("idle");
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Match & Expiration data
  const [matchId, setMatchId] = useState<UUID | null>(null);
  const [matchedPeerName, setMatchedPeerName] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  // Socket state
  const [socketDisconnected, setSocketDisconnected] = useState<boolean>(false);
  const socketRef = useRef<LectureSocket | null>(null);
  const bufferedMatchEventRef = useRef<StudyGroupMatchedEvent | null>(null);
  const selectedConceptIdsRef = useRef<UUID[]>(selectedConceptIds);
  selectedConceptIdsRef.current = selectedConceptIds;

  // Fetch course graph if initialConcepts omitted
  const fetchConcepts = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoadingConcepts(true);
      setConceptError(null);
      try {
        const data = await requestJson(
          `/api/courses/${courseId}/graph`,
          courseGraphResponseSchema,
          { getAccessToken: getRuntimeAccessToken, signal }
        );
        const mapped: ConceptView[] = data.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          description: n.description,
          category: n.category,
          difficulty: n.difficulty,
        }));
        setConcepts(mapped);
      } catch (err: unknown) {
        if (signal?.aborted) return;
        setConceptError(
          err instanceof Error ? err.message : "Failed to load course concepts for study groups."
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoadingConcepts(false);
        }
      }
    },
    [courseId]
  );

  useEffect(() => {
    if (initialConcepts !== undefined) {
      setConcepts(
        initialConcepts.map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description,
          category: c.category,
          difficulty: c.difficulty,
        }))
      );
      setIsLoadingConcepts(false);
      return;
    }

    const controller = new AbortController();
    fetchConcepts(controller.signal);
    return () => {
      controller.abort();
    };
  }, [initialConcepts, fetchConcepts]);

  // Setup Socket.IO client
  useEffect(() => {
    let cancelled = false;

    async function initSocket() {
      const token = await getRuntimeAccessToken();
      if (cancelled || !token) return;

      const socket = createLectureSocket(token);
      socketRef.current = socket;

      socket.on("connect", () => {
        setSocketDisconnected(false);
      });

      socket.on("disconnect", () => {
        setSocketDisconnected(true);
      });

      socket.on("connect_error", () => {
        setSocketDisconnected(true);
      });

      socket.on("study-group:matched", (rawData: unknown) => {
        const parsed = studyGroupMatchedEventSchema.safeParse(rawData);
        if (!parsed.success) return;

        const event = parsed.data;
        // Verify current course
        if (event.courseId !== courseId) return;

        // Verify overlapping concept
        const hasOverlap = event.conceptIds.some((cid) =>
          selectedConceptIdsRef.current.includes(cid)
        );
        if (!hasOverlap) return;

        // Valid match!
        bufferedMatchEventRef.current = event;
        setMatchId(event.matchId);
        setMatchedPeerName(event.peerName);
        setLobbyState("matched");
        setErrorNotice(null);
      });

      socket.connect();
    }

    initSocket();

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [courseId]);

  // Expiration timer countdown
  useEffect(() => {
    if (lobbyState !== "waiting" || !expiresAt) {
      return;
    }

    function updateRemaining() {
      const diffMs = new Date(expiresAt!).getTime() - Date.now();
      const secs = Math.max(0, Math.floor(diffMs / 1000));
      setRemainingSeconds(secs);
      if (secs <= 0) {
        setLobbyState("expired");
      }
    }

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [lobbyState, expiresAt]);

  // Handle Checkbox Selection
  const handleToggleConcept = (id: UUID) => {
    if (lobbyState !== "idle") return;

    setSelectedConceptIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= 3) {
        return prev;
      }
      return [...prev, id];
    });
  };

  // Join Study Pool (Opt-in)
  const handleOptIn = async () => {
    if (lobbyState !== "idle" || selectedConceptIds.length === 0) {
      return;
    }

    setLobbyState("joining");
    setErrorNotice(null);

    try {
      const response = await requestJson(
        `/api/courses/${courseId}/study-groups/opt-in`,
        studyGroupOptInResponseSchema,
        {
          method: "POST",
          getAccessToken: getRuntimeAccessToken,
          body: {
            conceptIds: selectedConceptIds,
          },
        }
      );

      // If an event arrived while request was pending, keep matched state
      if (bufferedMatchEventRef.current) {
        setLobbyState("matched");
        return;
      }

      if (response.status === "matched") {
        if (!response.matchId) {
          throw new Error("Server returned matched status without a valid match ID.");
        }
        setMatchId(response.matchId);
        setLobbyState("matched");
      } else {
        setExpiresAt(response.expiresAt);
        setLobbyState("waiting");
      }
    } catch (err: unknown) {
      if (bufferedMatchEventRef.current) {
        setLobbyState("matched");
        return;
      }
      setErrorNotice(
        err instanceof Error ? err.message : "Failed to join study matchmaking pool."
      );
      setLobbyState("idle");
    }
  };

  // Leave Study Pool (Opt-out)
  const handleOptOut = async () => {
    if (lobbyState !== "waiting") {
      return;
    }

    setLobbyState("leaving");
    setErrorNotice(null);

    try {
      await requestJson(
        `/api/courses/${courseId}/study-groups/opt-out`,
        z.object({ success: z.literal(true) }),
        {
          method: "POST",
          getAccessToken: getRuntimeAccessToken,
        }
      );

      // If a match event arrived concurrently, it wins
      if (bufferedMatchEventRef.current) {
        setLobbyState("matched");
        return;
      }

      setLobbyState("idle");
      setExpiresAt(null);
    } catch (err: unknown) {
      if (bufferedMatchEventRef.current) {
        setLobbyState("matched");
        return;
      }
      setErrorNotice(
        err instanceof Error ? err.message : "Failed to leave study pool. Please try again."
      );
      setLobbyState("waiting");
    }
  };

  const isSelectionDisabled = lobbyState !== "idle";

  return (
    <div
      className={`space-y-6 ${className}`}
      data-testid="study-group-feature"
      aria-label="Peer Study Group Lobby"
    >
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle as="h2">Peer Study Group Lobby</CardTitle>
              <CardDescription>
                Find a classmate to review concepts together through peer collaboration.
              </CardDescription>
            </div>
            <div className="text-xs font-mono text-[#5f5b54]">
              {`Student: ${studentId.slice(0, 8)}…`}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Consent and Privacy Rules Box */}
          <div className="rounded-lg border border-[#e6d8bd] bg-[#fbf5ec] p-4 text-xs text-[#5f5b54] space-y-1.5">
            <p className="font-semibold text-[#2b2a2e]">Matchmaking Consent & Privacy Rules:</p>
            <ul className="list-disc list-inside space-y-1 leading-relaxed">
              <li>Only classmates who explicitly opt in can be matched.</li>
              <li>Requests remain active in the pool for 5 minutes before expiring.</li>
              <li>The server pairs students based on complementary concept mastery.</li>
            </ul>
          </div>

          {/* Socket Disconnect Alert */}
          {socketDisconnected && (
            <FeatureErrorNotice
              message="Match updates are disconnected. Reconnect to continue receiving updates."
              onRetry={() => {
                socketRef.current?.connect();
              }}
            />
          )}

          {/* Error Notice */}
          {errorNotice && (
            <FeatureErrorNotice message={errorNotice} />
          )}

          {/* Concepts Section */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <label className="text-sm font-semibold text-[#2b2a2e]">
                Select Concepts for Peer Review (1 to 3):
              </label>
              <span className="text-xs text-[#5f5b54] font-medium">
                {selectedConceptIds.length} of 3 selected
              </span>
            </div>

            {isLoadingConcepts && (
              <div className="py-6 text-center text-sm text-[#5f5b54]">
                Loading course concepts…
              </div>
            )}

            {conceptError && (
              <FeatureErrorNotice
                message={conceptError}
                onRetry={() => fetchConcepts()}
              />
            )}

            {!isLoadingConcepts && !conceptError && concepts.length === 0 && (
              <div className="rounded-lg border border-[#e6d8bd] bg-[#fbf5ec] p-4 text-xs text-[#5f5b54]">
                No concepts are available for study group matchmaking yet.
              </div>
            )}

            {concepts.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {concepts.map((concept) => {
                  const isChecked = selectedConceptIds.includes(concept.id);
                  const isMaxReached = selectedConceptIds.length >= 3;
                  const isDisabled = isSelectionDisabled || (isMaxReached && !isChecked);
                  const checkboxId = `${baseId}-concept-${concept.id}`;

                  return (
                    <label
                      key={concept.id}
                      htmlFor={checkboxId}
                      className={`flex items-start gap-3 p-3.5 rounded-lg border text-sm transition-all cursor-pointer ${
                        isChecked
                          ? "border-[#ed793c] bg-[#fbeac2] text-[#2b2a2e] font-medium shadow-xs"
                          : "border-[#e6d8bd] bg-[#fffdf8] text-[#5f5b54] hover:border-[#ecdcc0]"
                      } ${isDisabled && !isChecked ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <input
                        type="checkbox"
                        id={checkboxId}
                        checked={isChecked}
                        disabled={isDisabled}
                        onChange={() => handleToggleConcept(concept.id)}
                        className="mt-0.5 rounded text-[#ed793c] focus:ring-[#2b2a2e]"
                        aria-label={`Select ${concept.label}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-semibold text-sm truncate text-[#2b2a2e]">
                            {concept.label}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f4e9d7] text-[#2b2a2e] shrink-0">
                            {`Diff ${concept.difficulty}`}
                          </span>
                        </div>
                        <p className="text-xs text-[#5f5b54] line-clamp-2 leading-relaxed">
                          {concept.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action & Status Panels */}
          {lobbyState === "idle" && (
            <div className="pt-3 border-t border-[#e6d8bd] flex items-center justify-between">
              <p className="text-xs text-[#5f5b54]">
                {selectedConceptIds.length === 0
                  ? "Select at least 1 concept to join the matchmaking pool."
                  : `Ready to match with ${selectedConceptIds.length} concept${
                      selectedConceptIds.length === 1 ? "" : "s"
                    }.`}
              </p>
              <Button
                type="button"
                disabled={selectedConceptIds.length === 0}
                onClick={handleOptIn}
                size="md"
              >
                Join Study Pool
              </Button>
            </div>
          )}

          {lobbyState === "joining" && (
            <div className="py-4 text-center text-sm text-[#5f5b54] italic">
              Joining study matchmaking pool…
            </div>
          )}

          {(lobbyState === "waiting" || lobbyState === "leaving") && (
            <div
              role="status"
              aria-live="polite"
              className="p-5 rounded-xl border border-[#cf951f] bg-[#fffdf8] space-y-4 shadow-xs"
              data-testid="study-pool-waiting"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h4 className="font-bold text-base text-[#2b2a2e] flex items-center gap-2">
                    <span className="animate-spin text-base">⏳</span>
                    <span>Waiting for a Study Partner…</span>
                  </h4>
                  <p className="text-xs text-[#5f5b54] mt-1 leading-relaxed">
                    Searching for a classmate with complementary concept interests in this course.
                  </p>
                  <p className="text-xs font-mono font-semibold text-[#a9481a] mt-2">
                    Request expires in: {formatSeconds(remainingSeconds)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOptOut}
                  disabled={lobbyState === "leaving"}
                  isLoading={lobbyState === "leaving"}
                >
                  Leave Study Pool
                </Button>
              </div>
            </div>
          )}

          {lobbyState === "matched" && (
            <div
              role="status"
              aria-live="polite"
              className="p-5 rounded-xl border border-[#2b7f55] bg-[#dff1e5] text-[#2b2a2e] space-y-2 shadow-xs"
              data-testid="study-pool-matched"
            >
              <h4 className="font-bold text-base text-[#2b7f55]">✨ Study Partner Matched!</h4>
              {matchedPeerName ? (
                <p className="text-sm font-medium">Matched peer: {matchedPeerName}</p>
              ) : (
                <p className="text-sm font-medium">Study partner matched</p>
              )}
              {matchId && (
                <p className="text-xs font-mono text-[#5f5b54]">Match ID: {matchId}</p>
              )}
            </div>
          )}

          {lobbyState === "expired" && (
            <div
              role="status"
              aria-live="polite"
              className="p-5 rounded-xl border border-[#e6d8bd] bg-[#fbf5ec] text-[#5f5b54] text-xs space-y-2"
              data-testid="study-pool-expired"
            >
              <p className="font-semibold text-sm text-[#2b2a2e]">Your study request expired.</p>
              <p>Join again when you are ready to study with classmates.</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  setLobbyState("idle");
                  setExpiresAt(null);
                }}
              >
                Return to Lobby
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function StudyGroupFeature(props: StudyGroupFeatureProps): React.JSX.Element {
  const resetKey = `${props.studentId}-${props.courseId}`;
  return (
    <FeatureErrorBoundary resetKey={resetKey}>
      <InnerStudyGroupView {...props} />
    </FeatureErrorBoundary>
  );
}
