"use client";

import React, { useState, useCallback, useId } from "react";
import type { UUID, MasteryBand } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import type { TutoringMessage } from "@/contracts/learning";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, getMasteryLabel } from "@/components/ui/badge";
import { SparkMascot } from "@/features/mascot/spark-mascot";
import type { SparkMood } from "@/features/mascot/spark-moods";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
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

// Default curriculum concepts for tutoring fallback / selection
const DEFAULT_CONCEPTS: ConceptNode[] = [
  {
    id: "33333333-3333-4333-8333-333333333331",
    courseId: "22222222-2222-4222-8222-222222222222",
    label: "Backpropagation",
    description: "Reverse-mode automatic differentiation applied to computational graphs in neural networks.",
    category: "Neural Networks",
    difficulty: 3,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    courseId: "22222222-2222-4222-8222-222222222222",
    label: "Gradient Descent Optimization",
    description: "First-order iterative optimization algorithms for finding local loss minima.",
    category: "Optimization",
    difficulty: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    courseId: "22222222-2222-4222-8222-222222222222",
    label: "Self-Attention Mechanism",
    description: "Query, Key, and Value dynamic routing for contextual sequence representations.",
    category: "Architectures",
    difficulty: 4,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
];

function confidenceToBand(c: number): MasteryBand {
  if (c < 0.1) return "gray";
  if (c < 0.4) return "red";
  if (c < 0.7) return "yellow";
  return "green";
}

/**
 * Lightweight accessible math renderer.
 * Formats LaTeX expressions delimited by $$...$$ or $...$ into styled math containers.
 */
function FormattedMathContent({ text }: { text: string }): React.JSX.Element {
  // Regex to split on display math $$...$$ and inline math $...$
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);

  return (
    <span className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part, index) => {
        if (part.startsWith("$$") && part.endsWith("$$")) {
          const expression = part.slice(2, -2).trim();
          return (
            <span
              key={index}
              role="math"
              aria-label={`Math block: ${expression}`}
              className="my-3 block overflow-x-auto rounded-lg border border-[#e6d8bd] bg-[#fffdf8] px-4 py-2.5 font-mono text-sm tracking-wide text-[#2b2a2e] shadow-inner"
            >
              {expression}
            </span>
          );
        }
        if (part.startsWith("$") && part.endsWith("$")) {
          const expression = part.slice(1, -1).trim();
          return (
            <span
              key={index}
              role="math"
              aria-label={`Math expression: ${expression}`}
              className="inline-block rounded border border-[#ecdcc0] bg-[#f4e9d7]/50 px-1.5 py-0.5 font-mono text-xs font-semibold text-[#a9481a]"
            >
              {expression}
            </span>
          );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </span>
  );
}

export function TutorFeature({
  studentId: _studentId,
  courseId: _courseId,
  initialConceptId,
  initialConcepts = DEFAULT_CONCEPTS,
  initialMessages,
  sessionId = "10101010-1010-4010-8010-101010101010",
  className = "",
}: TutorFeatureProps): React.JSX.Element {
  const concepts = initialConcepts.length > 0 ? initialConcepts : DEFAULT_CONCEPTS;

  const [selectedConceptId, setSelectedConceptId] = useState<UUID>(() => {
    if (initialConceptId && concepts.some((c) => c.id === initialConceptId)) {
      return initialConceptId;
    }
    return concepts[0]?.id ?? ("33333333-3333-4333-8333-333333333331" as UUID);
  });

  const activeConcept = concepts.find((c) => c.id === selectedConceptId) ?? concepts[0];

  const [confidence, setConfidence] = useState<number>(0.35);
  const currentBand = confidenceToBand(confidence);

  const [mascotMood, setMascotMood] = useState<SparkMood>("think");
  const [inputContent, setInputContent] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Initialize dialogue messages
  const [messages, setMessages] = useState<TutoringMessage[]>(() => {
    if (initialMessages && initialMessages.length > 0) {
      return initialMessages;
    }
    const initialText = activeConcept
      ? `Hello! I'm Spark, your Socratic tutor for **${activeConcept.label}**.\n\nLet's explore this together. In your own words, what role does the calculus chain rule play in calculating gradients for this concept, and why can't we simply update each parameter independently without propagating backward?`
      : "Welcome to Socratic Tutoring! Please select a concept to begin our guided exploration.";

    return [
      {
        id: "msg-welcome-001" as UUID,
        sessionId,
        role: "assistant",
        content: initialText,
        conceptId: selectedConceptId,
        understandingDetected: false,
        createdAt: new Date().toISOString(),
      },
    ];
  });

  // When selected concept changes, update welcome message if starting a new topic
  const handleConceptChange = useCallback(
    (newConceptId: UUID) => {
      setSelectedConceptId(newConceptId);
      const target = concepts.find((c) => c.id === newConceptId);
      if (!target) return;

      const welcome = `Great choice! Now we are focusing on **${target.label}**.\n\n${target.description}\n\nTo begin: How would you formulate the primary objective of $${target.label}$, and what is the key intuition behind its implementation?`;

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-switch-${Date.now()}` as UUID,
          sessionId,
          role: "assistant",
          content: welcome,
          conceptId: newConceptId,
          understandingDetected: false,
          createdAt: new Date().toISOString(),
        },
      ]);
      setMascotMood("think");
    },
    [concepts, sessionId]
  );

  const handleSendMessage = useCallback(
    async (e?: React.FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const trimmed = inputContent.trim();
      if (!trimmed || isSubmitting) {
        return;
      }

      setErrorNotice(null);
      setIsSubmitting(true);
      setMascotMood("think");

      const userMsgId = `msg-user-${Date.now()}` as UUID;
      const userMessage: TutoringMessage = {
        id: userMsgId,
        sessionId,
        role: "user",
        content: trimmed,
        conceptId: selectedConceptId,
        understandingDetected: false,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputContent("");

      try {
        // Attempt live API submission
        const token = await getRuntimeAccessToken();
        let apiHandled = false;

        if (token) {
          try {
            const apiResponse = await requestJson(
              `/api/tutoring/sessions/${sessionId}/messages`,
              z.object({
                assistantContent: z.string(),
                understandingDetected: z.boolean(),
                masteryUpdated: z
                  .object({
                    confidence: z.number(),
                    band: z.enum(["gray", "red", "yellow", "green"]),
                  })
                  .optional(),
              }),
              {
                method: "POST",
                body: { content: trimmed, conceptId: selectedConceptId },
                getAccessToken: async () => token,
              }
            );

            const asstMsgId = `msg-asst-${Date.now()}` as UUID;
            const assistantMessage: TutoringMessage = {
              id: asstMsgId,
              sessionId,
              role: "assistant",
              content: apiResponse.assistantContent,
              conceptId: selectedConceptId,
              understandingDetected: apiResponse.understandingDetected,
              createdAt: new Date().toISOString(),
            };

            setMessages((prev) => [...prev, assistantMessage]);

            if (apiResponse.understandingDetected) {
              setMascotMood("cheer");
              if (apiResponse.masteryUpdated) {
                setConfidence(apiResponse.masteryUpdated.confidence);
              } else {
                setConfidence((c) => Math.min(1.0, Number((c + 0.2).toFixed(2))));
              }
            } else {
              setMascotMood("calm");
            }

            apiHandled = true;
          } catch {
            apiHandled = false;
          }
        }

        // Resilient fallback Socratic dialogue engine for fixture/offline runs
        if (!apiHandled) {
          const lower = trimmed.toLowerCase();
          const target = activeConcept?.label ?? "this concept";

          // Heuristic understanding detection
          const demonstratesUnderstanding =
            lower.includes("chain rule") ||
            lower.includes("derivative") ||
            lower.includes("gradient") ||
            lower.includes("product") ||
            lower.includes("multiply") ||
            lower.includes("propagat") ||
            lower.includes("loss") ||
            lower.includes("step") ||
            lower.includes("minimize") ||
            lower.includes("attention") ||
            lower.includes("query");

          let replyText: string;
          let detected = false;

          if (demonstratesUnderstanding) {
            detected = true;
            replyText = `Spot on! You accurately identified the mathematical mechanics of **${target}**. By expressing the composite transformation through partial derivatives:

$$\\frac{\\partial \\mathcal{L}}{\\partial w_i} = \\frac{\\partial \\mathcal{L}}{\\partial y} \\cdot \\frac{\\partial y}{\\partial z} \\cdot \\frac{\\partial z}{\\partial w_i}$$

you allow the error signal to propagate efficiently in $O(V + E)$ time without redundant computations.

What would happen if the activation functions in deep intermediate layers had derivatives that were consistently less than $1$? How would that affect convergence?`;
          } else {
            replyText = `That's an interesting perspective! Let's probe deeper into **${target}**. 

Consider what happens when you alter a single weight parameter in layer $l$. How does that local perturbation impact the final scalar loss $\\mathcal{L}$? Think about how intermediate variables serve as bridges in composite functions.`;
          }

          const asstMsgId = `msg-asst-${Date.now()}` as UUID;
          const fallbackAssistantMessage: TutoringMessage = {
            id: asstMsgId,
            sessionId,
            role: "assistant",
            content: replyText,
            conceptId: selectedConceptId,
            understandingDetected: detected,
            createdAt: new Date().toISOString(),
          };

          setMessages((prev) => [...prev, fallbackAssistantMessage]);

          if (detected) {
            setMascotMood("cheer");
            setConfidence((c) => Math.min(1.0, Number((c + 0.2).toFixed(2))));
          } else {
            setMascotMood("calm");
          }
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
    [inputContent, isSubmitting, sessionId, selectedConceptId, activeConcept]
  );

  const inputId = useId();

  return (
    <div
      className={`space-y-6 ${className}`}
      data-testid="tutor-feature"
      aria-label="Socratic Tutoring Interface"
    >
      {/* Concept Selector Header Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle as="h2">Socratic Tutoring Workspace</CardTitle>
              <CardDescription>
                Engage in interactive mathematical dialogue with Spark to build deep mastery of key concepts.
              </CardDescription>
            </div>

            {/* Spark Mascot Companion */}
            <div className="flex items-center gap-3 bg-[#f4e9d7]/50 border border-[#e6d8bd] px-4 py-2 rounded-xl">
              <SparkMascot
                skyBrightness={0.65}
                mood={mascotMood}
                size={84}
                className="shrink-0"
              />
              <div className="text-xs space-y-0.5">
                <p className="font-semibold text-[#2b2a2e]">Spark Companion</p>
                <p className="text-[#5f5b54] capitalize">Mood: {mascotMood}</p>
                <Badge mastery={currentBand} confidence={confidence}>
                  {getMasteryLabel(currentBand, confidence)}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-4">
            {/* Concept Selector */}
            <div>
              <label
                htmlFor="concept-selector-select"
                className="block text-sm font-semibold text-[#2b2a2e] mb-2"
              >
                Select Concept for Tutoring:
              </label>
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
                      onClick={() => handleConceptChange(concept.id)}
                      className={`p-3 text-left rounded-lg border transition-all text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] ${
                        isSelected
                          ? "border-[#ed793c] bg-[#fbeac2] text-[#2b2a2e] font-semibold shadow-sm"
                          : "border-[#e6d8bd] bg-[#fffdf8] text-[#5f5b54] hover:border-[#ecdcc0] hover:text-[#2b2a2e]"
                      }`}
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
            </div>

            {/* Mastery Progress Bar */}
            <div className="space-y-1.5 pt-2 border-t border-[#e6d8bd]">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-[#2b2a2e]">
                  Concept Confidence: {Math.round(confidence * 100)}%
                </span>
                <span className="text-[#5f5b54] uppercase tracking-wider font-semibold">
                  Band: {currentBand}
                </span>
              </div>
              <div
                className="w-full h-2.5 rounded-full bg-[#f4e9d7] overflow-hidden border border-[#e6d8bd]"
                role="progressbar"
                aria-valuenow={Math.round(confidence * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Mastery Confidence Progress"
              >
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.round(confidence * 100)}%`,
                    backgroundColor:
                      currentBand === "green"
                        ? "#2b7f55"
                        : currentBand === "yellow"
                        ? "#f4bc55"
                        : currentBand === "red"
                        ? "#b0384a"
                        : "#ecdcc0",
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
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </span>
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-4 md:p-6 space-y-4 overflow-y-auto max-h-[500px]">
          {messages.map((msg) => {
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
                  className={`max-w-[85%] rounded-xl p-4 shadow-sm border text-sm leading-relaxed ${
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

                  <FormattedMathContent text={msg.content} />

                  {/* Understanding Detected Celebration Badge */}
                  {msg.understandingDetected && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2b7f55] bg-[#dff1e5] text-[#2b7f55] text-xs font-semibold"
                    >
                      <span>✨</span>
                      <span>Understanding Detected! +20% Mastery Confidence</span>
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
            <div
              role="alert"
              className="mb-3 p-2.5 rounded-lg border border-[#b0384a] bg-[#f8e0e3] text-[#2b2a2e] text-xs"
            >
              <p className="font-medium text-[#b0384a]">Error submitting message:</p>
              <p>{errorNotice}</p>
            </div>
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
                disabled={isSubmitting}
                maxLength={2000}
                placeholder="Type your explanation or question here (Press Enter to send, Shift+Enter for new line)…"
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
                  disabled={!inputContent.trim() || isSubmitting}
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
