import * as React from "react";
import {
  type MasteryBand,
  MASTERY_PALETTE,
  ACTIVE_CONCEPT_RING,
} from "./tokens.js";
import { confidenceToBand } from "../../contracts/index.js";

export type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "destructive"
  | "mastery";

export type BadgeSize = "sm" | "md" | "lg";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  band?: MasteryBand;
  confidence?: number;
  textAlternative?: string;
  pulse?: boolean;
  size?: BadgeSize;
}

const standardVariantStyles: Record<
  Exclude<BadgeVariant, "mastery">,
  string
> = {
  default: "bg-sky-100 text-sky-800 border-sky-200",
  secondary: "bg-slate-100 text-slate-800 border-slate-200",
  outline: "bg-transparent text-slate-700 border-slate-300",
  destructive: "bg-red-100 text-red-800 border-red-200",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-0.5 text-xs font-semibold",
  lg: "px-3 py-1 text-sm font-semibold",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = "default",
      band,
      confidence,
      textAlternative,
      pulse = false,
      size = "md",
      className = "",
      style,
      children,
      ...props
    },
    ref
  ) => {
    // If confidence is provided or band is explicitly passed, default variant to "mastery"
    const effectiveVariant: BadgeVariant =
      confidence !== undefined || band !== undefined
        ? "mastery"
        : variant;

    let effectiveBand: MasteryBand = "gray";
    if (confidence !== undefined) {
      effectiveBand = confidenceToBand(confidence);
    } else if (band !== undefined) {
      effectiveBand = band;
    }

    const palette = MASTERY_PALETTE[effectiveBand];

    // Compute accessible text alternative
    let accessibleLabel = textAlternative;
    if (!accessibleLabel) {
      if (confidence !== undefined) {
        const percent = Math.round(confidence * 100);
        accessibleLabel = `${palette.name} (${percent}%)`;
      } else if (effectiveVariant === "mastery") {
        accessibleLabel = palette.textAlternative;
      }
    }

    let customStyle: React.CSSProperties | undefined = style;
    let variantClasses = "";

    if (effectiveVariant === "mastery") {
      customStyle = {
        backgroundColor: palette.softBg,
        color: palette.softText,
        borderColor: palette.border,
        ...style,
      };
      variantClasses = "border";
    } else {
      variantClasses = `border ${standardVariantStyles[effectiveVariant]}`;
    }

    // Pulse ring style for active lecture concept (docs/09-frontend.md section 3.2)
    const pulseClasses = pulse
      ? "ring-2 ring-offset-1 animate-active-concept"
      : "";

    const pulseStyle: React.CSSProperties = pulse
      ? {
          outlineColor: ACTIVE_CONCEPT_RING,
        }
      : {};

    const baseClasses =
      "inline-flex items-center justify-center rounded-full font-medium transition-all select-none";

    return (
      <span
        ref={ref}
        role="status"
        aria-label={accessibleLabel}
        className={`${baseClasses} ${sizeStyles[size]} ${variantClasses} ${pulseClasses} ${className}`.trim()}
        style={{ ...pulseStyle, ...customStyle }}
        {...props}
      >
        {children || accessibleLabel}
      </span>
    );
  }
);

Badge.displayName = "Badge";
