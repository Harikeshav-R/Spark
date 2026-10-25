"use client";

import React, { useMemo, useState } from "react";
import type { CourseEffortDTO } from "../../contracts/game";
import { Badge } from "../../components/ui/badge";
import {
  buildEffortRows,
  sortEffortRows,
  type EffortSortKey,
} from "./class-sky-state";
import { cn } from "../../lib/client/utils";

export interface EffortRosterProps {
  effort: readonly CourseEffortDTO[];
  className?: string;
}

function formatUtcDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function EffortRoster({ effort, className }: EffortRosterProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<EffortSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const baseRows = useMemo(() => buildEffortRows(effort), [effort]);
  const sortedRows = useMemo(
    () => sortEffortRows(baseRows, sortKey, sortDirection),
    [baseRows, sortKey, sortDirection],
  );

  const handleSort = (key: EffortSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "name" ? "asc" : "desc");
    }
  };

  if (effort.length === 0) {
    return (
      <div
        className={cn(
          "p-8 text-center text-muted bg-paper-panel rounded-lg border border-paper-line",
          className,
        )}
      >
        <p className="text-base font-semibold text-ink">No enrolled students yet</p>
        <p className="text-sm mt-1 text-muted">
          Student effort and mastery analytics will appear here once students enroll in this course.
        </p>
      </div>
    );
  }

  // Scatter plot layout constants
  const svgWidth = 560;
  const svgHeight = 320;
  const padLeft = 60;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 45;
  const plotWidth = svgWidth - padLeft - padRight; // 470
  const plotHeight = svgHeight - padTop - padBottom; // 250

  const getCx = (effortPct: number) => padLeft + (Math.max(0, Math.min(100, effortPct)) / 100) * plotWidth;
  const getCy = (masteryPct: number) =>
    padTop + ((100 - Math.max(0, Math.min(100, masteryPct))) / 100) * plotHeight;

  // Threshold guides: x=75, y=40
  const x75 = getCx(75);
  const y40 = getCy(40);

  return (
    <div className={cn("space-y-6", className)}>
      {/* 1. Responsive Effort vs Mastery Scatter Matrix */}
      <div className="bg-paper-panel border border-paper-line rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Effort &amp; Mastery Diagnostic Matrix</h3>
            <p className="text-xs text-muted mt-0.5">
              Scatter plot comparing relative student XP effort percentile (x) against concept mastery percentile (y).
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" className="inline-block">
                <circle cx="6" cy="6" r="4.5" fill="#2b2a2e" stroke="#fdfbf7" strokeWidth="1" />
              </svg>
              Standard
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" className="inline-block">
                <polygon
                  points="6,1 11,6 6,11 1,6"
                  fill="var(--color-bad, #b0384a)"
                  stroke="#2b2a2e"
                  strokeWidth="1"
                />
              </svg>
              Needs support (Flagged)
            </span>
          </div>
        </div>

        <div className="relative w-full overflow-hidden select-none">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto max-h-[320px] font-sans"
            role="img"
            aria-label="Effort versus Mastery scatter plot matrix"
          >
            <title>Effort versus Mastery scatter matrix</title>
            <desc>
              Diagnostic scatter matrix of student cohort. The shaded red quadrant in the lower right indicates
              students with high effort (at or above 75th percentile) and low mastery (at or below 40th percentile) who
              need intervention.
            </desc>

            {/* Background gridlines */}
            {[0, 25, 50, 75, 100].map((tick) => {
              const xPos = getCx(tick);
              const yPos = getCy(tick);
              return (
                <g key={`grid-${tick}`} className="text-[#e2dacb] dark:text-[#3e3933]">
                  {/* Vertical gridline */}
                  <line
                    x1={xPos}
                    y1={padTop}
                    x2={xPos}
                    y2={padTop + plotHeight}
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray={tick === 0 || tick === 100 ? undefined : "3 3"}
                  />
                  {/* Horizontal gridline */}
                  <line
                    x1={padLeft}
                    y1={yPos}
                    x2={padLeft + plotWidth}
                    y2={yPos}
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray={tick === 0 || tick === 100 ? undefined : "3 3"}
                  />
                  {/* X tick label */}
                  <text
                    x={xPos}
                    y={padTop + plotHeight + 16}
                    textAnchor="middle"
                    className="fill-[#66625d] text-[10px] select-none"
                  >
                    {tick}%
                  </text>
                  {/* Y tick label */}
                  <text
                    x={padLeft - 8}
                    y={yPos + 3}
                    textAnchor="end"
                    className="fill-[#66625d] text-[10px] select-none"
                  >
                    {tick}%
                  </text>
                </g>
              );
            })}

            {/* Support region: x in [75, 100], y in [0, 40] */}
            <rect
              x={x75}
              y={y40}
              width={padLeft + plotWidth - x75}
              height={padTop + plotHeight - y40}
              fill="var(--color-bad, #b0384a)"
              fillOpacity="0.10"
              stroke="var(--color-bad, #b0384a)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            <text
              x={x75 + (padLeft + plotWidth - x75) / 2}
              y={y40 + 16}
              textAnchor="middle"
              className="fill-[#b0384a] text-[10px] font-semibold tracking-wide"
            >
              Needs support region
            </text>

            {/* Axis titles */}
            <text
              x={padLeft + plotWidth / 2}
              y={svgHeight - 8}
              textAnchor="middle"
              className="fill-ink text-xs font-medium"
            >
              Effort Percentile (XP) →
            </text>
            <text
              x={14}
              y={padTop + plotHeight / 2}
              textAnchor="middle"
              transform={`rotate(-90, 14, ${padTop + plotHeight / 2})`}
              className="fill-ink text-xs font-medium"
            >
              Mastery Percentile (Mean Confidence) →
            </text>

            {/* Student data points */}
            {baseRows.map((student) => {
              const cx = getCx(student.effortPercentile);
              const cy = getCy(student.masteryPercentile);
              const isFlagged = student.flag === "high_effort_low_mastery";
              const tooltip = `${student.name}\nTotal XP: ${student.xp} (${student.effortPercentile}th percentile)\nMean Confidence: ${
                student.unassessed ? "Unassessed" : `${(student.averageConfidence * 100).toFixed(1)}%`
              } (${student.masteryPercentile}th percentile)\nEnrolled: ${formatUtcDate(student.enrolledAt)}${
                isFlagged ? "\nStatus: Needs support (High effort, low mastery)" : ""
              }`;

              if (isFlagged) {
                return (
                  <g key={student.studentId} className="cursor-pointer">
                    <title>{tooltip}</title>
                    {/* Non-color marker difference: Diamond shape + crimson border */}
                    <polygon
                      points={`${cx},${cy - 7} ${cx + 7},${cy} ${cx},${cy + 7} ${cx - 7},${cy}`}
                      fill="var(--color-bad, #b0384a)"
                      stroke="#2b2a2e"
                      strokeWidth="1.5"
                    />
                    <text
                      x={cx + 9}
                      y={cy + 3}
                      className="fill-bad text-[10px] font-semibold pointer-events-none select-none"
                    >
                      {student.name}
                    </text>
                  </g>
                );
              }

              return (
                <g key={student.studentId} className="cursor-pointer">
                  <title>{tooltip}</title>
                  {/* Standard student circle */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={student.unassessed ? 4 : 4.5}
                    fill={student.unassessed ? "transparent" : "#2b2a2e"}
                    stroke="#2b2a2e"
                    strokeWidth={student.unassessed ? 1.5 : 1}
                    strokeDasharray={student.unassessed ? "2 2" : undefined}
                  />
                  <text
                    x={cx + 8}
                    y={cy + 3}
                    className="fill-[#4a4743] dark:fill-[#d2ccbf] text-[10px] pointer-events-none select-none"
                  >
                    {student.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* 2. Semantic Sortable Roster Table */}
      <div className="bg-paper-panel border border-paper-line rounded-lg overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-paper-line flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">Student Effort &amp; Mastery Roster</h3>
            <p className="text-xs text-muted mt-0.5">
              Individual metrics for {baseRows.length} enrolled student{baseRows.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>

        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Student effort and mastery table"
        >
          <table className="w-full text-left border-collapse text-xs">
            <caption className="sr-only">Cohort Effort &amp; Mastery Roster</caption>
            <thead>
              <tr className="border-b border-paper-line bg-paper-muted/60 text-muted font-medium">
                <th
                  scope="col"
                  className="py-3 px-4 text-left"
                  aria-sort={sortKey === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => handleSort("name")}
                    className="font-semibold text-ink hover:text-accent flex items-center gap-1 focus:outline-none focus:underline"
                  >
                    Student
                    {sortKey === "name" && (
                      <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th
                  scope="col"
                  className="py-3 px-4 text-left"
                  aria-sort={
                    sortKey === "enrolledAt" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleSort("enrolledAt")}
                    className="font-semibold text-ink hover:text-accent flex items-center gap-1 focus:outline-none focus:underline"
                  >
                    Enrolled (UTC)
                    {sortKey === "enrolledAt" && (
                      <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th
                  scope="col"
                  className="py-3 px-4 text-right"
                  aria-sort={sortKey === "xp" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => handleSort("xp")}
                    className="font-semibold text-ink hover:text-accent inline-flex items-center gap-1 focus:outline-none focus:underline ml-auto"
                  >
                    Total XP
                    {sortKey === "xp" && (
                      <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th
                  scope="col"
                  className="py-3 px-4 text-right"
                  aria-sort={
                    sortKey === "averageConfidence"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleSort("averageConfidence")}
                    className="font-semibold text-ink hover:text-accent inline-flex items-center gap-1 focus:outline-none focus:underline ml-auto"
                  >
                    Mean confidence
                    {sortKey === "averageConfidence" && (
                      <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th
                  scope="col"
                  className="py-3 px-4 text-right"
                  aria-sort={
                    sortKey === "effortPercentile"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleSort("effortPercentile")}
                    className="font-semibold text-ink hover:text-accent inline-flex items-center gap-1 focus:outline-none focus:underline ml-auto"
                  >
                    Effort %ile
                    {sortKey === "effortPercentile" && (
                      <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th
                  scope="col"
                  className="py-3 px-4 text-right"
                  aria-sort={
                    sortKey === "masteryPercentile"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleSort("masteryPercentile")}
                    className="font-semibold text-ink hover:text-accent inline-flex items-center gap-1 focus:outline-none focus:underline ml-auto"
                  >
                    Mastery %ile
                    {sortKey === "masteryPercentile" && (
                      <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
                <th scope="col" className="py-3 px-4 text-left font-semibold text-ink">
                  Intervention
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line font-normal">
              {sortedRows.map((row) => {
                const isFlagged = row.flag === "high_effort_low_mastery";
                return (
                  <tr
                    key={row.studentId}
                    className={cn(
                      "transition-colors hover:bg-paper-muted/40",
                      isFlagged ? "bg-bad-tint/20 dark:bg-bad-tint/10" : "",
                    )}
                  >
                    <td className="py-3 px-4 font-medium text-ink">
                      <span>{row.name}</span>
                    </td>
                    <td className="py-3 px-4 text-muted tabular-nums">
                      <time dateTime={row.enrolledAt}>{formatUtcDate(row.enrolledAt)}</time>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-ink">
                      {row.xp.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {row.unassessed ? (
                        <span className="text-muted italic">Unassessed</span>
                      ) : (
                        <span className="text-ink">{(row.averageConfidence * 100).toFixed(1)}%</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-ink">
                      {row.effortPercentile}%
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-ink">
                      {row.masteryPercentile}%
                    </td>
                    <td className="py-3 px-4 text-left">
                      {isFlagged ? (
                        <Badge
                          variant="outline"
                          className="border-bad text-bad bg-bad-tint/40 font-semibold"
                          title="High effort (≥ 75th percentile) and low mastery (≤ 40th percentile)"
                        >
                          Needs support
                        </Badge>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
