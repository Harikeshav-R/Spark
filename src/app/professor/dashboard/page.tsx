import React from "react";
import { AppShell } from "@/components/ui/app-shell";
import { TeacherLectureDashboard } from "@/features/professor/teacher-lecture-dashboard";
import { uuidSchema } from "@/contracts/common";

export default async function ProfessorDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const resolvedParams = await searchParams;
  const rawCourseId = resolvedParams?.courseId;
  const rawLectureId = resolvedParams?.lectureId;

  // Course parameter presence check
  if (!rawCourseId) {
    return (
      <AppShell
        title="Instructor workspace"
        description="Manage courses, monitor student progress across knowledge graphs, and run interactive lectures."
        workspace="teacher"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Instructor workspace", href: "/professor/dashboard" },
        ]}
      >
        <div
          role="status"
          className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-panel)] p-6 text-[var(--color-fg-default)]"
        >
          <p className="font-medium text-[var(--color-fg-default)] mb-2">
            Select a course to start or resume a lecture.
          </p>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Pass a valid course identifier in the URL query parameters (e.g. <code>?courseId=&lt;id&gt;</code>) to access lecture controls.
          </p>
        </div>
      </AppShell>
    );
  }

  // Course parameter validity check (must be a single valid UUID)
  const courseIdCandidate = typeof rawCourseId === "string" ? rawCourseId : undefined;
  const parsedCourseId = courseIdCandidate ? uuidSchema.safeParse(courseIdCandidate) : null;
  if (!parsedCourseId || !parsedCourseId.success) {
    return (
      <AppShell
        title="Instructor workspace"
        description="Manage courses, monitor student progress across knowledge graphs, and run interactive lectures."
        workspace="teacher"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Instructor workspace", href: "/professor/dashboard" },
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
          title="Instructor workspace"
          description="Manage courses, monitor student progress across knowledge graphs, and run interactive lectures."
          workspace="teacher"
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Instructor workspace", href: "/professor/dashboard" },
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
    <TeacherLectureDashboard
      courseId={parsedCourseId.data}
      lectureId={lectureId}
    />
  );
}
