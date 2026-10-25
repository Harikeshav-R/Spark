"use client";

import type { MasteryBand } from "@/contracts/common";
import type { CourseHeatmapSnapshot } from "@/contracts/mastery";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface ClassHeatmapProps {
  heatmap: CourseHeatmapSnapshot | null;
  loading?: boolean;
  error?: string | null;
}

interface BandDefinition {
  readonly key: MasteryBand;
  readonly label: string;
  readonly barClass: string;
  readonly dotClass: string;
}

const MASTERY_BANDS: readonly BandDefinition[] = [
  {
    key: "gray",
    label: "Unassessed",
    barClass: "bg-[#dcd3c4]",
    dotClass: "bg-[#dcd3c4] border border-ink/20",
  },
  {
    key: "red",
    label: "Needs practice",
    barClass: "bg-mastery-red",
    dotClass: "bg-mastery-red",
  },
  {
    key: "yellow",
    label: "Developing",
    barClass: "bg-mastery-yellow",
    dotClass: "bg-mastery-yellow",
  },
  {
    key: "green",
    label: "Mastered",
    barClass: "bg-mastery-green",
    dotClass: "bg-mastery-green",
  },
] as const;
export function ClassHeatmap({ heatmap, loading = false, error = null }: ClassHeatmapProps) {
  const totalStudents = heatmap?.totalStudents ?? 0;
  const concepts = heatmap?.concepts ?? [];

  return (
    <Card className="flex flex-col space-y-4 p-4 border border-line bg-panel">
      <CardHeader className="p-0 pb-2 border-b border-line space-y-1">
        <CardTitle as="h2" className="text-lg font-semibold text-ink">
          Course mastery
        </CardTitle>
        <p className="text-xs text-muted leading-relaxed">
          Displays aggregate course mastery across enrolled students. Course confidence reflects cumulative practice and poll evaluations, distinct from live poll response counters.
        </p>
      </CardHeader>

      <CardContent className="p-0 space-y-4">
        {loading && !heatmap && (
          <div role="status" className="p-4 text-center text-sm text-muted">
            Loading course mastery heatmap...
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-3 bg-bad-tint border border-bad/30 text-bad rounded-md text-sm"
          >
            Failed to load course mastery: {error}
          </div>
        )}

        {heatmap && concepts.length === 0 && (
          <p className="text-sm text-muted py-2">
            No course concepts found. Add concepts through syllabus setup.
          </p>
        )}

        {heatmap && totalStudents === 0 && (
          <p className="text-sm text-muted py-2">
            No enrolled students yet.
          </p>
        )}

        {heatmap && concepts.length > 0 && (
          <ol className="divide-y divide-line/60 space-y-4 pt-1" aria-label="Course mastery by concept">
            {concepts.map((concept, index) => {
              const bandData = MASTERY_BANDS.map((band) => {
                const count = concept.distribution[band.key];
                const pct = totalStudents > 0 ? (count / totalStudents) * 100 : 0;
                const displayPct = totalStudents > 0 ? `${pct.toFixed(1)}%` : "0%";
                const text = `${band.label}: ${count} (${displayPct})`;
                return {
                  ...band,
                  count,
                  pct,
                  displayPct,
                  text,
                };
              });

              return (
                <li
                  key={concept.conceptId}
                  className={index === 0 ? "space-y-2" : "pt-4 space-y-2"}
                >
                  <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                    <span className="font-semibold text-sm text-ink">
                      {concept.label}
                    </span>
                    {concept.category && (
                      <span className="text-xs text-muted">
                        {concept.category}
                      </span>
                    )}
                  </div>

                  {/* 4-Segment Progress Bar */}
                  <div
                    className="h-3 w-full flex rounded overflow-hidden bg-line/30 border border-line"
                    role="progressbar"
                    aria-label={`Mastery distribution for ${concept.label}`}
                    aria-valuenow={
                      totalStudents > 0
                        ? Math.round(
                            ((concept.distribution.yellow + concept.distribution.green) / totalStudents) * 100
                          )
                        : 0
                    }
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    {bandData.map((band) =>
                      band.pct > 0 ? (
                        <div
                          key={band.key}
                          className={band.barClass}
                          style={{ width: `${band.pct}%` }}
                          title={band.text}
                        />
                      ) : null
                    )}
                  </div>

                  {/* Text for every band outside colored segments */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-ink pt-1 tabular-nums">
                    {bandData.map((band) => (
                      <div key={band.key} className="flex items-center gap-1.5">
                        <span
                          className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${band.dotClass}`}
                          aria-hidden="true"
                        />
                        <span>{band.text}</span>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
