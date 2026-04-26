"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ScriptTestingSubnav() {
  const pathname = usePathname();
  const base = "block rounded-lg px-3 py-2 text-sm font-medium transition-colors";
  const active = "bg-zinc-900 text-white shadow-sm";
  const inactive = "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900";

  return (
    <nav className="flex w-36 shrink-0 flex-col gap-1">
      <Link
        href="/script-testing"
        className={`${base} ${pathname === "/script-testing" ? active : inactive}`}
      >
        Run Script
      </Link>
      <Link
        href="/script-testing/test-cases"
        className={`${base} ${pathname.startsWith("/script-testing/test-cases") ? active : inactive}`}
      >
        Test Cases
      </Link>
    </nav>
  );
}
