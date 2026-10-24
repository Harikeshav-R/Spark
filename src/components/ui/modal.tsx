"use client";

import React, { useEffect, useId } from "react";
import { cn } from "../../lib/client/utils";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  className?: string;
  titleId?: string;
  descriptionId?: string;
}

export function Modal({
  isOpen,
  onClose,
  children,
  className,
  titleId,
  descriptionId,
}: ModalProps) {
  const generatedTitleId = useId();
  const generatedDescId = useId();

  const resolvedTitleId = titleId || generatedTitleId;
  const resolvedDescId = descriptionId || generatedDescId;

  // Handle Escape key to close dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Dialog surface */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        aria-describedby={resolvedDescId}
        className={cn(
          "relative z-10 w-full max-w-lg rounded-xl border border-[#e6d8bd] bg-[#fffdf8] text-[#2b2a2e] p-6 shadow-xl transition-opacity",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col space-y-1.5 pb-4", className)} {...props}>
      {children}
    </div>
  );
}

export function ModalTitle({
  id,
  className,
  children,
  as: Component = "h2",
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: "h1" | "h2" | "h3" }) {
  return (
    <Component
      id={id}
      className={cn("text-lg font-semibold leading-none tracking-tight text-[#2b2a2e]", className)}
      {...props}
    >
      {children}
    </Component>
  );
}

export function ModalDescription({
  id,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      id={id}
      className={cn("text-sm text-[#5f5b54]", className)}
      {...props}
    >
      {children}
    </p>
  );
}

export function ModalContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("py-2", className)} {...props}>
      {children}
    </div>
  );
}

export function ModalFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModalCloseButton({
  onClose,
  className,
  }: {
  onClose: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className={cn(
        "absolute right-4 top-4 rounded-sm p-1 text-[#5f5b54] hover:text-[#2b2a2e] focus:outline-none focus:ring-2 focus:ring-[#2b2a2e]",
        className
      )}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </button>
  );
}
