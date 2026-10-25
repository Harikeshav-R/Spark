"use client";

import React, { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { StudentPollState } from "./student-lecture-state";
import {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter,
  ModalCloseButton,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { EvaluationCard } from "./evaluation-card";

export interface ActivePollModalProps {
  poll: StudentPollState;
  conceptLabel: string;
  skyBrightness: number;
  canSubmit: boolean;
  onAnswerChange: (answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function ActivePollModal({
  poll,
  conceptLabel,
  skyBrightness,
  canSubmit,
  onAnswerChange,
  onSubmit,
  onClose,
}: ActivePollModalProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const continueButtonRef = useRef<HTMLButtonElement | null>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  const shouldReduceMotion = useReducedMotion();
  const isSubmitting = poll.submission.status === "submitting";
  const isEvaluated = poll.submission.status === "evaluated";
  const isError = poll.submission.status === "error";

  // Capture prior focus when modal becomes open
  useEffect(() => {
    if (poll.isOpen && poll.question && typeof document !== "undefined") {
      priorFocusRef.current = document.activeElement as HTMLElement | null;
    }
  }, [poll.isOpen, Boolean(poll.question)]);

  // Restore prior focus on close or unmount
  useEffect(() => {
    return () => {
      if (priorFocusRef.current && typeof document !== "undefined") {
        if (document.contains(priorFocusRef.current)) {
          priorFocusRef.current.focus();
        } else {
          const fallback = document.getElementById("workspace-poll-status-heading");
          if (fallback) {
            fallback.setAttribute("tabindex", "-1");
            fallback.focus();
          }
        }
      }
    };
  }, []);

  // Body scroll lock
  useEffect(() => {
    if (!poll.isOpen || !poll.question) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [poll.isOpen, Boolean(poll.question)]);

  // Focus placement on mount or status change
  useEffect(() => {
    if (!poll.isOpen || !poll.question) return;

    const timer = setTimeout(() => {
      if (poll.submission.status === "evaluated") {
        continueButtonRef.current?.focus();
      } else if (poll.submission.status === "idle") {
        textareaRef.current?.focus();
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [poll.isOpen, poll.submission.status, Boolean(poll.question)]);

  // Focus containment (trap focus inside containerRef)
  useEffect(() => {
    if (!poll.isOpen || !poll.question) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !containerRef.current) return;

      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        const focusable = containerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [poll.isOpen, Boolean(poll.question), poll.submission.status]);

  if (!poll.isOpen || !poll.question) {
    return null;
  }

  const initialAnim = shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 };
  const animateAnim = shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 };
  const transitionAnim = { duration: 0.2, ease: "easeOut" as const };

  return (
    <Modal
      isOpen={poll.isOpen}
      onClose={isSubmitting ? () => {} : onClose}
      titleId="active-poll-modal-title"
      descriptionId="active-poll-modal-desc"
      className="max-h-[90dvh] overflow-y-auto overscroll-contain flex flex-col p-4 sm:p-6"
    >
      <div ref={containerRef}>
        <motion.div
          initial={initialAnim}
          animate={animateAnim}
          transition={transitionAnim}
          className="flex flex-col space-y-4"
        >
          <ModalHeader className="relative pr-8 pb-2">
            {!isSubmitting && <ModalCloseButton onClose={onClose} />}
            <ModalTitle id="active-poll-modal-title" className="text-xl font-bold text-[#2b2a2e]">
              Lecture poll
            </ModalTitle>
            <ModalDescription id="active-poll-modal-desc" className="text-sm text-[#5f5b54]">
              {conceptLabel}
            </ModalDescription>
          </ModalHeader>

          <ModalContent className="space-y-4 py-0">
            <div className="rounded-lg bg-[#faf6ee] border border-[#e6d8bd] p-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#5f5b54] block mb-1">
                Question
              </span>
              <p className="text-base font-medium leading-relaxed text-[#2b2a2e] break-words">
                {poll.question.question}
              </p>
            </div>

            {isEvaluated && poll.submission.status === "evaluated" ? (
              <EvaluationCard
                result={poll.submission.result}
                conceptLabel={conceptLabel}
                skyBrightness={skyBrightness}
              />
            ) : (
              <div className="space-y-2">
                <label
                  htmlFor="student-poll-answer"
                  className="block text-sm font-semibold text-[#2b2a2e]"
                >
                  Your answer
                </label>
                <textarea
                  id="student-poll-answer"
                  ref={textareaRef}
                  value={poll.answer}
                  onChange={(e) => onAnswerChange(e.target.value)}
                  disabled={isSubmitting || isError}
                  rows={4}
                  placeholder="Type your explanation or answer here…"
                  className="w-full rounded-lg border border-[#3a3a3d] bg-white p-3 text-base leading-relaxed text-[#2b2a2e] placeholder:text-[#5f5b54] focus:outline-none focus:ring-2 focus:ring-[#ed793c] disabled:opacity-60 disabled:cursor-not-allowed resize-y min-h-[120px] break-words"
                />

                {isSubmitting && (
                  <div
                    role="status"
                    className="flex items-center gap-2 text-xs font-medium text-[#5f5b54] py-1"
                  >
                    <span>Evaluating your answer…</span>
                  </div>
                )}

                {isError && poll.submission.status === "error" && (
                  <div
                    role="alert"
                    className="rounded-lg border border-[#b0384a] bg-[#f8e0e3] p-3 text-sm text-[#2b2a2e]"
                  >
                    <p className="font-semibold text-[#b0384a] mb-0.5">Poll submission error</p>
                    <p className="text-xs leading-relaxed">{poll.submission.message}</p>
                  </div>
                )}
              </div>
            )}
          </ModalContent>

          <ModalFooter className="pt-2">
            {isEvaluated ? (
              <Button
                ref={continueButtonRef}
                onClick={onClose}
                className="w-full sm:w-auto min-h-[44px] font-semibold"
              >
                Continue lecture
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto min-h-[44px]"
                >
                  {isError ? "Dismiss" : "Close"}
                </Button>
                {!isError && (
                  <Button
                    onClick={onSubmit}
                    disabled={!canSubmit || isSubmitting}
                    isLoading={isSubmitting}
                    className="w-full sm:w-auto min-h-[44px] font-semibold"
                  >
                    {isSubmitting ? "Evaluating…" : "Submit answer"}
                  </Button>
                )}
              </>
            )}
          </ModalFooter>
        </motion.div>
      </div>
    </Modal>
  );
}
