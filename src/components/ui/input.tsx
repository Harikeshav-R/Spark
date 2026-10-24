"use client";

import React, { useId } from "react";
import { cn } from "../../lib/client/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", label, description, error, id, disabled, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const descId = description ? `${inputId}-desc` : undefined;
    const errId = error ? `${inputId}-err` : undefined;

    const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-[#2b2a2e]"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          className={cn(
            "flex h-10 w-full rounded-md border border-[#3a3a3d] bg-[#fffdf8] px-3 py-2 text-base md:text-sm text-[#2b2a2e] placeholder:text-[#5f5b54]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-[#b0384a] focus-visible:ring-[#b0384a]",
            className
          )}
          {...props}
        />
        {description && !error && (
          <p id={descId} className="text-xs text-[#5f5b54]">
            {description}
          </p>
        )}
        {error && (
          <p id={errId} role="alert" className="text-xs font-medium text-[#b0384a]">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
