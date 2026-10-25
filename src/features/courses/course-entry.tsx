"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { getAccessToken } from "@/lib/client/session";
import type { Course } from "@/contracts/course";

export interface CourseEntryProps {
  role: "teacher" | "student";
  studentId?: string;
  className?: string;
}

export function CourseEntry({
  role,
  studentId,
  className = "",
}: CourseEntryProps): React.JSX.Element {
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<
    Array<{ studentId: string; courseId: string; courseName: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Teacher course creation form
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseDesc, setNewCourseDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Student join code form
  const [joinCode, setJoinCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setError("Please sign in to view your courses.");
        setLoading(false);
        return;
      }

      if (role === "teacher") {
        const res = await fetch("/api/courses", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error("Failed to load courses.");
        }
        const data = (await res.json()) as Course[];
        setCourses(data);
      } else {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error("Failed to load student enrollments.");
        }
        const data = (await res.json()) as {
          enrollments?: Array<{ studentId: string; courseId: string; courseName: string }>;
        };
        setEnrollments(data.enrollments ?? []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load course information.");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourseName.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newCourseName.trim(),
          description: newCourseDesc.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errJson?.message || "Failed to create course.");
      }

      const created = (await res.json()) as Course;
      setCourses((prev) => [...prev, created]);
      setNewCourseName("");
      setNewCourseDesc("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Course creation failed.");
    } finally {
      setCreating(false);
    }
  };

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;

    setEnrolling(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/courses/enroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ joinCode: joinCode.trim().toUpperCase() }),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errJson?.message || "Failed to enroll with join code.");
      }

      const enrolled = (await res.json()) as {
        studentId: string;
        courseId: string;
        courseName: string;
      };

      setEnrollments((prev) => {
        const exists = prev.some((e) => e.courseId === enrolled.courseId);
        return exists ? prev : [...prev, enrolled];
      });
      setJoinCode("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enrollment failed.");
    } finally {
      setEnrolling(false);
    }
  };

  if (loading) {
    return (
      <div className={`p-6 text-center text-sm text-[var(--color-fg-muted)] ${className}`}>
        Loading courses…
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`} data-testid="course-entry">
      {error && (
        <div
          role="alert"
          className="p-3 text-sm rounded-md bg-[var(--color-bg-danger-soft,#f8e0e3)] text-[var(--color-border-danger,#b0384a)] border border-[var(--color-border-danger,#b0384a)]"
        >
          {error}
        </div>
      )}

      {role === "teacher" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Your Courses</CardTitle>
              <CardDescription>
                Select a course to manage lectures, upload syllabi, and track knowledge mastery.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {courses.length === 0 ? (
                <p className="text-sm text-[var(--color-fg-muted)]">
                  You have not created any courses yet. Use the form below to create your first course.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-border-default)]">
                  {courses.map((course) => (
                    <li
                      key={course.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <p className="font-semibold text-sm text-[var(--color-fg-default)]">
                          {course.name}
                        </p>
                        <p className="text-xs text-[var(--color-fg-muted)]">
                          Join code: <span className="font-mono font-bold">{course.joinCode}</span>
                          {course.description ? ` • ${course.description}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/professor/dashboard?courseId=${course.id}`}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md bg-[var(--color-cream,#f4e9d7)] text-[var(--color-ink,#2b2a2e)] border border-[var(--color-border-default,#e6d8bd)] hover:bg-[var(--color-border-default,#ecdcc0)] transition-colors"
                        >
                          Lecture Dashboard
                        </Link>
                        <Link
                          href={`/professor/upload?courseId=${course.id}`}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md bg-[var(--color-bg-panel)] text-[var(--color-fg-default)] border border-[var(--color-border-default)] hover:bg-[var(--color-bg-canvas)] transition-colors"
                        >
                          Upload Syllabus
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h3">Create New Course</CardTitle>
              <CardDescription>
                Create a new course workspace. An 8-character join code will be generated for student enrollment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateCourse} className="space-y-3 max-w-md">
                <div>
                  <label
                    htmlFor="course-name-input"
                    className="block text-xs font-medium text-[var(--color-fg-default)] mb-1"
                  >
                    Course Name
                  </label>
                  <input
                    id="course-name-input"
                    type="text"
                    required
                    value={newCourseName}
                    onChange={(e) => setNewCourseName(e.target.value)}
                    placeholder="e.g. CS229: Machine Learning"
                    className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] text-[var(--color-fg-default)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="course-desc-input"
                    className="block text-xs font-medium text-[var(--color-fg-default)] mb-1"
                  >
                    Description (optional)
                  </label>
                  <input
                    id="course-desc-input"
                    type="text"
                    value={newCourseDesc}
                    onChange={(e) => setNewCourseDesc(e.target.value)}
                    placeholder="Brief description of the course"
                    className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] text-[var(--color-fg-default)]"
                  />
                </div>
                <Button type="submit" disabled={creating} size="sm">
                  {creating ? "Creating…" : "Create Course"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Your Enrolled Courses</CardTitle>
              <CardDescription>
                Select a course to view real-time lectures, topic mastery, and quizzes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {enrollments.length === 0 ? (
                <p className="text-sm text-[var(--color-fg-muted)]">
                  You are not enrolled in any courses yet. Enter a join code below to enroll.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-border-default)]">
                  {enrollments.map((enr) => {
                    const activeStudentId = studentId || enr.studentId;
                    return (
                      <li
                        key={enr.courseId}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <p className="font-semibold text-sm text-[var(--color-fg-default)]">
                          {enr.courseName}
                        </p>
                        <Link
                          href={`/student/${activeStudentId}?courseId=${enr.courseId}`}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-md bg-[var(--color-cream,#f4e9d7)] text-[var(--color-ink,#2b2a2e)] border border-[var(--color-border-default,#e6d8bd)] hover:bg-[var(--color-border-default,#ecdcc0)] transition-colors self-start sm:self-center"
                        >
                          Enter Course Workspace
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h3">Enroll in a Course</CardTitle>
              <CardDescription>
                Enter the 8-character join code provided by your instructor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEnroll} className="flex flex-col gap-2 max-w-sm">
                <label
                  htmlFor="course-join-code"
                  className="text-sm font-medium text-[var(--color-ink,#2b2a2e)]"
                >
                  Course join code
                </label>
                <div className="flex gap-2 min-w-0">
                  <input
                    id="course-join-code"
                    name="joinCode"
                    type="text"
                    required
                    autoComplete="off"
                    maxLength={8}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="e.g. ABC12345"
                    className="flex-1 min-w-0 px-3 py-2 text-sm font-mono tracking-wider uppercase rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] text-[var(--color-fg-default)]"
                  />
                  <Button type="submit" disabled={enrolling} size="sm">
                    {enrolling ? "Enrolling…" : "Enroll"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
