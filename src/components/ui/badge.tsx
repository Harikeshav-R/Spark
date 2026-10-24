import React from "react";
import type { MasteryBand } from "../../contracts/common.js";
import { cn } from "../../lib/client/utils.js";

export type BadgeVariant = "default" | "secondary" | "outline" | "soft" | "solid";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  mastery?: MasteryBand;
  confidence?: number;
  isActiveConcept?: boolean;
}

export const MASTERY_COLORS = {
  gray: "#9CA3AF",
  red: "#EF4444",
  yellow: "#F59E0B",
  green: "#10B981",
} as const;

export const MASTERY_BG_COLORS = {
  gray: "#F3F4F6",
  red: "#FEF2F2",
  yellow: "#FEF3C7",
  green: "#D1FAE5",
} as const;

export const MASTERY_TEXT_COLORS = {
  gray: "#374151",
  red: "#991B1B",
  yellow: "#92400E",
  green: "#065F46",
} as const;

export const MASTERY_BORDER_COLORS = {
  gray: "#D1D5DB",
  red: "#FCA5A5",
  yellow: "#FCD34D",
  green: "#6EE7B7",
} as const;

export const ACTIVE_CONCEPT_COLOR = "#F59E0B";

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
  }
}

const masterySoftStyles: Record<MasteryBand, string> = {
  gray: "bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700",
  red: "bg-red-50 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
  yellow: "bg-amber-50 text-amber-950 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  green: "bg-emerald-50 text-emerald-950 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
};

const masterySolidStyles: Record<MasteryBand, string> = {
  gray: "bg-[#9CA3AF] text-gray-950 border-[#9CA3AF]",
  red: "bg-[#EF4444] text-gray-950 border-[#EF4444]",
  yellow: "bg-[#F59E0B] text-gray-950 border-[#F59E0B]",
  green: "bg-[#10B981] text-gray-950 border-[#10B981]",
};

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-200",
  secondary: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-200",
  outline: "bg-transparent text-gray-800 border-gray-300 dark:text-gray-200 dark:border-gray-700",
  soft: "bg-gray-100 text-gray-800 border-transparent dark:bg-gray-800 dark:text-gray-200",
  solid: "bg-gray-900 text-white border-transparent dark:bg-gray-100 dark:text-gray-900",
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
          "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full border transition-all select-none",
          resolvedStyle,
          isActiveConcept &&
            "ring-2 ring-amber-500 ring-offset-1 ring-offset-white dark:ring-offset-gray-900 animate-active-concept",
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
