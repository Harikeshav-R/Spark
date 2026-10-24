"use client";

import React, { useState, useRef } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from "@/components/ui/modal";
import { z } from "zod";
import { GraphPreview, type GraphPreviewConcept } from "./graph-preview";
import { uuidSchema } from "@/contracts/common";
import { apiErrorSchema } from "@/contracts/errors";

const rawConceptSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
  category: z.string(),
  difficulty: z.number().int().min(1).max(5),
});

const rawEdgeSchema = z.tuple([z.string().min(1), z.string().min(1)]);

const syllabusPreviewSchema = z.object({
  concepts: z.array(rawConceptSchema).min(1).max(40),
  edges: z.array(rawEdgeSchema),
});

export const syllabusUploadPreviewResponseSchema = z.object({
  courseId: uuidSchema,
  totalPages: z.number().int().nonnegative(),
  processedPages: z.number().int().nonnegative(),
  truncated: z.boolean(),
  preview: syllabusPreviewSchema,
});

export type UploadState =
  | "idle"
  | "uploading"
  | "preview"
  | "committing"
  | "committed"
  | "error";

export interface SyllabusPreviewData {
  courseId: string;
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  concepts: GraphPreviewConcept[];
  edges: [string, string][];
}

export interface CommittedResult {
  nodeCount: number;
  edgeCount: number;
}

export interface CommitSectionProps {
  conceptCount: number;
  isCommitting: boolean;
  onCommit: () => void;
}

export function CommitSection({
  conceptCount,
  isCommitting,
  onCommit,
}: CommitSectionProps): React.JSX.Element {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-[#e6d8bd] pt-6 mt-6">
      <p className="text-sm text-[#5f5b54]">
        Review the extracted concepts above, then confirm to save this graph.
        This action cannot be undone.
      </p>
      <Button
        onClick={onCommit}
        isLoading={isCommitting}
        size="lg"
        disabled={isCommitting}
      >
        {isCommitting
          ? "Committing graph…"
          : `Confirm graph (${conceptCount} concepts)`}
      </Button>
    </div>
  );
}

function getErrorMessage(status: number, errorData: unknown): string {
  const parsed = apiErrorSchema.safeParse(errorData);
  const code = parsed.success ? parsed.data.error.code : "";
  const serverMsg = parsed.success ? parsed.data.error.message : "";

  if (status === 409 || code === "CONFLICT" || code === "GRAPH_ALREADY_EXISTS") {
    return "A knowledge graph has already been committed for this course. To start fresh, create a new course.";
  }
  if (
    status === 422 ||
    code === "UNPROCESSABLE_ENTITY" ||
    code === "VALIDATION_ERROR"
  ) {
    return "The extracted graph contains a cycle or invalid structure and cannot be committed.";
  }
  if (status === 413 || code === "PAYLOAD_TOO_LARGE") {
    return "File exceeds the 50 MiB maximum size.";
  }
  if (serverMsg) {
    return serverMsg;
  }
  return "An unexpected error occurred. Please try again.";
}

