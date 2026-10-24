import React from "react";
import "./globals.css";

export const metadata = {
  title: "Spark",
  description: "Interactive classroom learning platform with knowledge graphs, real-time presence, and adaptive practice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-bg-canvas)] text-[var(--color-fg-default)] font-sans antialiased flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--color-bg-canvas)] focus:text-[var(--color-fg-default)] focus:border-2 focus:border-[var(--focus-ring-color)] focus:rounded-md focus:shadow-md focus:outline-none"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
