import React from "react";
import { notFound } from "next/navigation";
import { uuidSchema } from "@/contracts/common";
import { AppShell } from "@/components/ui/app-shell";
import { TutorFeature } from "@/features/tutor/tutor-feature";

export interface StudentTutorPageProps {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function StudentTutorPage(
  props: StudentTutorPageProps
): Promise<React.JSX.Element> {
  const { studentId } = await props.params;

  // Validate student identifier invariant
  const parsedStudentId = uuidSchema.safeParse(studentId);
  if (!parsedStudentId.success) {
    notFound();
  }

  const resolvedSearchParams = props.searchParams ? await props.searchParams : {};
  const rawCourseId = resolvedSearchParams?.courseId;
  const courseIdCandidate = typeof rawCourseId === "string" ? rawCourseId : undefined;
  const parsedCourseId = courseIdCandidate ? uuidSchema.safeParse(courseIdCandidate) : null;
  const courseId = parsedCourseId && parsedCourseId.success ? parsedCourseId.data : undefined;

  const rawConceptId = resolvedSearchParams?.conceptId;
  const conceptIdCandidate = typeof rawConceptId === "string" ? rawConceptId : undefined;
  const parsedConceptId = conceptIdCandidate ? uuidSchema.safeParse(conceptIdCandidate) : null;
  const initialConceptId = parsedConceptId && parsedConceptId.success ? parsedConceptId.data : undefined;

  const rawSessionId = resolvedSearchParams?.sessionId;
  const sessionIdCandidate = typeof rawSessionId === "string" ? rawSessionId : undefined;
  const parsedSessionId = sessionIdCandidate ? uuidSchema.safeParse(sessionIdCandidate) : null;
  const sessionId = parsedSessionId && parsedSessionId.success ? parsedSessionId.data : undefined;

  const studentWorkspaceHref = `/student/${parsedStudentId.data}${
    courseId ? `?courseId=${courseId}` : ""
  }`;
  const tutorHref = `/student/${parsedStudentId.data}/tutor${
    courseId ? `?courseId=${courseId}` : ""
  }`;

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Student workspace", href: studentWorkspaceHref },
    {
      label: "Socratic Tutoring",
      href: tutorHref,
    },
  ];

  return (
    <AppShell
      title="Socratic Tutoring"
      description="Deepen your mathematical and intuitive mastery through interactive, step-by-step Socratic dialogue with Spark."
      workspace="student"
      breadcrumbs={breadcrumbs}
    >
      <TutorFeature
        studentId={parsedStudentId.data}
        courseId={courseId}
        initialConceptId={initialConceptId}
        sessionId={sessionId}
      />
    </AppShell>
  );
}
