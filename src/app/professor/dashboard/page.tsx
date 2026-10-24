import React from "react";
import { AppShell } from "@/components/ui/app-shell";
import { SignInPrompt } from "@/features/auth/sign-in-prompt";

export default function ProfessorDashboardPage(): React.JSX.Element {
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
      <SignInPrompt />
    </AppShell>
  );
}
