"use client";

import type { CourseHeatmapSnapshot } from "@/contracts/mastery";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export interface ClassHeatmapProps {
  heatmap: CourseHeatmapSnapshot | null;
  loading?: boolean;
  error?: string | null;
}

const BAND_COLORS = {
  gray: "#dcd3c4",
  red: "#b0384a",
  yellow: "#f4bc55",
  green: "#2b7f55",
} as const;

export function ClassHeatmap({ heatmap, loading = false, error = null }: ClassHeatmapProps) {
  const totalStudents = heatmap?.totalStudents ?? 0;
  const concepts = heatmap?.concepts ?? [];

  return (
    <Card className="flex flex-col space-y-4 p-4 border border-[#e6d8bd] bg-[#fffdf8]">
      <CardHeader className="p-0 pb-2 border-b border-[#e6d8bd] space-y-1">
        <CardTitle as="h2" className="text-lg font-semibold text-[#2b2a2e]">
          Course mastery
        </CardTitle>
        <p className="text-xs text-[#5f5b54] leading-relaxed">
          Displays aggregate course mastery across enrolled students. Course confidence reflects cumulative practice and poll evaluations, distinct from live poll response counters.
        </p>
      </CardHeader>

      <CardContent className="p-0 space-y-4">
        {loading && !heatmap && (
          <div role="status" className="p-4 text-center text-sm text-[#5f5b54]">
            Loading course mastery heatmap...
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-3 bg-[#f8e0e3] border border-[#b0384a]/30 text-[#b0384a] rounded-md text-sm"
          >
            Failed to load course mastery: {error}
          </div>
        )}

        {heatmap && concepts.length === 0 && (
          <p className="text-sm text-[#5f5b54] py-2">
            No course concepts found. Add concepts through syllabus setup.
          </p>
        )}

        {heatmap && totalStudents === 0 && (
          <p className="text-sm text-[#5f5b54] py-2">
            No enrolled students yet.
          </p>
        )}

        {heatmap && concepts.length > 0 && (
          <ol className="divide-y divide-[#e6d8bd]/60 space-y-4 pt-1" aria-label="Course mastery by concept">
            {concepts.map((concept, index) => {
              const grayCount = concept.distribution.gray;
              const redCount = concept.distribution.red;
              const yellowCount = concept.distribution.yellow;
              const greenCount = concept.distribution.green;

              const grayPct = totalStudents > 0 ? (grayCount / totalStudents) * 100 : 0;
              const redPct = totalStudents > 0 ? (redCount / totalStudents) * 100 : 0;
              const yellowPct = totalStudents > 0 ? (yellowCount / totalStudents) * 100 : 0;
              const greenPct = totalStudents > 0 ? (greenCount / totalStudents) * 100 : 0;

              const grayDisplay = totalStudents > 0 ? `${grayPct.toFixed(1)}%` : "0%";
              const redDisplay = totalStudents > 0 ? `${redPct.toFixed(1)}%` : "0%";
              const yellowDisplay = totalStudents > 0 ? `${yellowPct.toFixed(1)}%` : "0%";
              const greenDisplay = totalStudents > 0 ? `${greenPct.toFixed(1)}%` : "0%";

              return (
                <li
                  key={concept.conceptId}
                  className={index === 0 ? "space-y-2" : "pt-4 space-y-2"}
                >
                  <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                    <span className="font-semibold text-sm text-[#2b2a2e]">
                      {concept.label}
                    </span>
                    {concept.category && (
                      <span className="text-xs text-[#5f5b54]">
                        {concept.category}
                      </span>
                    )}
                  </div>

                  {/* 4-Segment Progress Bar */}
                  <div
                    className="h-3 w-full flex rounded overflow-hidden bg-[#e6d8bd]/30 border border-[#e6d8bd]"
                    role="progressbar"
                    aria-label={`Mastery distribution for ${concept.label}`}
                    aria-valuenow={Math.round(greenPct + yellowPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    {grayPct > 0 && (
                      <div
                        style={{
                          width: `${grayPct}%`,
                          backgroundColor: BAND_COLORS.gray,
                        }}
                        title={`Unassessed: ${grayCount} (${grayDisplay})`}
                      />
                    )}
                    {redPct > 0 && (
                      <div
                        style={{
                          width: `${redPct}%`,
                          backgroundColor: BAND_COLORS.red,
                        }}
                        title={`Needs practice: ${redCount} (${redDisplay})`}
                      />
                    )}
                    {yellowPct > 0 && (
                      <div
                        style={{
                          width: `${yellowPct}%`,
                          backgroundColor: BAND_COLORS.yellow,
                        }}
                        title={`Developing: ${yellowCount} (${yellowDisplay})`}
                      />
                    )}
                    {greenPct > 0 && (
                      <div
                        style={{
                          width: `${greenPct}%`,
                          backgroundColor: BAND_COLORS.green,
                        }}
                        title={`Mastered: ${greenCount} (${greenDisplay})`}
                      />
                    )}
                  </div>

                  {/* Text for every band outside colored segments */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-[#2b2a2e] pt-1 tabular-nums">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-[#2b2a2e]/20"
                        style={{ backgroundColor: BAND_COLORS.gray }}
                        aria-hidden="true"
                      />
                      <span>{`Unassessed: ${grayCount} (${grayDisplay})`}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: BAND_COLORS.red }}
                        aria-hidden="true"
                      />
                      <span>{`Needs practice: ${redCount} (${redDisplay})`}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: BAND_COLORS.yellow }}
                        aria-hidden="true"
                      />
                      <span>{`Developing: ${yellowCount} (${yellowDisplay})`}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: BAND_COLORS.green }}
                        aria-hidden="true"
                      />
                      <span>{`Mastered: ${greenCount} (${greenDisplay})`}</span>
                    </div>
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
