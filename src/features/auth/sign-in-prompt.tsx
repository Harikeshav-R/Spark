import React from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export function SignInPrompt(): React.JSX.Element {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle as="h2">Sign in to continue</CardTitle>
        <CardDescription>
          This workspace requires authentication. Sign in to access your courses, live lecture sessions, and mastery progress.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/#sign-in"
          className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-md bg-[var(--color-fg-default)] text-[var(--color-bg-canvas)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-color)] focus:ring-offset-2 transition-opacity"
        >
          Go to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
