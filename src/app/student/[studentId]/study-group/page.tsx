import React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { uuidSchema } from "@/contracts/common";
import { AppShell } from "@/components/ui/app-shell";
import { StudyGroupWorkspace } from "@/features/student/study-group-workspace";

export interface StudentStudyGroupPageProps {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function StudentStudyGroupPage(
  props: StudentStudyGroupPageProps
): Promise<React.JSX.Element> {
  const { studentId } = await props.params;

  const parsedStudentId = uuidSchema.safeParse(studentId);
  if (!parsedStudentId.success) {
    notFound();
  }

  const resolvedSearchParams = props.searchParams ? await props.searchParams : {};
  const rawCourseId = resolvedSearchParams?.courseId;

  // 1. Missing courseId: course-selection guidance without collaboration
  if (!rawCourseId) {
    return (
      <AppShell
        title="Peer study group"
        description="Collaborate with peers, schedule mutual study sessions, and tackle party quests."
        workspace="student"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Student workspace", href: `/student/${parsedStudentId.data}` },
          { label: "Peer study group", href: `/student/${parsedStudentId.data}/study-group` },
        ]}
      >
        <div className="max-w-xl mx-auto p-6 rounded-xl border border-[#e6d8bd] bg-white shadow-xs space-y-3">
          <h3 className="font-bold text-base text-[#2b2a2e]">Select a Course</h3>
          <p className="text-sm text-[#5f5b54]">
            Please choose a course from your student workspace before joining a study group.
          </p>
          <Link
            href={`/student/${parsedStudentId.data}`}
            className="inline-flex items-center text-sm font-medium text-[#ed793c] hover:underline"
          >
            ← Return to Student Workspace
          </Link>
        </div>
      </AppShell>
    );
  }

  // 2. Malformed, empty, or repeated courseId: invalid-course alert
  const courseIdCandidate =
    typeof rawCourseId === "string" ? rawCourseId.trim() : undefined;
  const parsedCourseId = courseIdCandidate
    ? uuidSchema.safeParse(courseIdCandidate)
    : null;

  if (!parsedCourseId || !parsedCourseId.success) {
    return (
      <AppShell
        title="Peer study group"
        description="Collaborate with peers, schedule mutual study sessions, and tackle party quests."
        workspace="student"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Student workspace", href: `/student/${parsedStudentId.data}` },
          { label: "Peer study group", href: `/student/${parsedStudentId.data}/study-group` },
        ]}
      >
        <div
          role="alert"
          className="max-w-xl mx-auto p-6 rounded-xl border border-[#e2a898] bg-[#fbf2ef] text-[#8a2414] shadow-xs space-y-2"
        >
          <h3 className="font-bold text-base">Invalid Course Parameter</h3>
          <p className="text-sm">
            The course identifier provided is invalid or malformed.
          </p>
          <Link
            href={`/student/${parsedStudentId.data}`}
            className="inline-flex items-center text-sm font-medium text-[#8a2414] underline"
          >
            ← Return to Student Workspace
          </Link>
        </div>
      </AppShell>
    );
  }

  // 3. Single valid UUID: mount keyed StudyGroupWorkspace
  const validCourseId = parsedCourseId.data;
  return (
    <AppShell
      title="Peer study group"
      description="Collaborate with peers, schedule mutual study sessions, and tackle party quests."
      workspace="student"
      breadcrumbs={[
        { label: "Home", href: "/" },
        {
          label: "Student workspace",
          href: `/student/${parsedStudentId.data}?courseId=${validCourseId}`,
        },
        {
          label: "Peer study group",
          href: `/student/${parsedStudentId.data}/study-group?courseId=${validCourseId}`,
        },
      ]}
    >
      <StudyGroupWorkspace
        key={`${parsedStudentId.data}-${validCourseId}`}
        studentId={parsedStudentId.data}
        courseId={validCourseId}
      />
    </AppShell>
  );
}
