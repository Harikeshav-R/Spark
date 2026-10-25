import React from "react";
import { notFound } from "next/navigation";
import { uuidSchema } from "@/contracts/common";
import { AppShell } from "@/components/ui/app-shell";
import { StudentLectureView } from "@/features/student/student-lecture-view";
import { CourseEntry } from "@/features/courses/course-entry";

export interface StudentPageProps {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function StudentPage(
  props: StudentPageProps
): Promise<React.JSX.Element> {
  const { studentId } = await props.params;

  const parsedStudentId = uuidSchema.safeParse(studentId);
  if (!parsedStudentId.success) {
    notFound();
  }

  const resolvedParams = await props.searchParams;
  const rawCourseId = resolvedParams?.courseId;
  const rawLectureId = resolvedParams?.lectureId;

  // Course parameter presence check
  if (!rawCourseId) {
    return (
      <AppShell
        title="Student workspace"
        description="Access your courses, explore the knowledge graph, and practice with Socratic tutoring."
        workspace="student"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Student workspace", href: `/student/${parsedStudentId.data}` },
        ]}
      >
        <CourseEntry role="student" studentId={parsedStudentId.data} />
      </AppShell>
    );
  }

  // Course parameter validity check (must be a single valid UUID)
  const courseIdCandidate = typeof rawCourseId === "string" ? rawCourseId : undefined;
  const parsedCourseId = courseIdCandidate ? uuidSchema.safeParse(courseIdCandidate) : null;
  if (!parsedCourseId || !parsedCourseId.success) {
    return (
      <AppShell
        title="Student workspace"
        description="Access your courses, explore the knowledge graph, and practice with Socratic tutoring."
        workspace="student"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Student workspace", href: `/student/${parsedStudentId.data}` },
        ]}
      >
        <div
          role="alert"
          className="rounded-xl border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-danger-soft,#f8e0e3)] p-6 text-[var(--color-fg-default)]"
        >
          <p className="font-medium text-[var(--color-fg-default)] mb-2">
            Invalid course identifier.
          </p>
          <p className="text-sm text-[var(--color-fg-muted)]">
            The provided course identifier is malformed. Please provide a single valid UUID.
          </p>
        </div>
      </AppShell>
    );
  }

  // Optional lecture parameter validity check
  let lectureId: string | undefined = undefined;
  if (rawLectureId !== undefined) {
    const lectureIdCandidate = typeof rawLectureId === "string" ? rawLectureId : undefined;
    const parsedLectureId = lectureIdCandidate ? uuidSchema.safeParse(lectureIdCandidate) : null;
    if (!parsedLectureId || !parsedLectureId.success) {
      return (
        <AppShell
          title="Student workspace"
          description="Access your courses, explore the knowledge graph, and practice with Socratic tutoring."
          workspace="student"
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Student workspace", href: `/student/${parsedStudentId.data}` },
          ]}
        >
          <div
            role="alert"
            className="rounded-xl border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-danger-soft,#f8e0e3)] p-6 text-[var(--color-fg-default)]"
          >
            <p className="font-medium text-[var(--color-fg-default)] mb-2">
              Invalid lecture identifier.
            </p>
            <p className="text-sm text-[var(--color-fg-muted)]">
              The provided lecture identifier is malformed. Please provide a single valid UUID.
            </p>
          </div>
        </AppShell>
      );
    }
    lectureId = parsedLectureId.data;
  }

  return (
    <StudentLectureView
      key={`${parsedStudentId.data}-${parsedCourseId.data}-${lectureId ?? "default"}`}
      studentId={parsedStudentId.data}
      courseId={parsedCourseId.data}
      lectureId={lectureId}
    />
  );
}
