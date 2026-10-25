"use client";

import React, { useState, useEffect, useCallback, useId } from "react";
import Link from "next/link";
import { z } from "zod";
import type { UUID } from "@/contracts/common";
import { uuidSchema, isoTimestampSchema } from "@/contracts/common";
import { lectureSessionSchema } from "@/contracts/classroom";
import { courseGraphResponseSchema } from "@/contracts/course";
import { summarizedLectureSchema } from "@/contracts/ai";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requestJson, ClientApiError, getRuntimeAccessToken } from "@/lib/client/http";
import { FeatureErrorNotice } from "@/features/learning/feature-error-boundary";

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
  initialToken?: string;
  getAccessToken?: () => Promise<string | null>;
  className?: string;
}

const fetchedSummarySchema = summarizedLectureSchema.extend({
  lectureId: uuidSchema,
  generatedAt: isoTimestampSchema,
});

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
  initialToken,
  getAccessToken,
  className = "",
}: LectureSummariesViewProps): React.JSX.Element {
  const [summaries, setSummaries] = useState<LectureSummaryItem[]>(
    initialSummaries !== undefined && initialSummaries !== null ? initialSummaries : []
  );
  const [loading, setLoading] = useState<boolean>(
    (initialSummaries === undefined || initialSummaries === null) && Boolean(courseId)
  );
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>("");
  const searchInputId = useId();

  const resolveToken = useCallback(async (): Promise<string | null> => {
    if (getAccessToken) {
      const t = await getAccessToken();
      if (t) return t;
    }
    if (initialToken) return initialToken;
    return getRuntimeAccessToken();
  }, [getAccessToken, initialToken]);

  const loadSummaries = useCallback(
    async (signal?: AbortSignal) => {
      if (!courseId) return;
      setLoading(true);
      setError(null);

      try {
        const token = await resolveToken();
        if (!token) {
          setError("Authentication required to view lecture summaries.");
          setLoading(false);
          return;
        }

        const tokenGetter = async () => token;

        // Fetch lectures and graph in parallel
        const [lectures, graph] = await Promise.all([
          requestJson(`/api/courses/${encodeURIComponent(courseId)}/lectures`, z.array(lectureSessionSchema), {
            getAccessToken: tokenGetter,
            signal,
          }),
          requestJson(`/api/courses/${encodeURIComponent(courseId)}/graph`, courseGraphResponseSchema, {
            getAccessToken: tokenGetter,
            signal,
          }).catch(() => null),
        ]);

        if (signal?.aborted) return;

        const conceptLabelMap = new Map<UUID, string>();
        if (graph) {
          for (const node of graph.nodes) {
            conceptLabelMap.set(node.id, node.label);
          }
        }

        const completedLectures = lectures.filter((l) => l.status === "completed");
        if (completedLectures.length === 0) {
          setSummaries([]);
          setLoading(false);
          return;
        }

        // Fetch summaries for completed lectures
        const summaryResults = await Promise.allSettled(
          completedLectures.map((lecture) =>
            requestJson(
              `/api/lectures/${encodeURIComponent(lecture.id)}/summary`,
              fetchedSummarySchema,
              {
                getAccessToken: tokenGetter,
                signal,
              }
            ).then((res) => ({ lecture, res }))
          )
        );

        if (signal?.aborted) return;

        const loadedItems: LectureSummaryItem[] = [];
        for (const item of summaryResults) {
          if (item.status === "fulfilled") {
            const { lecture, res } = item.value;
            const keyConceptsCovered = res.keyConceptsCovered.map(
              (cId) => conceptLabelMap.get(cId) ?? cId
            );
            loadedItems.push({
              lectureId: res.lectureId,
              title: lecture.title,
              summary: res.summary,
              keyConceptsCovered,
              timelineHighlights: res.timelineHighlights,
              generatedAt: res.generatedAt,
            });
          }
          // 404s for individual summaries indicate a lecture without a summary yet, which is safely omitted
        }

        setSummaries(loadedItems);
      } catch (err: unknown) {
        if (signal?.aborted) return;
        setError(
          err instanceof ClientApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load past lecture summaries."
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [courseId, resolveToken]
  );

  useEffect(() => {
    if (initialSummaries !== undefined && initialSummaries !== null) {
      setSummaries(initialSummaries);
      setLoading(false);
      setError(null);
      return;
    }

    if (!courseId) {
      setSummaries([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadSummaries(controller.signal);

    return () => {
      controller.abort();
    };
  }, [courseId, initialSummaries, loadSummaries, studentId]);

  // Sort summaries chronologically (newest first for student study priority)
  const sortedSummaries = [...summaries].sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );

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

      {/* Missing Course Selection Invariant */}
      {!courseId && initialSummaries === undefined && (
        <Card
          data-testid="missing-course-guidance"
          className="p-8 text-center border-dashed border-2 border-[#e6d8bd] bg-[#fffdf8]"
        >
          <div className="max-w-md mx-auto space-y-3">
            <h3 className="text-lg font-semibold text-[#2b2a2e]">
              Course Not Selected
            </h3>
            <p className="text-sm text-[#5f5b54] leading-relaxed">
              Please select a course to review lecture summaries and study notes.
            </p>
            <div className="pt-2">
              <Link
                href={`/student/${studentId}`}
                className="inline-flex items-center min-h-[44px] px-4 py-2 text-sm font-semibold rounded-md bg-[#f4e9d7] text-[#2b2a2e] border border-[#3a3a3d] hover:bg-[#ecdcc0] transition-colors"
              >
                Return to Course Selection
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <Card className="p-8 text-center bg-[#fffdf8]">
          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-2 border-[#ed793c] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#5f5b54]">Loading past lecture summaries…</p>
          </div>
        </Card>
      )}

      {/* Error / Retry State */}
      {!loading && error && (
        <FeatureErrorNotice
          message={error}
          onRetry={() => void loadSummaries()}
          className="my-4"
        />
      )}

      {/* Empty State Invariant Case (Only when successfully loaded and really empty) */}
      {!loading && !error && courseId && summaries.length === 0 && (
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
      {!loading && !error && summaries.length > 0 && filteredSummaries.length === 0 && (
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
      {!loading && !error && (
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
      )}
    </div>
  );
}
