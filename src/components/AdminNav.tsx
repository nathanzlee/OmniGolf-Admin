"use client";

import Link from "next/link";

export default function AdminNav({
  current,
}: {
  current: "courses" | "sessions" | "session-visualizer" | "script-testing";
}) {
  const base =
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors";
  const active =
    "bg-zinc-900 text-white shadow-sm";
  const inactive =
    "bg-white text-zinc-700 hover:bg-zinc-100 border border-zinc-200";

  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      <Link
        href="/courses"
        className={`${base} ${current === "courses" ? active : inactive}`}
      >
        Courses
      </Link>

      <Link
        href="/sessions"
        className={`${base} ${current === "sessions" ? active : inactive}`}
      >
        Sessions
      </Link>

      <Link
        href="/session-visualizer"
        className={`${base} ${
          current === "session-visualizer" ? active : inactive
        }`}
      >
        Session Visualizer
      </Link>

      <Link
        href="/script-testing"
        className={`${base} ${
          current === "script-testing" ? active : inactive
        }`}
      >
        Script Testing
      </Link>
    </nav>
  );
}