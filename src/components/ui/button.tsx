import * as React from "react";
import { type MasteryBand, MASTERY_PALETTE } from "./tokens.js";

export type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "destructive"
  | "ghost"
  | "link"
  | "mastery";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  band?: MasteryBand;
  isLoading?: boolean;
  loadingText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<Exclude<ButtonVariant, "mastery">, string> = {
  default:
    "bg-sky-600 text-white hover:bg-sky-700 active:bg-sky-800 focus-visible:ring-sky-500",
  secondary:
    "bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300 focus-visible:ring-slate-400 border border-slate-200",
  outline:
    "bg-transparent text-slate-800 border border-slate-300 hover:bg-slate-50 active:bg-slate-100 focus-visible:ring-slate-400",
  destructive:
    "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500",
  ghost:
    "bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 focus-visible:ring-slate-400",
  link:
    "bg-transparent text-sky-600 underline-offset-4 hover:underline p-0 h-auto focus-visible:ring-sky-500",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded-md gap-1.5",
  md: "h-10 px-4 text-sm rounded-md gap-2",
  lg: "h-12 px-6 text-base rounded-lg gap-2.5",
  icon: "h-10 w-10 p-0 rounded-md justify-center",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "default",
      size = "md",
      band = "gray",
      isLoading = false,
      loadingText,
      leftIcon,
      rightIcon,
      disabled = false,
      className = "",
      style,
      children,
      type = "button",
      ...props
    },
    ref
  ) => {
    const isActuallyDisabled = disabled || isLoading;

    let computedVariantClass = "";
    let customStyle: React.CSSProperties | undefined = style;

    if (variant === "mastery") {
      const palette = MASTERY_PALETTE[band];
      customStyle = {
        backgroundColor: palette.solidBg,
        color: palette.solidText,
        ...style,
      };
      computedVariantClass = "hover:opacity-90 active:opacity-100";
    } else {
      computedVariantClass = variantStyles[variant];
    }

    const baseClass =
      "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer";

    return (
      <button
        ref={ref}
        type={type}
        disabled={isActuallyDisabled}
        aria-busy={isLoading ? true : undefined}
        aria-disabled={isActuallyDisabled ? true : undefined}
        className={`${baseClass} ${sizeStyles[size]} ${computedVariantClass} ${className}`.trim()}
        style={customStyle}
        {...props}
      >
        {isLoading && (
          <span
            className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent h-4 w-4 mr-2"
            aria-hidden="true"
          />
        )}
        {!isLoading && leftIcon && (
          <span className="inline-flex shrink-0" aria-hidden="true">
            {leftIcon}
          </span>
        )}
        <span>{isLoading && loadingText ? loadingText : children}</span>
        {!isLoading && rightIcon && (
          <span className="inline-flex shrink-0" aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
