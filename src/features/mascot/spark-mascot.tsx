"use client";

import React, { useId } from "react";
import { cn } from "../../lib/client/utils.js";
import {
  type SparkMood,
  SPARK_MOODS,
  SPARK_FORM_LABELS,
  getSparkForm,
  type SparkSparkleDefinition,
} from "./spark-moods.js";
import type { SparkForm } from "../../contracts/index.js";

export interface SparkMascotProps {
  skyBrightness: number;
  mood?: SparkMood;
  size?: 132 | 84 | 32;
  className?: string;
}

/**
 * Precomputed Ray Definitions
 * Spark: 8 rays
 * Glow:  12 rays
 * Nova:  16 alternating short/long rays
 * Module-level tables ensure zero frame-time trigonometry.
 */
interface RayDef {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isLong?: boolean;
}

const SPARK_RAYS_8: ReadonlyArray<RayDef> = [
  { x1: 83.2, y1: 26.4, x2: 85.9, y2: 20.0 },
  { x1: 107.6, y1: 50.8, x2: 114.0, y2: 48.1 },
  { x1: 107.6, y1: 85.2, x2: 114.0, y2: 87.9 },
  { x1: 83.2, y1: 109.6, x2: 85.1, y2: 114.0 },
  { x1: 48.8, y1: 109.6, x2: 46.9, y2: 114.0 },
  { x1: 24.4, y1: 85.2, x2: 18.0, y2: 87.9 },
  { x1: 24.4, y1: 50.8, x2: 18.0, y2: 48.1 },
  { x1: 48.8, y1: 26.4, x2: 46.1, y2: 20.0 },
];

const GLOW_RAYS_12: ReadonlyArray<RayDef> = [
  { x1: 66.0, y1: 23.0, x2: 66.0, y2: 14.0 },
  { x1: 88.5, y1: 29.0, x2: 93.0, y2: 21.2 },
  { x1: 105.0, y1: 45.5, x2: 112.8, y2: 41.0 },
  { x1: 111.0, y1: 68.0, x2: 120.0, y2: 68.0 },
  { x1: 105.0, y1: 90.5, x2: 112.8, y2: 95.0 },
  { x1: 88.5, y1: 107.0, x2: 92.6, y2: 114.0 },
  { x1: 66.0, y1: 110.0, x2: 66.0, y2: 114.0 },
  { x1: 43.5, y1: 107.0, x2: 39.4, y2: 114.0 },
  { x1: 27.0, y1: 90.5, x2: 19.2, y2: 95.0 },
  { x1: 21.0, y1: 68.0, x2: 12.0, y2: 68.0 },
  { x1: 27.0, y1: 45.5, x2: 19.2, y2: 41.0 },
  { x1: 43.5, y1: 29.0, x2: 39.0, y2: 21.2 },
];

const NOVA_RAYS_16: ReadonlyArray<RayDef> = [
  { x1: 66.0, y1: 23.0, x2: 66.0, y2: 12.0, isLong: true },
  { x1: 83.2, y1: 26.4, x2: 85.5, y2: 20.9, isLong: false },
  { x1: 97.8, y1: 36.2, x2: 105.6, y2: 28.4, isLong: true },
  { x1: 107.6, y1: 50.8, x2: 113.1, y2: 48.5, isLong: false },
  { x1: 111.0, y1: 68.0, x2: 122.0, y2: 68.0, isLong: true },
  { x1: 107.6, y1: 85.2, x2: 113.1, y2: 87.5, isLong: false },
  { x1: 97.8, y1: 99.8, x2: 105.6, y2: 107.6, isLong: true },
  { x1: 83.2, y1: 109.6, x2: 85.1, y2: 114.0, isLong: false },
  { x1: 66.0, y1: 110.0, x2: 66.0, y2: 114.0, isLong: true },
  { x1: 48.8, y1: 109.6, x2: 46.9, y2: 114.0, isLong: false },
  { x1: 34.2, y1: 99.8, x2: 26.4, y2: 107.6, isLong: true },
  { x1: 24.4, y1: 85.2, x2: 18.9, y2: 87.5, isLong: false },
  { x1: 21.0, y1: 68.0, x2: 10.0, y2: 68.0, isLong: true },
  { x1: 24.4, y1: 50.8, x2: 18.9, y2: 48.5, isLong: false },
  { x1: 34.2, y1: 36.2, x2: 26.4, y2: 28.4, isLong: true },
  { x1: 48.8, y1: 26.4, x2: 46.5, y2: 20.9, isLong: false },
];

