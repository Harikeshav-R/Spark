import React from "react";
import { AppShell } from "@/components/ui/app-shell";
import { SyllabusUpload } from "@/features/courses/syllabus-upload";
import { uuidSchema } from "@/contracts/common";

export default async function ProfessorUploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const resolvedParams = await searchParams;
  const rawCourseId = resolvedParams?.courseId;
  const courseIdCandidate = typeof rawCourseId === "string" ? rawCourseId : undefined;
  const parsedCourseId = courseIdCandidate ? uuidSchema.safeParse(courseIdCandidate) : null;
  const courseId = parsedCourseId && parsedCourseId.success ? parsedCourseId.data : null;

  if (!courseId) {
    return (
      <AppShell
        title="Upload syllabus"
        description="Upload a PDF course syllabus to extract a prerequisite knowledge graph for your course."
        workspace="teacher"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Instructor workspace", href: "/professor/dashboard" },
          { label: "Upload syllabus", href: "/professor/upload" },
        ]}
      >
        <div
          role="alert"
          className="rounded-xl border border-[#e6d8bd] bg-[#fffdf8] p-6 text-[#2b2a2e]"
        >
          <p className="font-medium text-[#8b3d2b] mb-3">
            A valid course must be selected before uploading a syllabus.
          </p>
          <a
            href="/professor/dashboard"
            className="text-sm font-medium text-[#ed793c] hover:underline"
          >
            Back to instructor workspace
          </a>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Upload syllabus"
      description="Upload a PDF course syllabus to extract a prerequisite knowledge graph for your course."
      workspace="teacher"
      breadcrumbs={[
        { label: "Home", href: "/" },
        { label: "Instructor workspace", href: "/professor/dashboard" },
        { label: "Upload syllabus", href: `/professor/upload?courseId=${courseId}` },
      ]}
    >
      <SyllabusUpload key={courseId} courseId={courseId} />
    </AppShell>
  );
}