export function SyllabusUpload(): React.JSX.Element {
  const [state, setState] = useState<UploadState>("idle");
  // TODO: wire from route params/auth once course context is available
  const [courseId, setCourseId] = useState<string>(
    "11111111-1111-4111-8111-111111111111"
  );
  const [previewData, setPreviewData] = useState<SyllabusPreviewData | null>(
    null
  );
  const [committedResult, setCommittedResult] =
    useState<CommittedResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetToIdle = () => {
    setState("idle");
    setErrorMessage("");
  };

  const processFile = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      setErrorMessage("File exceeds the 50 MiB maximum size.");
      setState("error");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setErrorMessage("Only PDF files are supported.");
      setState("error");
      return;
    }

    setState("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseId)}/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!res.ok) {
        let errBody: unknown;
        try {
          errBody = await res.json();
        } catch {
          errBody = null;
        }
        setErrorMessage(getErrorMessage(res.status, errBody));
        setState("error");
        return;
      }

      const data = await res.json();
      const parsed = syllabusUploadPreviewResponseSchema.safeParse(data);
      if (!parsed.success) {
        setErrorMessage("Invalid server response");
        setState("error");
        return;
      }

      setPreviewData({
        courseId: parsed.data.courseId,
        totalPages: parsed.data.totalPages,
        processedPages: parsed.data.processedPages,
        truncated: parsed.data.truncated,
        concepts: parsed.data.preview.concepts,
        edges: parsed.data.preview.edges as [string, string][],
      });
      setState("preview");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred. Please try again."
      );
      setState("error");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const handleCommit = async () => {
    if (!previewData) return;
    setState("committing");
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(previewData.courseId)}/graph`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodes: previewData.concepts,
            edges: previewData.edges,
          }),
        }
      );

      if (!res.ok) {
        let errBody: unknown;
        try {
          errBody = await res.json();
        } catch {
          errBody = null;
        }
        setErrorMessage(getErrorMessage(res.status, errBody));
        setState("error");
        return;
      }

      const data = await res.json();
      setCommittedResult({
        nodeCount:
          typeof data?.nodeCount === "number"
            ? data.nodeCount
            : previewData.concepts.length,
        edgeCount:
          typeof data?.edgeCount === "number"
            ? data.edgeCount
            : previewData.edges.length,
      });
      setState("committed");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred. Please try again."
      );
      setState("error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Idle state */}
      {state === "idle" && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Upload course syllabus</CardTitle>
            <CardDescription>
              Select a PDF syllabus (max 50 MiB) to extract concepts and
              prerequisite relationships for your course.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Input
              label="Course ID"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              description="Target course identifier (will be derived automatically once course context is wired)"
            />

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                isDragging
                  ? "border-[#ed793c] bg-[#f4e9d7]/30"
                  : "border-[#e6d8bd] bg-[#fffdf8] hover:border-[#ed793c]"
              }`}
            >
              <label
                htmlFor="syllabus-file-input"
                className="flex flex-col items-center justify-center cursor-pointer space-y-4"
              >
                <span
                  aria-hidden="true"
                  className="text-4xl text-[#5f5b54]"
                >
                  📄
                </span>
                <span className="text-base font-medium text-[#2b2a2e]">
                  Drop PDF here or click to browse
                </span>
                <span className="text-xs text-[#5f5b54]">
                  PDF files up to 50 MiB
                </span>
                <input
                  ref={fileInputRef}
                  id="syllabus-file-input"
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  onChange={handleFileChange}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file
                </Button>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Uploading state */}
      {state === "uploading" && (
        <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <Button isLoading variant="secondary" disabled size="lg">
                Processing syllabus…
              </Button>
              <p className="text-sm text-[#5f5b54]">
                Extracting concepts and prerequisite relationships. This may take
                a moment.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview or Committing state */}
      {(state === "preview" || state === "committing") && previewData && (
        <div className="space-y-6">
          <GraphPreview
            courseId={previewData.courseId}
            totalPages={previewData.totalPages}
            processedPages={previewData.processedPages}
            truncated={previewData.truncated}
            concepts={previewData.concepts}
            edges={previewData.edges}
          />
          <CommitSection
            conceptCount={previewData.concepts.length}
            isCommitting={state === "committing"}
            onCommit={() => void handleCommit()}
          />
        </div>
      )}

      {/* Committed state */}
      {state === "committed" && committedResult && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Knowledge graph committed</CardTitle>
            <CardDescription>
              {committedResult.nodeCount} concepts and{" "}
              {committedResult.edgeCount} prerequisite edges saved.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <a href="/professor/dashboard">
              <Button variant="secondary">Back to instructor workspace</Button>
            </a>
          </CardFooter>
        </Card>
      )}

      {/* Error modal */}
      {state === "error" && (
        <Modal isOpen={true} onClose={resetToIdle}>
          <ModalHeader>
            <ModalTitle>Error</ModalTitle>
            <ModalDescription>{errorMessage}</ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button onClick={resetToIdle}>Dismiss</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