/**
 * Closed teardrop flame silhouettes for the four evolutionary forms.
 * All paths authored within exact fixed bounding boxes:
 * - Ember: x=38..94, y=37..106
 * - Spark: x=29..103, y=25..108
 * - Glow:  x=25..107, y=21..110
 * - Nova:  x=22..110, y=18..110
 */
const FLAME_SILHOUETTES: Readonly<Record<SparkForm, string>> = {
  ember:
    "M 66 37 C 72 50 94 68 94 88 C 94 100 82 106 66 106 C 50 106 38 100 38 88 C 38 68 60 50 66 37 Z",
  spark:
    "M 66 25 C 74 42 103 64 103 89 C 103 101 87 108 66 108 C 45 108 29 101 29 89 C 29 64 58 42 66 25 Z",
  glow:
    "M 66 21 C 76 40 107 62 107 89 C 107 102 90 110 66 110 C 42 110 25 102 25 89 C 25 62 56 40 66 21 Z",
  nova:
    "M 66 18 C 78 38 110 60 110 89 C 110 102 92 110 66 110 C 40 110 22 102 22 89 C 22 60 54 38 66 18 Z",
};

/**
 * Nova three-point light crown path situated directly above the flame tip.
 */
const NOVA_CROWN_PATH = "M 50 17 L 52 9 L 60 14 L 66 5 L 72 14 L 80 9 L 82 17 Z";

function renderSparkle(sparkle: SparkSparkleDefinition, key: string | number) {
  const { cx, cy, size } = sparkle;
  const d = `M ${cx} ${cy - size} Q ${cx} ${cy} ${cx + size} ${cy} Q ${cx} ${cy} ${cx} ${cy + size} Q ${cx} ${cy} ${cx - size} ${cy} Q ${cx} ${cy} ${cx} ${cy - size} Z`;
  return (
    <path
      key={key}
      d={d}
      fill="var(--color-yellow)"
      stroke="var(--color-orange-deep)"
      strokeWidth={0.5}
      className="spark-mascot-sparkle"
    />
  );
}

/**
 * Reusable reactive SVG companion mascot: Spark.
 * Implements 4 evolutionary forms (Ember, Spark, Glow, Nova),
 * 5 moods (calm, think, cheer, oops, sleepy),
 * 3 responsive sizes (132px, 84px, 32px),
 * and strict prefers-reduced-motion safety.
 */
