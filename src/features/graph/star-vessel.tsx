"use client";

import React, { useId } from "react";
import type { GraphNode } from "./d3-force-layout";
import type { MasteryBand } from "../../contracts/common";
import { confidenceToBand } from "../../contracts/mastery";
import {
  MASTERY_COLORS,
  MASTERY_BORDER_COLORS,
} from "../../components/ui/badge";

export interface StarVesselProps {
  node: GraphNode;
  x: number;
  y: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}

/**
 * 5-point star path centered at (0, 0) with outer radius R=24 and inner radius r=9.5.
 * Fits within a 48x48 bounding box [-24, 24] x [-24, 24].
 */
const STAR_PATH =
  "M 0,-24 L 5.58,-7.69 L 22.83,-7.42 L 9.04,2.94 L 14.11,19.42 L 0,9.5 L -14.11,19.42 L -9.04,2.94 L -22.83,-7.42 L -5.58,-7.69 Z";

/**
 * Splits a concept label into at most two visual lines of text.
 */
function splitLabel(label: string, maxCharsPerLine = 16): [string, string | null] {
  if (label.length <= maxCharsPerLine) {
    return [label, null];
  }
  const words = label.split(" ");
  if (words.length === 1) {
    return [label.slice(0, 14) + "…", null];
  }
  let line1 = "";
  let line2 = "";
  for (const word of words) {
    if (!line1) {
      line1 = word;
    } else if (line1.length + 1 + word.length <= maxCharsPerLine) {
      line1 += " " + word;
    } else if (!line2) {
      line2 = word;
    } else {
      line2 += " " + word;
    }
  }
  if (line2.length > 18) {
    line2 = line2.slice(0, 16) + "…";
  }
  return [line1, line2 || null];
}

/**
 * Returns human-readable status text for a concept node.
 */
export function getStatusText(node: GraphNode): {
  statusText: string;
  band: MasteryBand | null;
  percentageText: string | null;
} {
  if (node.confidence === undefined) {
    return {
      statusText: "Mastery unavailable",
      band: null,
      percentageText: null,
    };
  }

  const band = confidenceToBand(node.confidence);
  const pct = Number((node.confidence * 100).toFixed(1));
  const percentageText = `${pct}%`;

  let base = "Unassessed";
  if (band === "red") base = "Dim / Needs practice";
  else if (band === "yellow") base = "Lit / Developing";
  else if (band === "green") base = "Shining / Mastered";

  return {
    statusText: `${base} (${percentageText})`,
    band,
    percentageText,
  };
}

export function StarVessel({
  node,
  x,
  y,
  selected,
  dimmed,
  onSelect,
}: StarVesselProps): React.JSX.Element {
  const reactId = useId();
  // Sanitize reactId and node.id for valid SVG ID attribute
  const safeReactId = reactId.replace(/[^a-zA-Z0-9-_]/g, "");
  const safeNodeId = node.id.replace(/[^a-zA-Z0-9-_]/g, "");
  const clipId = `star-clip-${safeReactId}-${safeNodeId}`;

  const { statusText, band } = getStatusText(node);

  // Confidence fill geometry: height in [0, 48], vertical bottom-up
  const c = node.confidence !== undefined ? Math.max(0, Math.min(1, node.confidence)) : 0;
  const clipHeight = node.confidence !== undefined ? Math.round(48 * c) : 0;
  const clipY = 24 - clipHeight;

  // Visual outline styling per band:
  // gray -> dashed, red -> dotted, yellow -> solid, green -> double ring
  let strokeColor = "#e6d8bd";
  let strokeDasharray: string | undefined = undefined;
  let strokeWidth = 1.5;

  if (band === "gray") {
    strokeColor = MASTERY_BORDER_COLORS.gray;
    strokeDasharray = "4 3";
  } else if (band === "red") {
    strokeColor = MASTERY_BORDER_COLORS.red;
    strokeDasharray = "2 3";
    strokeWidth = 2;
  } else if (band === "yellow") {
    strokeColor = MASTERY_BORDER_COLORS.yellow;
    strokeWidth = 2;
  } else if (band === "green") {
    strokeColor = MASTERY_BORDER_COLORS.green;
    strokeWidth = 2;
  }

  const [labelLine1, labelLine2] = splitLabel(node.label);

  return (
    <g
      transform={`translate(${x}, ${y})`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${node.label}, ${statusText}`}
      data-node-id={node.id}
      className="cursor-pointer group outline-none select-none"
      onClick={() => onSelect(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <title>{`${node.label} — ${statusText}`}</title>

      <defs>
        <clipPath id={clipId}>
          <rect x="-24" y={clipY} width="48" height={clipHeight} />
        </clipPath>
      </defs>

      {/* 48px+ circular hit area */}
      <circle r="26" fill="transparent" pointerEvents="all" />

      {/* Decorative star vessels: dimmed on non-ancestors */}
      <g
        className="transition-opacity duration-200"
        opacity={dimmed ? 0.25 : 1}
        pointerEvents="none"
      >
        {/* Base star: warm cream canvas */}
        <path
          d={STAR_PATH}
          fill="#f4e9d7"
          stroke="#e6d8bd"
          strokeWidth="1.5"
        />

        {/* Confidence-filled clipped overlay */}
        {node.confidence !== undefined && band && (
          <path
            d={STAR_PATH}
            fill={MASTERY_COLORS[band]}
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Outline with distinct non-color pattern */}
        <path
          d={STAR_PATH}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />

        {/* Green / Mastered geometric double-ring */}
        {band === "green" && (
          <circle
            r="28"
            fill="none"
            stroke={MASTERY_BORDER_COLORS.green}
            strokeWidth="1.5"
          />
        )}
      </g>

      {/* Focus ring: visible on keyboard navigation */}
      <circle
        r="31"
        fill="none"
        stroke="#2b2a2e"
        strokeWidth="2"
        className="pointer-events-none opacity-0 group-focus-visible:opacity-100 transition-opacity"
      />

      {/* Selected indicator ring */}
      {selected && (
        <circle
          r="34"
          fill="none"
          stroke="#a9481a"
          strokeWidth="2.5"
          className="pointer-events-none"
        />
      )}

      {/* Label and status text: OUTSIDE dimmed geometry for continuous WCAG readability */}
      <text
        x="0"
        y={labelLine2 ? 38 : 42}
        textAnchor="middle"
        className="fill-[#2b2a2e] text-[12px] font-medium pointer-events-none"
        style={{ fontFamily: "inherit" }}
      >
        {labelLine1}
      </text>
      {labelLine2 && (
        <text
          x="0"
          y="52"
          textAnchor="middle"
          className="fill-[#2b2a2e] text-[12px] font-medium pointer-events-none"
          style={{ fontFamily: "inherit" }}
        >
          {labelLine2}
        </text>
      )}
      <text
        x="0"
        y={labelLine2 ? 65 : 56}
        textAnchor="middle"
        className="fill-[#66625d] text-[10px] pointer-events-none"
        style={{ fontFamily: "inherit" }}
      >
        {statusText}
      </text>
    </g>
  );
}
