"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface FeatureErrorNoticeProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function FeatureErrorNotice({
  message,
  onRetry,
  className = "",
}: FeatureErrorNoticeProps): React.JSX.Element {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-[#e2a898] bg-[#fbf2ef] p-4 text-[#8a2414] shadow-xs ${className}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <span className="font-semibold text-sm" aria-hidden="true">
            ⚠
          </span>
          <p className="text-sm font-medium leading-relaxed">{message}</p>
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="self-start sm:self-auto border-[#d98b77] bg-white text-[#8a2414] hover:bg-[#f5e4e0]"
          >
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

export interface FeatureErrorBoundaryProps {
  children?: ReactNode;
  resetKey: string;
}

interface FeatureErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  remountKey: number;
}

export class FeatureErrorBoundary extends Component<
  FeatureErrorBoundaryProps,
  FeatureErrorBoundaryState
> {
  public override state: FeatureErrorBoundaryState = {
    hasError: false,
    error: null,
    remountKey: 0,
  };

  public static getDerivedStateFromError(error: Error): Partial<FeatureErrorBoundaryState> {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    // Log contextual diagnostics without leaking tokens or private data
    console.error("[FeatureErrorBoundary] Caught render error:", error.name, error.message);
  }

  public override componentDidUpdate(prevProps: FeatureErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleRetry = (): void => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      remountKey: prev.remountKey + 1,
    }));
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      const message =
        this.state.error?.message || "An unexpected error occurred while displaying this feature.";
      return (
        <FeatureErrorNotice
          message={message}
          onRetry={this.handleRetry}
          className="m-4"
        />
      );
    }

    return (
      <React.Fragment key={this.state.remountKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
