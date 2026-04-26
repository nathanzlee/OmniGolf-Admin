"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import ScriptTestingSubnav from "../ScriptTestingSubnav";
import { TestCase, loadTestCases, saveTestCases } from "@/lib/testCases";

const thClass =
  "border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600";

export default function TestCasesPage() {
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const router = useRouter();

  useEffect(() => {
    setTestCases(loadTestCases());
  }, []);

  function handleNew() {
    router.push(`/script-testing/test-cases/${crypto.randomUUID()}`);
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this test case? This cannot be undone.")) return;
    const updated = testCases.filter((tc) => tc.id !== id);
    saveTestCases(updated);
    setTestCases(updated);
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="fixed left-16 top-24 z-10">
        <ScriptTestingSubnav />
      </div>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="script-testing" />

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Test Cases</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Create reusable test scenarios for your scripts.
            </p>
          </div>
          <button
            type="button"
            onClick={handleNew}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
          >
            + Add new test case
          </button>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto rounded-xl">
            <table className="w-full min-w-[500px] border-collapse">
              <thead>
                <tr className="bg-zinc-50">
                  <th className={thClass}>Name</th>
                  <th className={thClass}>Course</th>
                  <th className={thClass}>Groups</th>
                  <th className={thClass + " text-right"}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {testCases.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-zinc-600" colSpan={4}>
                      No test cases yet. Click &ldquo;Add new test case&rdquo;.
                    </td>
                  </tr>
                ) : (
                  testCases.map((tc) => (
                    <tr key={tc.id} className="hover:bg-zinc-50">
                      <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-900">
                        {tc.name || "Untitled"}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-600">
                        {tc.courseName ?? "—"}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-600">
                        {tc.groups.length}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3">
                        <div className="flex justify-end gap-3">
                          <Link
                            href={`/script-testing/test-cases/${tc.id}`}
                            className="text-sm font-medium text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-600"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(tc.id)}
                            className="text-sm font-medium text-red-600 underline decoration-red-300 hover:decoration-red-600"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
