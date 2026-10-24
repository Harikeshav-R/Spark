import React from "react";
import { notFound } from "next/navigation";
import { uuidSchema } from "@/contracts/common";
import { AppShell } from "@/components/ui/app-shell";
import { SignInPrompt } from "@/features/auth/sign-in-prompt";

export default async function StudentPage(
  props: { params: Promise<{ studentId: string }> }
): Promise<React.JSX.Element> {
  const { studentId } = await props.params;

  const parsed = uuidSchema.safeParse(studentId);
  if (!parsed.success) {
    notFound();
  }

  return (
    <AppShell
      title="Student workspace"
      description="Access your courses, explore the knowledge graph, and practice with Socratic tutoring."
      workspace="student"
      breadcrumbs={[
        { label: "Home", href: "/" },
        { label: "Student workspace", href: `/student/${studentId}` },
      ]}
    >
      <SignInPrompt />
    </AppShell>
  );
}
