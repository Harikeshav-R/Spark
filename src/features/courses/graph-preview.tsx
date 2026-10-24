"use client";

import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface GraphPreviewConcept {
  label: string;
  description: string;
  category: string;
  difficulty: number;
}

export interface GraphPreviewProps {
  courseId: string;
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  concepts: GraphPreviewConcept[];
  edges: [string, string][];
}

export function GraphPreview({
  courseId: _courseId,
  totalPages,
  processedPages,
  truncated,
  concepts,
  edges,
}: GraphPreviewProps): React.JSX.Element {
  const categories = Array.from(new Set(concepts.map((c) => c.category)));
  const conceptsByCategory = categories.map((cat) => ({
    category: cat,
    items: concepts.filter((c) => c.category === cat),
  }));

  return (
    <div className="space-y-6">
      {/* Truncation warning banner */}
      {truncated && (
        <div
          role="alert"
          className="rounded-lg border border-[#cf951f] bg-[#fbeac2] px-4 py-3 text-sm text-[#2b2a2e] flex items-start gap-3 shadow-sm"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ⚠️
          </span>
          <p>
            <strong>Truncated extraction:</strong>{" "}
            {`This syllabus has ${totalPages} pages but only the first ${processedPages} were processed. Concepts from pages ${processedPages + 1}–${totalPages} are not included in the preview.`}
          </p>
        </div>
      )}

      {/* Summary header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle as="h2" className="text-lg">
            Knowledge Graph Preview
          </CardTitle>
          <CardDescription>
            {`${concepts.length} concepts extracted from ${processedPages} of ${totalPages} pages`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm text-[#5f5b54]">
          <Badge variant="outline">{`${concepts.length} concepts extracted`}</Badge>
          <Badge variant="outline">{`${edges.length} prerequisite edges`}</Badge>
        </CardContent>
      </Card>

      {/* Category-grouped concept cards */}
      <div className="space-y-8">
        {conceptsByCategory.map(({ category, items }) => (
          <section key={category} className="space-y-3">
            <h3 className="text-lg font-semibold text-[#2b2a2e] border-b border-[#e6d8bd] pb-2">
              {category}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((concept) => (
                <Card
                  key={concept.label}
                  className="flex flex-col justify-between"
                >
                  <CardHeader>
                    <CardTitle as="h4" className="text-base font-semibold">
                      {concept.label}
                    </CardTitle>
                    <CardDescription className="text-xs line-clamp-3">
                      {concept.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between pt-0 mt-auto">
                    <Badge variant="soft">{concept.category}</Badge>
                    <span
                      aria-label={`Difficulty ${concept.difficulty} of 5`}
                      className="font-mono text-sm tracking-wider text-[#5f5b54]"
                    >
                      {"●".repeat(concept.difficulty) +
                        "○".repeat(Math.max(0, 5 - concept.difficulty))}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Prerequisite relationships */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#2b2a2e]">
            Prerequisite relationships
          </h3>
          <Badge variant="outline">{`${edges.length} prerequisite edges`}</Badge>
        </div>
        <Card>
          <CardContent className="p-4">
            {edges.length === 0 ? (
              <p className="text-sm text-[#5f5b54]">
                No prerequisite relationships identified.
              </p>
            ) : (
              <ul className="divide-y divide-[#e6d8bd] max-h-96 overflow-y-auto">
                {edges.map(([source, target], idx) => (
                  <li
                    key={`${source}-${target}-${idx}`}
                    className="py-2 px-3 text-sm flex items-center gap-2 hover:bg-[#f4e9d7]/50 rounded transition-colors"
                  >
                    <span className="font-medium text-[#2b2a2e]">{source}</span>
                    <span
                      aria-label="is a prerequisite for"
                      className="text-[#ed793c] font-bold"
                    >
                      →
                    </span>
                    <span className="font-medium text-[#2b2a2e]">{target}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
