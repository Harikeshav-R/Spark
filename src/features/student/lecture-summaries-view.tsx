"use client";

import React, { useState, useId } from "react";
import Link from "next/link";
import type { UUID } from "@/contracts/common";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface LectureTimelineHighlight {
  timestampSec: number;
  conceptLabel: string;
  description: string;
}

export interface LectureSummaryItem {
  lectureId: UUID;
  title: string;
  summary: string;
  keyConceptsCovered: string[];
  timelineHighlights?: LectureTimelineHighlight[];
  generatedAt: string;
}

export interface LectureSummariesViewProps {
  studentId: UUID;
  courseId?: UUID;
  initialSummaries?: LectureSummaryItem[] | null;
  className?: string;
}

// Fallback completed lecture summaries adhering to course domain fixtures
export const DEFAULT_LECTURE_SUMMARIES: LectureSummaryItem[] = [
  {
    lectureId: "44444444-4444-4444-8444-444444444441",
    title: "Lecture 1: Introduction to Deep Learning, Perceptrons & Loss Surfaces",
    summary:
      "This opening lecture established the foundational principles of artificial neural networks. We traced the mathematical progression from the Rosenblatt perceptron to multi-layer feed-forward networks, analyzing the representational capacity of linear layers and proving why non-linear activation functions are mathematically indispensable. We concluded with loss surface formulations and convexity characteristics.",
    keyConceptsCovered: [
      "Perceptrons",
      "Activation Functions",
      "Loss Surfaces",
      "Convexity",
    ],
    timelineHighlights: [
      {
        timestampSec: 495,
        conceptLabel: "Biological vs Artificial Neurons",
        description: "Comparison of biological dendrite summation to mathematical dot-product weights.",
      },
      {
        timestampSec: 1470,
        conceptLabel: "Sigmoid and ReLU Nonlinearities",
        description: "Why non-linear activations prevent collapsing deep architectures into a single linear matrix.",
      },
      {
        timestampSec: 2700,
        conceptLabel: "Mean Squared Error Formulation",
        description: "Deriving loss gradients with respect to output predictions and analyzing convexity.",
      },
    ],
    generatedAt: "2026-10-18T11:30:00.000Z",
  },
  {
    lectureId: "44444444-4444-4444-8444-444444444442",
    title: "Lecture 2: Computational Graphs, Forward Propagation & Vectorization",
    summary:
      "An in-depth mathematical exploration of computational graph architecture. The class covered the formalization of forward propagation as a topological sort through DAG operators. We explored matrix calculus and vectorized tensor operations, highlighting performance advantages of mini-batch computations over scalar loops.",
    keyConceptsCovered: [
      "Computational Graphs",
      "Vectorization",
      "Broadcasting",
      "Matrix Calculus",
    ],
    timelineHighlights: [
      {
        timestampSec: 720,
        conceptLabel: "Directed Acyclic Graphs for Math",
        description: "Visualizing scalar and tensor operations as topological graph nodes.",
      },
      {
        timestampSec: 1845,
        conceptLabel: "Vectorized Mini-Batch Processing",
        description: "How GPU tensor cores leverage SIMD primitives for batch matrix products.",
      },
      {
        timestampSec: 3130,
        conceptLabel: "Chain Rule on Directed Paths",
        description: "Decomposing multivariate gradient accumulation along multiple graph branches.",
      },
    ],
    generatedAt: "2026-10-20T11:30:00.000Z",
  },
  {
    lectureId: "44444444-4444-4444-8444-444444444443",
    title: "Lecture 3: Reverse-Mode Automatic Differentiation & Backpropagation",
    summary:
      "This lecture presented the complete mathematical derivation of the backpropagation algorithm. We demonstrated that reverse-mode automatic differentiation computes the gradient of a scalar output with respect to all parameters in computational complexity proportional to the forward pass. We examined Jacobian-vector products and diagnosed vanishing and exploding gradient phenomena.",
    keyConceptsCovered: [
      "Backpropagation",
      "Chain Rule",
      "Jacobian Matrices",
      "Gradient Accumulation",
    ],
    timelineHighlights: [
      {
        timestampSec: 620,
        conceptLabel: "Forward vs Reverse Mode AD",
        description: "Why reverse mode scales as O(1) in the number of inputs for scalar loss functions.",
      },
      {
        timestampSec: 1780,
        conceptLabel: "Jacobian-Vector Products",
        description: "Efficient backward pass formulation avoiding explicit Jacobian matrix materialization.",
      },
      {
        timestampSec: 3315,
        conceptLabel: "Vanishing Gradient Breakdown",
        description: "How repeated sigmoid squashing diminishes gradient norms exponentially in deep nets.",
      },
    ],
    generatedAt: "2026-10-22T11:30:00.000Z",
  },
];

