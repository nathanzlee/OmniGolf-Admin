"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Courses", href: "/courses" },
  { label: "Build Course", href: "/courses/build" },
];

export default function CourseSubnav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/courses/build") return pathname.startsWith("/courses/build");
    // "Courses" is active for /courses and /courses/[id] (not build)
    return pathname === "/courses" ||
      (pathname.startsWith("/courses/") && !pathname.startsWith("/courses/build"));
  }

  return (
    <nav className="flex flex-col gap-1 w-36">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            isActive(tab.href)
              ? "bg-zinc-900 text-white"
              : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
