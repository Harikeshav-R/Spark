import React from "react";
import "./globals.css";
import { DemoToolbar } from "../components/demo/demo-toolbar";
export const metadata = {
  title: "Spark",
  description: "Interactive classroom learning platform with knowledge graphs, real-time presence, and adaptive practice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  const isDemo = process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true";

  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-bg-canvas)] text-[var(--color-fg-default)] font-sans antialiased flex flex-col">
        {isDemo && <DemoToolbar />}
        {children}
      </body>
    </html>
  );
}
