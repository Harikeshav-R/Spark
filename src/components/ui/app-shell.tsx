import React from "react";
import Link from "next/link";
import { Badge } from "./badge";

export interface AppShellProps {
  title: string;
  description: string;
  workspace?: "teacher" | "student";
  breadcrumbs: readonly { label: string; href?: string }[];
  children: React.ReactNode;
  sessionStatus?: "anonymous" | "authenticated";
  headerActions?: React.ReactNode;
}

export function AppShell({
  title,
  description,
  workspace,
  breadcrumbs,
  children,
  sessionStatus = "anonymous",
  headerActions,
}: AppShellProps): React.JSX.Element {
  const studentHref =
    breadcrumbs.find((b) => b.label === "Student workspace")?.href ||
    (workspace === "student" && breadcrumbs.length > 0
      ? breadcrumbs[breadcrumbs.length - 1]?.href
      : undefined);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg-canvas)] text-[var(--color-fg-default)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--color-bg-canvas,#faf6ee)] focus:text-[var(--color-ink,#2b2a2e)] focus:border focus:border-[var(--color-border-default,#e6d8bd)] focus:shadow-md focus:rounded-md focus:font-medium focus:ring-2 focus:ring-[var(--color-orange,#ed793c)]"
      >
        Skip to main content
      </a>
      <header className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)]">
        <div className="mx-auto max-w-[80rem] px-4 md:px-6 lg:px-8 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-6">
          <div className="flex items-center">
            <Link
              href="/"
              className="text-xl font-bold tracking-tight text-[var(--color-fg-default)] inline-flex items-center min-h-[44px] hover:opacity-80 transition-opacity"
            >
              Spark
            </Link>
          </div>
          <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-1 sm:gap-2">
            <Link
              href="/"
              aria-current={!workspace ? "page" : undefined}
              className={`inline-flex items-center min-h-[44px] px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                !workspace
                  ? "text-[var(--color-fg-default)] font-semibold underline underline-offset-4 decoration-2"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)] hover:underline"
              }`}
            >
              Home
            </Link>
            <Link
              href="/professor/dashboard"
              aria-current={workspace === "teacher" ? "page" : undefined}
              className={`inline-flex items-center min-h-[44px] px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                workspace === "teacher"
                  ? "text-[var(--color-fg-default)] font-semibold underline underline-offset-4 decoration-2"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)] hover:underline"
              }`}
            >
              Instructor workspace
            </Link>
            {workspace === "student" && studentHref && (
              <Link
                href={studentHref}
                aria-current="page"
                className="inline-flex items-center min-h-[44px] px-3 py-2 text-sm font-semibold rounded-md text-[var(--color-fg-default)] underline underline-offset-4 decoration-2 transition-colors"
              >
                Student workspace
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[80rem] w-full px-4 md:px-6 lg:px-8 py-6 sm:py-8 lg:py-10 flex-1 focus:outline-none"
      >
        {breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-4 sm:mb-6">
            <ol className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-muted)] min-w-0">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <React.Fragment key={`${crumb.label}-${index}`}>
                    {isLast ? (
                      <li
                        aria-current="page"
                        className="inline-flex items-center font-medium text-[var(--color-fg-default)] min-h-[44px] truncate"
                      >
                        {crumb.label}
                      </li>
                    ) : (
                      <li className="inline-flex items-center gap-2">
                        <Link
                          href={crumb.href || "#"}
                          className="hover:underline text-[var(--color-fg-muted)] inline-flex items-center min-h-[44px]"
                        >
                          {crumb.label}
                        </Link>
                        <span
                          aria-hidden="true"
                          className="select-none text-[var(--color-fg-muted)] opacity-60"
                        >
                          /
                        </span>
                      </li>
                    )}
                  </React.Fragment>
                );
              })}
            </ol>
          </nav>
        )}

        {workspace && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="secondary">
              {workspace === "teacher" ? "Instructor workspace" : "Student workspace"}
            </Badge>
            <Badge variant="outline">
              {sessionStatus === "authenticated" ? "Signed in" : "Not signed in"}
            </Badge>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8">
          <div className="space-y-3 max-w-[65ch]">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[var(--color-fg-default)] leading-[1.2] break-words min-w-0">
              {title}
            </h1>
            <p className="text-base sm:text-lg text-[var(--color-fg-muted)] leading-relaxed">
              {description}
            </p>
          </div>
          {headerActions && (
            <div className="shrink-0 self-start md:self-center" data-testid="app-shell-header-actions">
              {headerActions}
            </div>
          )}
        </div>

        <div>{children}</div>
      </main>

      <footer className="mt-auto border-t border-[var(--color-border-default)] py-6 bg-[var(--color-bg-canvas)]">
        <div className="mx-auto max-w-[80rem] px-4 md:px-6 lg:px-8 text-sm text-[var(--color-fg-muted)]">
          Spark &mdash; Interactive Classroom Learning
        </div>
      </footer>
    </div>
  );
}