function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function LectureSummariesView({
  studentId,
  courseId,
  initialSummaries,
  className = "",
}: LectureSummariesViewProps): React.JSX.Element {
  const summaries =
    initialSummaries !== undefined && initialSummaries !== null
      ? initialSummaries
      : DEFAULT_LECTURE_SUMMARIES;

  // Sort summaries chronologically (newest first for student study priority)
  const sortedSummaries = [...summaries].sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );

  const [searchFilter, setSearchFilter] = useState<string>("");
  const searchInputId = useId();

  const filteredSummaries = sortedSummaries.filter((item) => {
    if (!searchFilter.trim()) return true;
    const term = searchFilter.toLowerCase();
    const matchesTitle = item.title.toLowerCase().includes(term);
    const matchesSummary = item.summary.toLowerCase().includes(term);
    const matchesConcept = item.keyConceptsCovered.some((c) =>
      c.toLowerCase().includes(term)
    );
    return matchesTitle || matchesSummary || matchesConcept;
  });

  return (
    <div
      className={`space-y-6 ${className}`}
      data-testid="lecture-summaries-view"
      aria-label="Lecture Summaries Directory"
    >
      {/* Header and Filter Bar */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle as="h2">Past Lecture Summaries</CardTitle>
              <CardDescription>
                Review chronological highlights, key concepts, and timeline references from completed course lectures.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-center">
              <span className="text-xs px-2.5 py-1 rounded-full bg-[#f4e9d7] text-[#2b2a2e] font-semibold">
                {summaries.length} Completed Lecture{summaries.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </CardHeader>

        {summaries.length > 0 && (
          <CardContent>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <label htmlFor={searchInputId} className="sr-only">
                Filter summaries by concept or keyword
              </label>
              <input
                id={searchInputId}
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter summaries by concept or keyword…"
                className="w-full sm:max-w-md rounded-md border border-[#3a3a3d] bg-[#fffdf8] px-3 py-2 text-sm text-[#2b2a2e] placeholder:text-[#5f5b54] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] focus-visible:ring-offset-2"
              />
              {searchFilter && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchFilter("")}
                  className="shrink-0"
                >
                  Clear Filter
                </Button>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Empty State Invariant Case */}
      {summaries.length === 0 && (
        <Card
          data-testid="empty-summaries-guidance"
          className="p-8 text-center border-dashed border-2 border-[#e6d8bd] bg-[#fffdf8]"
        >
          <div className="max-w-md mx-auto space-y-3">
            <div
              aria-hidden="true"
              className="w-12 h-12 rounded-full bg-[#f4e9d7] text-[#ed793c] flex items-center justify-center mx-auto text-xl"
            >
              📖
            </div>
            <h3 className="text-lg font-semibold text-[#2b2a2e]">
              No Lecture Summaries Available Yet
            </h3>
            <p className="text-sm text-[#5f5b54] leading-relaxed">
              Lecture summaries are automatically generated by Spark when your instructor completes a live lecture.
              Once a class session wraps up, you will find key concepts, timeline highlights, and comprehensive study notes right here.
            </p>
            <div className="pt-2">
              <Link
                href={`/student/${studentId}${courseId ? `?courseId=${courseId}` : ""}`}
                className="inline-flex items-center min-h-[44px] px-4 py-2 text-sm font-semibold rounded-md bg-[#f4e9d7] text-[#2b2a2e] border border-[#3a3a3d] hover:bg-[#ecdcc0] transition-colors"
              >
                Return to Student Workspace
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* No Search Results */}
      {summaries.length > 0 && filteredSummaries.length === 0 && (
        <Card className="p-8 text-center bg-[#fffdf8]">
          <p className="text-sm text-[#5f5b54] mb-2">
            No lecture summaries match the filter &ldquo;{searchFilter}&rdquo;.
          </p>
          <Button variant="outline" size="sm" onClick={() => setSearchFilter("")}>
            Reset Filter
          </Button>
        </Card>
      )}

      {/* Chronological List of Summaries */}
      <div className="space-y-6" data-testid="summaries-list">
        {filteredSummaries.map((item, index) => (
          <Card
            key={item.lectureId}
            data-testid={`lecture-summary-card-${index}`}
            className="overflow-hidden border border-[#e6d8bd] hover:border-[#cf951f] transition-colors shadow-sm"
          >
            <CardHeader className="bg-[#faf6ee]/60 border-b border-[#e6d8bd] pb-4">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold bg-[#dff1e5] text-[#2b7f55] border border-[#2b7f55]">
                      COMPLETED
                    </span>
                    <span className="text-xs text-[#5f5b54]">
                      {formatDate(item.generatedAt)}
                    </span>
                  </div>
                  <CardTitle as="h3" className="text-lg font-bold text-[#2b2a2e]">
                    {item.title}
                  </CardTitle>
                </div>

                <Link
                  href={`/student/${studentId}/tutor?courseId=${courseId ?? ""}&lectureId=${item.lectureId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#fffdf8] text-[#2b2a2e] border border-[#3a3a3d] hover:bg-[#f4e9d7] transition-colors shrink-0 self-start min-h-[36px]"
                >
                  <span>✨ Tutor on this Lecture</span>
                </Link>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-6">
              {/* Executive Summary */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#5f5b54] mb-2">
                  Lecture Summary &amp; Key Takeaways
                </h4>
                <p className="text-sm text-[#2b2a2e] leading-relaxed whitespace-pre-line bg-[#fffdf8] p-4 rounded-lg border border-[#ecdcc0]">
                  {item.summary}
                </p>
              </div>

              {/* Key Concepts Covered */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#5f5b54] mb-2.5">
                  Core Concepts Covered ({item.keyConceptsCovered.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {item.keyConceptsCovered.map((concept, cIdx) => (
                    <span
                      key={cIdx}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-[#fbeac2] text-[#2b2a2e] border border-[#cf951f]"
                    >
                      {`#${concept}`}
                    </span>
                  ))}
                </div>
              </div>

              {/* Timeline Highlights */}
              {item.timelineHighlights && item.timelineHighlights.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#5f5b54] mb-3">
                    Lecture Timeline Highlights
                  </h4>
                  <div className="space-y-2.5 border-l-2 border-[#ed793c] pl-4 ml-1">
                    {item.timelineHighlights.map((hl, hlIdx) => (
                      <div key={hlIdx} className="space-y-0.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold px-1.5 py-0.5 rounded bg-[#f4e9d7] text-[#a9481a] border border-[#e6d8bd]">
                            {formatTimestamp(hl.timestampSec)}
                          </span>
                          <span className="font-semibold text-[#2b2a2e]">
                            {hl.conceptLabel}
                          </span>
                        </div>
                        <p className="text-[#5f5b54] pl-1">{hl.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
