"use client";

import React from "react";
import { cn } from "../../lib/client/utils";

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  default:
    "bg-[#ed793c] text-[#2b2a2e] border border-[#3a3a3d] hover:bg-[#ecdcc0] hover:text-[#2b2a2e] active:bg-[#f4e9d7] shadow-sm",
  secondary:
    "bg-[#f4e9d7] text-[#2b2a2e] border border-[#3a3a3d] hover:bg-[#ecdcc0] active:bg-[#ecdcc0]",
  outline:
    "bg-[#fffdf8] text-[#2b2a2e] border border-[#3a3a3d] hover:bg-[#f4e9d7] active:bg-[#ecdcc0]",
  ghost:
    "bg-transparent text-[#2b2a2e] border border-transparent hover:bg-[#f4e9d7] active:bg-[#ecdcc0]",
  destructive:
    "bg-[#b0384a] text-[#fffdf8] border border-[#3a3a3d] hover:bg-[#3a3a3d] hover:text-[#fffdf8] active:bg-[#2b2a2e] shadow-sm",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded",
  md: "h-10 px-4 py-2 text-sm rounded-md",
  lg: "h-12 px-6 text-base rounded-lg",
  icon: "h-10 w-10 p-2 rounded-md flex items-center justify-center",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "md",
      isLoading = false,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={isLoading ? "true" : undefined}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors cursor-pointer select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed",
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {isLoading && (
          <svg
            className="mr-2 h-4 w-4 animate-spin text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
