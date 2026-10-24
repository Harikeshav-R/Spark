import React from "react";
import { AppShell } from "@/components/ui/app-shell";
import { SyllabusUpload } from "@/features/courses/syllabus-upload";

export default function ProfessorUploadPage(): React.JSX.Element {
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
      <SyllabusUpload />
    </AppShell>
  );
}
