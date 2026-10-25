import React from "react";
import { notFound } from "next/navigation";
import { uuidSchema, type UUID } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import { AppShell } from "@/components/ui/app-shell";
import { LearningFeature } from "@/features/learning/learning-feature";

export interface ConceptPageProps {
  params: Promise<{ studentId: string; conceptId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConceptLearningPage(
  props: ConceptPageProps
): Promise<React.JSX.Element> {
  const { studentId, conceptId } = await props.params;

  // Validate student identifier invariant
  const parsedStudentId = uuidSchema.safeParse(studentId);
  if (!parsedStudentId.success) {
    notFound();
  }

  // Validate concept identifier invariant (INV-DAG / route boundary)
  const parsedConceptId = uuidSchema.safeParse(conceptId);
  if (!parsedConceptId.success) {
    notFound();
  }

  const resolvedSearchParams = props.searchParams ? await props.searchParams : {};
  const rawCourseId = resolvedSearchParams?.courseId;
  const courseIdCandidate = typeof rawCourseId === "string" ? rawCourseId : undefined;
  const parsedCourseId = courseIdCandidate ? uuidSchema.safeParse(courseIdCandidate) : null;
  const courseId = parsedCourseId && parsedCourseId.success ? parsedCourseId.data : undefined;

  // Construct initial concept metadata if provided via query parameters
  let initialConcept: ConceptNode | undefined = undefined;
  if (typeof resolvedSearchParams?.conceptLabel === "string") {
    const rawDifficulty = resolvedSearchParams?.difficulty;
    const parsedDifficulty =
      typeof rawDifficulty === "string" ? parseInt(rawDifficulty, 10) : 3;

    initialConcept = {
      id: parsedConceptId.data,
      courseId: courseId ?? ("00000000-0000-4000-8000-000000000000" as UUID),
      label: resolvedSearchParams.conceptLabel,
      description:
        typeof resolvedSearchParams?.conceptDescription === "string"
          ? resolvedSearchParams.conceptDescription
          : `Interactive curriculum learning guide and practice questions for ${resolvedSearchParams.conceptLabel}.`,
      category:
        typeof resolvedSearchParams?.category === "string"
          ? resolvedSearchParams.category
          : "Core Curriculum",
      difficulty: Number.isFinite(parsedDifficulty)
        ? Math.max(1, Math.min(5, parsedDifficulty))
        : 3,
      createdAt: new Date().toISOString(),
    };
  }

  const studentWorkspaceHref = `/student/${parsedStudentId.data}${
    courseId ? `?courseId=${courseId}` : ""
  }`;
  const conceptHref = `/student/${parsedStudentId.data}/concepts/${parsedConceptId.data}${
    courseId ? `?courseId=${courseId}` : ""
  }`;

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Student workspace", href: studentWorkspaceHref },
    {
      label: initialConcept?.label ?? "Concept learning",
      href: conceptHref,
    },
  ];

  return (
    <AppShell
      title={initialConcept?.label ?? "Concept Learning & Quiz"}
      description="Study core curriculum concepts with comprehensive guides, interactive practice quizzes, and academic resources."
      workspace="student"
      breadcrumbs={breadcrumbs}
    >
      <LearningFeature
        studentId={parsedStudentId.data}
        conceptId={parsedConceptId.data}
        courseId={courseId}
        initialConcept={initialConcept}
      />
    </AppShell>
  );
}
