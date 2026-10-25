"use client";

import React, { useState, useEffect, useCallback, useId, useRef } from "react";
import type { UUID, MasteryBand } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import { courseGraphResponseSchema } from "@/contracts/course";
import {
  type TutoringMessage,
  tutoringMessageSchema,
  createTutoringSessionResponseSchema,
  submitTutoringMessageResponseSchema,
} from "@/contracts/learning";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, getMasteryLabel } from "@/components/ui/badge";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
import { MathMarkdown } from "@/features/learning/math-markdown";
import {
  FeatureErrorBoundary,
  FeatureErrorNotice,
} from "@/features/learning/feature-error-boundary";
import { z } from "zod";

export interface TutorFeatureProps {
  studentId: UUID;
  courseId?: UUID;
  initialConceptId?: UUID;
  initialConcepts?: ConceptNode[];
  initialMessages?: TutoringMessage[];
  sessionId?: UUID;
  className?: string;
}

export type ConceptView = {
  id: UUID;
  label: string;
  description: string;
  category: string;
  difficulty: number;
  confidence?: number;
  band?: MasteryBand;
};

function InnerTutorView({
  studentId: _studentId,
  courseId,
  initialConceptId,
  initialConcepts,
  initialMessages,
  sessionId: propSessionId,
  className = "",
}: TutorFeatureProps): React.JSX.Element {
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

  const [isLoadingConcepts, setIsLoadingConcepts] = useState<boolean>(
    initialConcepts === undefined && Boolean(courseId)
  );
  const [conceptLoadError, setConceptLoadError] = useState<string | null>(null);

  const [selectedConceptId, setSelectedConceptId] = useState<UUID | undefined>(() => {
    if (initialConceptId) {
      return initialConceptId;
    }
    if (initialConcepts && initialConcepts.length > 0) {
      return initialConcepts[0].id;
    }
    return undefined;
  });

  const [activeSessionId, setActiveSessionId] = useState<UUID | undefined>(propSessionId);
  const [messages, setMessages] = useState<TutoringMessage[]>(() => initialMessages ?? []);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);

  const [inputContent, setInputContent] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Active concept view
  const activeConcept = concepts.find((c) => c.id === selectedConceptId);

  // Concept-specific confidence & band
  const [confidence, setConfidence] = useState<number | undefined>(
    activeConcept?.confidence
  );
  const [band, setBand] = useState<MasteryBand | undefined>(
    activeConcept?.band
  );

  const inputId = useId();
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Fetch course concepts if not supplied
  const fetchConcepts = useCallback(
    async (signal?: AbortSignal) => {
      if (!courseId) {
        setIsLoadingConcepts(false);
        return;
      }
      setIsLoadingConcepts(true);
      setConceptLoadError(null);
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
          confidence: n.confidence,
          band: n.band,
        }));
        setConcepts(mapped);
        if (mapped.length > 0) {
          setSelectedConceptId((curr) => {
            if (curr && mapped.some((m) => m.id === curr)) return curr;
            if (initialConceptId && mapped.some((m) => m.id === initialConceptId)) {
              return initialConceptId;
            }
            return mapped[0].id;
          });
        }
      } catch (err: unknown) {
        if (signal?.aborted) return;
        setConceptLoadError(
          err instanceof Error ? err.message : "Failed to load course concepts."
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoadingConcepts(false);
        }
      }
    },
    [courseId, initialConceptId]
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
      if (initialConcepts.length > 0) {
        setSelectedConceptId((curr) => {
          if (curr && initialConcepts.some((m) => m.id === curr)) return curr;
          if (initialConceptId && initialConcepts.some((m) => m.id === initialConceptId)) {
            return initialConceptId;
          }
          return initialConcepts[0].id;
        });
      }
      setIsLoadingConcepts(false);
      return;
    }

    const controller = new AbortController();
    fetchConcepts(controller.signal);
    return () => {
      controller.abort();
    };
  }, [initialConcepts, fetchConcepts, initialConceptId]);

  // Sync confidence/band when activeConcept updates
  useEffect(() => {
    if (activeConcept) {
      setConfidence(activeConcept.confidence);
      setBand(activeConcept.band);
    } else {
      setConfidence(undefined);
      setBand(undefined);
    }
  }, [activeConcept]);

  // Load messages if sessionId provided and initialMessages omitted
  useEffect(() => {
    if (!propSessionId || initialMessages !== undefined) {
      return;
    }
    const controller = new AbortController();
    setIsLoadingMessages(true);

    async function loadMessages() {
      try {
        const fetchedMessages = await requestJson(
          `/api/tutoring/sessions/${propSessionId}/messages`,
          z.array(tutoringMessageSchema),
          { getAccessToken: getRuntimeAccessToken, signal: controller.signal }
        );
        setMessages(fetchedMessages);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setErrorNotice(
          err instanceof Error ? err.message : "Failed to load session history."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingMessages(false);
        }
      }
    }

    loadMessages();

    return () => {
      controller.abort();
    };
  }, [propSessionId, initialMessages]);

  // Handle switching concept
  const handleConceptChange = useCallback(
    (newConceptId: UUID) => {
      if (isSubmitting) return;
      setSelectedConceptId(newConceptId);
      setActiveSessionId(undefined);
      setMessages([]);
      setInputContent("");
      setErrorNotice(null);
      const target = concepts.find((c) => c.id === newConceptId);
      setConfidence(target?.confidence);
      setBand(target?.band);
    },
    [concepts, isSubmitting]
  );

  // Send message handler
  const handleSendMessage = useCallback(
    async (e?: React.FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const trimmed = inputContent.trim();
      if (!trimmed || isSubmitting || !selectedConceptId) {
        return;
      }

      setErrorNotice(null);
      setIsSubmitting(true);

      try {
        const token = await getRuntimeAccessToken();
        if (!token) {
          setErrorNotice("Authentication required. Please sign in.");
          setIsSubmitting(false);
          return;
        }

        let sessionIdToUse = activeSessionId;

        // Lazy session creation if not created yet
        if (!sessionIdToUse) {
          const sessionRes = await requestJson(
            "/api/tutoring/sessions",
            createTutoringSessionResponseSchema,
            {
              method: "POST",
              getAccessToken: getRuntimeAccessToken,
              body: {
                conceptIds: [selectedConceptId],
              },
            }
          );
          sessionIdToUse = sessionRes.sessionId;
          setActiveSessionId(sessionIdToUse);
        }

        const apiResponse = await requestJson(
          `/api/tutoring/sessions/${sessionIdToUse}/messages`,
          submitTutoringMessageResponseSchema,
          {
            method: "POST",
            getAccessToken: getRuntimeAccessToken,
            body: {
              content: trimmed,
              conceptId: selectedConceptId,
            },
          }
        );

        const now = new Date().toISOString();
        const userMsg: TutoringMessage = {
          id: `view-user-${Date.now()}` as UUID,
          sessionId: sessionIdToUse,
          role: "user",
          content: trimmed,
          conceptId: selectedConceptId,
          understandingDetected: false,
          createdAt: now,
        };

        const asstMsg: TutoringMessage = {
          id: `view-asst-${Date.now()}` as UUID,
          sessionId: sessionIdToUse,
          role: "assistant",
          content: apiResponse.assistantContent,
          conceptId: selectedConceptId,
          understandingDetected: apiResponse.understandingDetected,
          createdAt: now,
        };

        setMessages((prev) => [...prev, userMsg, asstMsg]);
        setInputContent("");

        if (apiResponse.masteryUpdated) {
          setConfidence(apiResponse.masteryUpdated.confidence);
          setBand(apiResponse.masteryUpdated.band);
        }
      } catch (err: unknown) {
        setErrorNotice(
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while processing your message."
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [inputContent, isSubmitting, selectedConceptId, activeSessionId]
  );

  const visibleMessages = messages.filter((m) => m.role !== "system");

  return (
    <div
      className={`space-y-6 ${className}`}
      data-testid="tutor-feature"
      aria-label="Socratic Tutoring Interface"
    >
      {/* Concept Selector Header Card */}
      <Card>
        <CardHeader>
          <CardTitle as="h2">Socratic Tutoring Workspace</CardTitle>
          <CardDescription>
            Engage in interactive mathematical dialogue with Spark to build deep mastery of key concepts.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="space-y-4">
            {/* Concept Selector Section */}
            <div>
              <p className="block text-sm font-semibold text-[#2b2a2e] mb-2">
                Select Concept for Tutoring:
              </p>

              {isLoadingConcepts && (
                <div className="py-4 text-center text-sm text-[#5f5b54]">
                  Loading course concepts…
                </div>
              )}

              {conceptLoadError && (
                <FeatureErrorNotice
                  message={conceptLoadError}
                  onRetry={() => fetchConcepts()}
                  className="my-2"
                />
              )}

              {!isLoadingConcepts && !conceptLoadError && concepts.length === 0 && (
                <div className="rounded-lg border border-[#e6d8bd] bg-[#fbf5ec] p-4 text-sm text-[#5f5b54]">
                  {courseId
                    ? "No concepts are available for tutoring yet."
                    : "Select a course to load tutoring concepts."}
                </div>
              )}

              {concepts.length > 0 && (
                <div
                  role="radiogroup"
                  aria-label="Target concepts"
                  className="grid grid-cols-1 sm:grid-cols-3 gap-3"
                >
                  {concepts.map((concept) => {
                    const isSelected = concept.id === selectedConceptId;
                    return (
                      <button
                        key={concept.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        disabled={isSubmitting}
                        onClick={() => handleConceptChange(concept.id)}
                        className={`p-3 text-left rounded-lg border transition-all text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] ${
                          isSelected
                            ? "border-[#ed793c] bg-[#fbeac2] text-[#2b2a2e] font-semibold shadow-xs"
                            : "border-[#e6d8bd] bg-[#fffdf8] text-[#5f5b54] hover:border-[#ecdcc0] hover:text-[#2b2a2e]"
                        } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-medium truncate">{concept.label}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[#f4e9d7] text-[#2b2a2e] shrink-0">
                            {`Diff ${concept.difficulty}/5`}
                          </span>
                        </div>
                        <p className="text-xs text-[#5f5b54] line-clamp-2">
                          {concept.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Mastery Progress Bar */}
            <div className="space-y-1.5 pt-2 border-t border-[#e6d8bd]">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-[#2b2a2e]">
                  {confidence !== undefined
                    ? `Concept Confidence: ${Math.round(confidence * 100)}%`
                    : "Confidence not yet loaded"}
                </span>
                {band ? (
                  <Badge mastery={band} confidence={confidence}>
                    {getMasteryLabel(band, confidence)}
                  </Badge>
                ) : (
                  <span className="text-[#5f5b54] text-xs">Unrated</span>
                )}
              </div>
              <div
                className="w-full h-2.5 rounded-full bg-[#f4e9d7] overflow-hidden border border-[#e6d8bd]"
                role="progressbar"
                aria-valuenow={confidence !== undefined ? Math.round(confidence * 100) : 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Mastery Confidence Progress"
              >
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{
                    width: confidence !== undefined ? `${Math.round(confidence * 100)}%` : "0%",
                    backgroundColor:
                      band === "green"
                        ? "#2b7f55"
                        : band === "yellow"
                        ? "#f4bc55"
                        : band === "red"
                        ? "#b0384a"
                        : "#8c8980",
                  }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Socratic Chat Feed */}
      <Card className="flex flex-col min-h-[460px]">
        <CardHeader className="border-b border-[#e6d8bd] bg-[#faf6ee]/50 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-[#2b2a2e] flex items-center gap-2">
              <span>💬 Socratic Dialogue Feed</span>
              {activeConcept && (
                <span className="text-xs px-2 py-0.5 rounded bg-[#f4e9d7] text-[#a9481a] font-normal">
                  Target: {activeConcept.label}
                </span>
              )}
            </h3>
            <span className="text-xs text-[#5f5b54]">
              {visibleMessages.length} message{visibleMessages.length === 1 ? "" : "s"}
            </span>
          </div>
        </CardHeader>

        {/* Local Onboarding Instructions (Outside transcript) */}
        {visibleMessages.length === 0 && !isLoadingMessages && (
          <div className="m-4 rounded-lg border border-[#e6d8bd] bg-[#fbf5ec] p-4 text-xs text-[#5f5b54] leading-relaxed">
            <p className="font-semibold text-[#2b2a2e] mb-1">How Socratic Tutoring Works:</p>
            <p>
              Type your thoughts, partial solutions, or questions about the selected concept.
              Spark probes your intuition with targeted Socratic questions to develop deep mastery.
            </p>
          </div>
        )}

        <CardContent
          ref={transcriptRef}
          role="log"
          aria-label="Tutoring dialogue"
          className="flex-1 p-4 md:p-6 space-y-4 overflow-y-auto max-h-[500px]"
        >
          {isLoadingMessages && (
            <div className="py-8 text-center text-sm text-[#5f5b54]">
              Loading dialogue history…
            </div>
          )}

          {visibleMessages.map((msg) => {
            const isAsst = msg.role === "assistant";
            return (
              <div
                key={msg.id}
                data-testid={`tutor-message-${msg.role}`}
                className={`flex gap-3 ${isAsst ? "justify-start" : "justify-end"}`}
              >
                {isAsst && (
                  <div
                    aria-hidden="true"
                    className="w-8 h-8 rounded-full bg-[#ed793c]/20 border border-[#ed793c] flex items-center justify-center text-sm shrink-0"
                  >
                    ✨
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-xl p-4 shadow-xs border text-sm leading-relaxed ${
                    isAsst
                      ? "bg-[#fffdf8] border-[#e6d8bd] text-[#2b2a2e]"
                      : "bg-[#2b2a2e] border-[#3a3a3d] text-[#fffdf8]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5 pb-1 border-b border-[#e6d8bd]/40">
                    <span
                      className={`text-xs font-semibold ${
                        isAsst ? "text-[#a9481a]" : "text-[#f4e9d7]"
                      }`}
                    >
                      {isAsst ? "Spark (Tutor)" : "You (Student)"}
                    </span>
                    <span
                      className={`text-[10px] ${
                        isAsst ? "text-[#5f5b54]" : "text-[#ecdcc0]"
                      }`}
                    >
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <MathMarkdown content={msg.content} />

                  {/* Understanding Detected Banner */}
                  {msg.understandingDetected && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1b5e3b] bg-[#dff1e5] text-[#1b5e3b] text-xs font-semibold"
                    >
                      <span>✨</span>
                      <span>Understanding detected</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isSubmitting && (
            <div className="flex gap-3 justify-start" aria-live="polite">
              <div className="w-8 h-8 rounded-full bg-[#ed793c]/20 border border-[#ed793c] flex items-center justify-center text-sm shrink-0 animate-pulse">
                💭
              </div>
              <div className="bg-[#fffdf8] border border-[#e6d8bd] rounded-xl p-3 text-xs text-[#5f5b54] italic">
                Spark is analyzing your response and formulating the next Socratic probe…
              </div>
            </div>
          )}
        </CardContent>

        {/* Input Composer */}
        <div className="border-t border-[#e6d8bd] p-4 bg-[#fffdf8] rounded-b-xl">
          {errorNotice && (
            <FeatureErrorNotice
              message={errorNotice}
              className="mb-3"
            />
          )}

          <form onSubmit={handleSendMessage} className="space-y-3">
            <div>
              <label
                htmlFor={inputId}
                className="block text-xs font-medium text-[#5f5b54] mb-1"
              >
                Explain your reasoning or ask a question:
              </label>
              <textarea
                id={inputId}
                rows={3}
                value={inputContent}
                onChange={(e) => setInputContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={isSubmitting || !selectedConceptId}
                maxLength={2000}
                placeholder={
                  selectedConceptId
                    ? "Type your explanation or question here (Press Enter to send, Shift+Enter for new line)…"
                    : "Please select a concept above first…"
                }
                className="w-full rounded-md border border-[#3a3a3d] bg-[#fffdf8] p-3 text-sm text-[#2b2a2e] placeholder:text-[#5f5b54] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] focus-visible:ring-offset-2 disabled:opacity-50 resize-y"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[#5f5b54]">
              <span>
                Use <code>$x$</code> for inline math or <code>$$x$$</code> for display equations.
              </span>
              <div className="flex items-center gap-3">
                <span>{inputContent.length} / 2000</span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!inputContent.trim() || isSubmitting || !selectedConceptId}
                  isLoading={isSubmitting}
                >
                  Send Response
                </Button>
              </div>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}

export function TutorFeature(props: TutorFeatureProps): React.JSX.Element {
  const resetKey = `${props.studentId}-${props.courseId ?? "none"}-${props.initialConceptId ?? "none"}-${props.sessionId ?? "none"}`;
  return (
    <FeatureErrorBoundary resetKey={resetKey}>
      <InnerTutorView {...props} />
    </FeatureErrorBoundary>
  );
}