export function SparkMascot({
  skyBrightness,
  mood = "calm",
  size = 132,
  className,
}: SparkMascotProps): React.JSX.Element {
  const form = getSparkForm(skyBrightness);
  const moodDef = SPARK_MOODS[mood];
  const formLabel = SPARK_FORM_LABELS[form];

  const rawId = useId();
  const cleanId = rawId.replace(/[^a-zA-Z0-9-_]/g, "");
  const gradId = `spark-grad-${cleanId}`;
  const titleId = `spark-title-${cleanId}`;
  const accessibleTitle = `Spark — ${formLabel}, ${moodDef.label}`;

  const isCompact = size === 32;
  const rayStrokeWidth = isCompact ? 1.5 : 2.5;

  return (
    <svg
      viewBox="0 0 132 132"
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      focusable="false"
      aria-labelledby={titleId}
      className={cn("spark-mascot", "select-none", className)}
      style={{ pointerEvents: "none" }}
      data-form={form}
      data-mood={mood}
      data-size={size}
    >
      <title id={titleId}>{accessibleTitle}</title>
      <defs>
        <radialGradient id={gradId} cx="50%" cy="45%" r="55%" fx="45%" fy="35%">
          <stop offset="0%" stopColor="var(--color-yellow)" />
          <stop offset="85%" stopColor="var(--color-orange)" />
          <stop offset="100%" stopColor="var(--color-orange-deep)" />
        </radialGradient>
      </defs>

      {/* Ground drop shadow: stationary anchor at (66, 117) */}
      <ellipse
        cx={66}
        cy={117}
        rx={29}
        ry={5}
        fill="var(--color-ink)"
        className="spark-mascot-shadow"
      />

      {/* Main animated figure group */}
      <g
        className={cn("spark-mascot-figure", `spark-mascot-mood-${mood}`)}
        style={{ transformOrigin: "66px 80px" }}
      >
        {/* Form evolution layer: immediate silhouette switch + 180ms opacity entrance under normal motion */}
        <g key={form} className="spark-mascot-form-layer">
          {/* Form-specific halo / corona */}
          {form === "glow" && !isCompact && (
            <circle
              cx={66}
              cy={68}
              r={46}
              fill="var(--color-yellow)"
              className="spark-mascot-halo-glow"
            />
          )}

          {form === "nova" && !isCompact && (
            <circle
              cx={66}
              cy={68}
              r={52}
              fill="var(--color-yellow)"
              className="spark-mascot-halo-nova"
            />
          )}

          {/* Form-specific radiating rays */}
          {form === "spark" && (
            <g className="spark-mascot-rays">
              {SPARK_RAYS_8.map((ray, i) => (
                <line
                  key={i}
                  x1={ray.x1}
                  y1={ray.y1}
                  x2={ray.x2}
                  y2={ray.y2}
                  stroke="var(--color-orange)"
                  strokeWidth={rayStrokeWidth}
                  strokeLinecap="round"
                />
              ))}
            </g>
          )}

          {form === "glow" && (
            <g className="spark-mascot-rays">
              {GLOW_RAYS_12.map((ray, i) => (
                <line
                  key={i}
                  x1={ray.x1}
                  y1={ray.y1}
                  x2={ray.x2}
                  y2={ray.y2}
                  stroke="var(--color-yellow-deep)"
                  strokeWidth={rayStrokeWidth}
                  strokeLinecap="round"
                />
              ))}
            </g>
          )}

          {form === "nova" && (
            <g className="spark-mascot-rays">
              {NOVA_RAYS_16.map((ray, i) => (
                <line
                  key={i}
                  x1={ray.x1}
                  y1={ray.y1}
                  x2={ray.x2}
                  y2={ray.y2}
                  stroke={ray.isLong ? "var(--color-orange)" : "var(--color-yellow-deep)"}
                  strokeWidth={rayStrokeWidth}
                  strokeLinecap="round"
                />
              ))}
            </g>
          )}

          {/* Nova three-point light crown */}
          {form === "nova" && (
            <path
              d={NOVA_CROWN_PATH}
              fill="var(--color-yellow)"
              stroke="var(--color-orange-deep)"
              strokeWidth={isCompact ? 1 : 1.5}
              strokeLinejoin="round"
              className="spark-mascot-crown"
            />
          )}

          {/* Core flame body */}
          <path
            d={FLAME_SILHOUETTES[form]}
            fill={`url(#${gradId})`}
            stroke="var(--color-orange-deep)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            className="spark-mascot-body"
          />

          {/* Form-specific decorations (omitted at 32px compact) */}
          {!isCompact && form === "ember" && (
            <g className="spark-mascot-ember-particles">
              <circle
                cx={42}
                cy={50}
                r={2.5}
                fill="var(--color-yellow)"
                className="spark-mascot-ember-particle"
              />
              <circle
                cx={90}
                cy={46}
                r={2}
                fill="var(--color-orange)"
                className="spark-mascot-ember-particle"
              />
            </g>
          )}

          {!isCompact && form === "glow" && (
            <g className="spark-mascot-glow-sparkles">
              {renderSparkle({ cx: 34, cy: 40, size: 4 }, "glow-sparkle-1")}
              {renderSparkle({ cx: 98, cy: 42, size: 4 }, "glow-sparkle-2")}
            </g>
          )}
        </g>

        {/* Mood reaction layer: restarts finite cheer/oops entry sequence */}
        <g key={mood} className="spark-mascot-reaction-layer">
          {/* Mood cheer sparkles (3 four-point sparkles around the head) */}
          {!isCompact &&
            mood === "cheer" &&
            moodDef.sparkles && (
              <g className="spark-mascot-cheer-sparkles">
                {moodDef.sparkles.map((sp, idx) => renderSparkle(sp, `cheer-sparkle-${idx}`))}
              </g>
            )}

          {/* Expressive face: constant anchor across all forms */}
          <g
            className="spark-mascot-face"
            stroke="var(--color-ink)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            {moodDef.brow && (
              <path d={moodDef.brow} className="spark-mascot-brow" />
            )}
            <path d={moodDef.leftEye} className="spark-mascot-left-eye" />
            <path d={moodDef.rightEye} className="spark-mascot-right-eye" />
            <path d={moodDef.mouth} className="spark-mascot-mouth" />
          </g>
        </g>
      </g>
    </svg>
  );
}
