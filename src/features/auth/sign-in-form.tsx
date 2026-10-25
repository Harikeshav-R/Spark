"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { setRuntimeSession } from "@/lib/client/session";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: "teacher" | "student";
  teacherId?: string;
  enrollments?: Array<{
    studentId: string;
    courseId: string;
    courseName: string;
  }>;
}

export interface SignInFormProps {
  onSuccess?: (user: UserProfile) => void;
  className?: string;
}

export function SignInForm({
  onSuccess,
  className = "",
}: SignInFormProps): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!loginRes.ok) {
        const errorJson = (await loginRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errorJson?.message || "Invalid credentials. Please try again.");
      }

      const loginData = (await loginRes.json()) as {
        user: { id: string; email: string; name: string; role: "teacher" | "student" };
        session: { accessToken: string; expiresAt: number };
      };

      setRuntimeSession(loginData.session);

      // Read authoritative profile from /api/auth/me
      const meRes = await fetch("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${loginData.session.accessToken}`,
        },
      });

      let profile: UserProfile = {
        id: loginData.user.id,
        email: loginData.user.email,
        name: loginData.user.name,
        role: loginData.user.role,
      };

      if (meRes.ok) {
        const meData = (await meRes.json()) as UserProfile;
        profile = meData;
      }

      if (onSuccess) {
        onSuccess(profile);
      } else {
        // Default navigation based on role
        if (profile.role === "teacher") {
          window.location.href = "/professor/dashboard";
        } else if (profile.enrollments && profile.enrollments.length > 0) {
          const first = profile.enrollments[0];
          window.location.href = `/student/${first.studentId}?courseId=${first.courseId}`;
        } else {
          window.location.reload();
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`space-y-4 max-w-md ${className}`}
      data-testid="sign-in-form"
    >
      {error && (
        <div
          role="alert"
          className="p-3 text-sm rounded-md bg-[var(--color-bg-danger-soft,#f8e0e3)] text-[var(--color-border-danger,#b0384a)] border border-[var(--color-border-danger,#b0384a)]"
        >
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="auth-email"
          className="block text-sm font-medium text-[var(--color-fg-default)] mb-1"
        >
          Email address
        </label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@university.edu"
          className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] text-[var(--color-fg-default)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-color)]"
        />
      </div>

      <div>
        <label
          htmlFor="auth-password"
          className="block text-sm font-medium text-[var(--color-fg-default)] mb-1"
        >
          Password
        </label>
        <input
          id="auth-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] text-[var(--color-fg-default)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-color)]"
        />
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="w-full min-h-[44px] justify-center bg-[var(--color-fg-default)] text-[var(--color-bg-canvas)] hover:opacity-90 transition-opacity"
      >
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
