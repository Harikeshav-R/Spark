"use client";

import React from "react";
import type { MasteryBand } from "../../contracts/common";
import { cn } from "../../lib/client/utils";

export type BadgeVariant = "default" | "secondary" | "outline" | "soft" | "solid";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  mastery?: MasteryBand;
  confidence?: number;
  isActiveConcept?: boolean;
}

export const MASTERY_COLORS = {
  gray: "#f4e9d7",
  red: "#b0384a",
  yellow: "#f4bc55",
  green: "#2b7f55",
} as const;

export const MASTERY_BG_COLORS = {
  gray: "#f4e9d7",
  red: "#f8e0e3",
  yellow: "#fbeac2",
  green: "#dff1e5",
} as const;

export const MASTERY_TEXT_COLORS = {
  gray: "#2b2a2e",
  red: "#2b2a2e",
  yellow: "#2b2a2e",
  green: "#2b2a2e",
} as const;

export const MASTERY_BORDER_COLORS = {
  gray: "#e6d8bd",
  red: "#b0384a",
  yellow: "#cf951f",
  green: "#2b7f55",
} as const;

export const ACTIVE_CONCEPT_COLOR = "#ed793c";

/**
 * Returns an accessible text description for a mastery band per WCAG 2.1 AA.
 * Ensures color-blind students have textual equivalents for visual mastery indicators.
 */
export function getMasteryLabel(band: MasteryBand, confidence?: number): string {
  const percentageStr =
    typeof confidence === "number" && Number.isFinite(confidence)
      ? ` (${Math.round(confidence * 100)}%)`
      : "";

  switch (band) {
    case "gray":
      return `Not Started${percentageStr}`;
    case "red":
      return `Needs Practice${percentageStr}`;
    case "yellow":
      return `In Progress${percentageStr}`;
    case "green":
      return `Mastered${percentageStr}`;
    default:
      return `Unknown${percentageStr}`;
  }
}

const masterySoftStyles: Record<MasteryBand, string> = {
  gray: "bg-[#f4e9d7] text-[#2b2a2e] border-[#e6d8bd]",
  red: "bg-[#f8e0e3] text-[#2b2a2e] border-[#b0384a]",
  yellow: "bg-[#fbeac2] text-[#2b2a2e] border-[#cf951f]",
  green: "bg-[#dff1e5] text-[#2b2a2e] border-[#2b7f55]",
};

const masterySolidStyles: Record<MasteryBand, string> = {
  gray: "bg-[#f4e9d7] text-[#2b2a2e] border-[#e6d8bd]",
  red: "bg-[#b0384a] text-[#fffdf8] border-[#b0384a]",
  yellow: "bg-[#f4bc55] text-[#2b2a2e] border-[#cf951f]",
  green: "bg-[#2b7f55] text-[#fffdf8] border-[#2b7f55]",
};

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[#f4e9d7] text-[#a9481a] border-[#e6d8bd]",
  secondary: "bg-[#f4e9d7] text-[#2b2a2e] border-[#e6d8bd]",
  outline: "bg-transparent text-[#2b2a2e] border-[#3a3a3d]",
  soft: "bg-[#f4e9d7] text-[#2b2a2e] border-transparent",
  solid: "bg-[#2b2a2e] text-[#fffdf8] border-transparent",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      variant = "default",
      mastery,
      confidence,
      isActiveConcept = false,
      children,
      ...props
    },
    ref
  ) => {
    let resolvedStyle = variantStyles[variant];

    if (mastery) {
      resolvedStyle = variant === "solid" ? masterySolidStyles[mastery] : masterySoftStyles[mastery];
    }

    const accessibleLabel = mastery ? getMasteryLabel(mastery, confidence) : undefined;

    return (
      <span
        ref={ref}
        aria-label={props["aria-label"] || accessibleLabel}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full border transition-colors select-none",
          resolvedStyle,
          isActiveConcept &&
            "ring-2 ring-[#c85c22] ring-offset-1 ring-offset-[#faf6ee] animate-active-concept",
          className
        )}
        {...props}
      >
        {mastery && (
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: MASTERY_COLORS[mastery] }}
            aria-hidden="true"
          />
        )}
        {children ?? accessibleLabel}
      </span>
    );
  }
);

Badge.displayName = "Badge";
