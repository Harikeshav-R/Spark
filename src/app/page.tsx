import React from "react";
import Link from "next/link";
import { AppShell } from "@/components/ui/app-shell";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { SignInForm } from "@/features/auth/sign-in-form";

export default function HomePage(): React.JSX.Element {
  return (
    <AppShell
      title="Learning, connected."
      description="Spark connects live lectures, knowledge graph mastery tracking, and Socratic practice into one unified classroom workspace."
      breadcrumbs={[{ label: "Home" }]}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Instructors</CardTitle>
            <CardDescription>
              Launch real-time lecture sessions, track collective student mastery across topic graphs, and administer interactive polls.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/professor/dashboard"
              className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-md bg-[var(--color-fg-default)] text-[var(--color-bg-canvas)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-color)] focus:ring-offset-2 transition-opacity"
            >
              Enter instructor workspace
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Students</CardTitle>
            <CardDescription>
              Students join courses through a dedicated enrollment link provided by their instructor. Access your personal workspace using your unique course URL.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
              Check your course syllabus or invitation email for your direct student link to begin tracking your mastery and participating in lectures.
            </p>
          </CardContent>
        </Card>
      </div>

      <section id="sign-in" className="mt-8 border-t border-[var(--color-border-default)] pt-8">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle as="h2">Sign in to Spark</CardTitle>
            <CardDescription>
              Sign in with your university email to access live lectures, track topic mastery, and engage with Socratic practice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignInForm />
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
