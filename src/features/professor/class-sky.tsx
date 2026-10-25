"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import type { UUID } from "@/contracts/common";
import { courseGraphResponseSchema } from "@/contracts/course";
import {
  classSkySnapshotSchema,
  courseEffortSchema,
  type ClassSkySnapshot,
  type CourseEffortDTO,
} from "@/contracts/game";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KnowledgeGraph } from "@/features/graph/knowledge-graph";
import type { GraphData } from "@/features/graph/d3-force-layout";
import { requestJson, ClientApiError } from "@/lib/client/http";
import { buildClassSkyGraph } from "./class-sky-state";
import { EffortRoster } from "./effort-roster";
import { cn } from "@/lib/client/utils";

export interface ClassSkyProps {
  courseId: UUID;
  getAccessToken: () => Promise<string | null>;
  onAuthError: (status: 401 | 403) => void;
  className?: string;
}

interface LoadedData {
  graph: GraphData;
  snapshot: ClassSkySnapshot;
  effort: CourseEffortDTO[];
  classSkyGraph: GraphData;
}

export function ClassSky({
  courseId,
  getAccessToken,
  onAuthError,
  className,
}: ClassSkyProps): React.JSX.Element {
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);

  const activeAbortRef = useRef<AbortController | null>(null);
  const generationRef = useRef<number>(0);

  const fetchData = useCallback(
    async (isManualRefresh: boolean = false) => {
      // Abort any pending requests
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
      const abortController = new AbortController();
      activeAbortRef.current = abortController;

      const currentGen = ++generationRef.current;

      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorMessage(null);

      try {
        const [graphRes, skyRes, effortRes] = await Promise.all([
          requestJson(
            `/api/courses/${encodeURIComponent(courseId)}/graph`,
            courseGraphResponseSchema,
            {
              getAccessToken,
              signal: abortController.signal,
            },
          ),
          requestJson(
            `/api/courses/${encodeURIComponent(courseId)}/class-sky`,
            classSkySnapshotSchema,
            {
              getAccessToken,
              signal: abortController.signal,
            },
          ),
          requestJson(
            `/api/courses/${encodeURIComponent(courseId)}/students/effort`,
            z.array(courseEffortSchema),
            {
              getAccessToken,
              signal: abortController.signal,
            },
          ),
        ]);

        if (currentGen !== generationRef.current) {
          return;
        }

        if (skyRes.courseId !== courseId) {
          throw new Error("Class Sky snapshot course ID does not match current course");
        }

        const classSkyGraph = buildClassSkyGraph(graphRes, skyRes);

        setData({
          graph: graphRes,
          snapshot: skyRes,
          effort: effortRes,
          classSkyGraph,
        });
        setIsStale(false);
      } catch (err: unknown) {
        if (currentGen !== generationRef.current) {
          return;
        }

        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        if (err instanceof ClientApiError) {
          if (err.status === 401 || err.status === 403) {
            setData(null);
            onAuthError(err.status as 401 | 403);
            return;
          }
          setErrorMessage(err.message);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage("Failed to load Class Sky analytics. Please try again.");
        }

        // If prior data existed, mark it as stale
        setData((prev) => {
          if (prev) {
            setIsStale(true);
          }
          return prev;
        });
      } finally {
        if (currentGen === generationRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [courseId, getAccessToken, onAuthError],
  );

  useEffect(() => {
    void fetchData(false);
    return () => {
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
    };
  }, [fetchData]);

  const handleRefresh = () => {
    void fetchData(true);
  };

  // 1. Initial full-page loading state (no prior data)
  if (loading && !data) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn(
          "p-12 text-center text-muted bg-paper-panel rounded-lg border border-paper-line space-y-3",
          className,
        )}
      >
        <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium text-ink">Loading Class Sky analytics &amp; student effort…</p>
        <p className="text-xs text-muted">Aggregating cohort concept mastery and lecture evidence.</p>
      </div>
    );
  }

  // 2. Fatal error state with no prior data
  if (errorMessage && !data) {
    return (
      <div
        role="alert"
        className={cn(
          "p-6 rounded-lg border border-bad bg-bad-tint/20 text-ink space-y-4",
          className,
        )}
      >
        <div>
          <h3 className="font-semibold text-bad text-base">Failed to load Class Sky</h3>
          <p className="text-sm text-charcoal mt-1">{errorMessage}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchData(false)}>
          Retry
        </Button>
      </div>
    );
  }

  // 3. Empty course concepts state
  if (data && data.graph.nodes.length === 0) {
    return (
      <div
        className={cn(
          "p-8 text-center bg-paper-panel rounded-lg border border-paper-line space-y-4",
          className,
        )}
      >
        <div>
          <h3 className="font-semibold text-ink text-base">No concepts uploaded yet</h3>
          <p className="text-sm text-muted mt-1 max-w-md mx-auto">
            This course does not have a knowledge graph. Upload a syllabus or curriculum to generate
            concept stars and enable Class Sky analytics.
          </p>
        </div>
        <Link
          href={`/professor/upload?courseId=${encodeURIComponent(courseId)}`}
          className="inline-flex items-center justify-center h-8 px-3 text-xs rounded bg-[#ed793c] text-[#2b2a2e] border border-[#3a3a3d] hover:bg-[#ecdcc0] font-medium transition-colors"
        >
          Upload course syllabus
        </Link>
      </div>
    );
  }

  const taughtConceptIds = data
    ? data.snapshot.concepts.filter((c) => c.taught).map((c) => c.conceptId)
    : [];

  return (
    <div className={cn("space-y-6", className)} aria-busy={refreshing}>
      {/* Header bar with refresh control and status */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-paper-panel border border-paper-line rounded-lg">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Class Sky Analytics</h2>
            {isStale && (
              <Badge variant="outline" className="border-bad text-bad bg-bad-tint/20 text-[11px]">
                Showing stale data
              </Badge>
            )}
            {refreshing && (
              <Badge variant="secondary" className="text-[11px] animate-pulse">
                Refreshing…
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5">
            Cohort concept mastery, lecture evidence tracking, and effort/mastery quadrant diagnostics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            aria-label="Refresh Class Sky data"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Non-fatal error banner with retry option */}
      {errorMessage && data && (
        <div
          role="alert"
          className="flex items-center justify-between p-3 rounded-lg border border-bad bg-bad-tint/20 text-xs text-bad"
        >
          <span>Refresh failed: {errorMessage} (showing previously loaded data)</span>
          <Button variant="ghost" size="sm" onClick={() => void fetchData(true)}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty cohort banner if totalStudents === 0 */}
      {data && data.snapshot.totalStudents === 0 && (
        <div className="p-4 rounded-lg bg-paper-muted/50 border border-paper-line text-xs text-muted flex items-center justify-between gap-2">
          <span>
            No students are currently enrolled in this course. Stars show unavailable cohort mastery until students enroll and interact.
          </span>
        </div>
      )}

      {/* 1. Class Sky Concept Stars Knowledge Graph */}
      {data && (
        <Card className="w-full">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle as="h2">Cohort Concept Stars (Class Sky)</CardTitle>
                <p className="text-xs text-muted mt-1 max-w-2xl">
                  Star vessel brightness reflects cohort mean confidence. Stars adorned with an
                  open-book icon have been evidenced in lecture transcripts. A crimson ring flags
                  taught concepts with cohort mastery below 40% needing review.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full border border-ink/40 bg-[#fdfbf7]" />
                  Taught icon: Covered in lecture
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-bad bg-bad-tint/30" />
                  Crimson ring: Attention (&lt; 40%)
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <KnowledgeGraph
              graph={data.classSkyGraph}
              taughtConceptIds={taughtConceptIds}
            />
          </CardContent>
        </Card>
      )}

      {/* 2. Effort vs Mastery Diagnostic Scatter Matrix and Roster Table */}
      {data && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h2">Cohort Effort &amp; Mastery Roster</CardTitle>
            <p className="text-xs text-muted mt-1">
              Quadrant scatter matrix and sortable roster identifying students who may need proactive
              support (high effort with lagging concept mastery).
            </p>
          </CardHeader>
          <CardContent>
            <EffortRoster effort={data.effort} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
