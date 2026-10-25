import React from "react";
import { notFound } from "next/navigation";
import { uuidSchema } from "@/contracts/common";
import { AppShell } from "@/components/ui/app-shell";
import {
  LectureSummariesView,
  type LectureSummaryItem,
} from "@/features/student/lecture-summaries-view";

export interface StudentSummariesPageProps {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  initialSummaries?: LectureSummaryItem[] | null;
}

export default async function StudentSummariesPage(
  props: StudentSummariesPageProps
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

  const studentWorkspaceHref = `/student/${parsedStudentId.data}${
    courseId ? `?courseId=${courseId}` : ""
  }`;
  const summariesHref = `/student/${parsedStudentId.data}/summaries${
    courseId ? `?courseId=${courseId}` : ""
  }`;

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Student workspace", href: studentWorkspaceHref },
    {
      label: "Lecture summaries",
      href: summariesHref,
    },
  ];

  return (
    <AppShell
      title="Lecture Summaries"
      description="Chronological lecture notes, key concept takeaways, and timeline highlights from completed class sessions."
      workspace="student"
      breadcrumbs={breadcrumbs}
    >
      <LectureSummariesView
        studentId={parsedStudentId.data}
        courseId={courseId}
        initialSummaries={props.initialSummaries}
      />
    </AppShell>
  );
}
