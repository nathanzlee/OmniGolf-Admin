"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import ScriptTestingSubnav from "../ScriptTestingSubnav";
import { deleteTestCaseRecord, listTestCases } from "@/app/actions";
import { TestCase, testCaseToExportJsonWithCourseData } from "@/lib/testCases";
import { DownloadIcon, EditIcon, TrashIcon } from "@/components/ActionIcons";

const thClass =
  "border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600";

export default function TestCasesPage() {
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    listTestCases()
      .then((cases) => {
        if (!cancelled) setTestCases(cases);
      })
      .catch((e: unknown) => {
        if (!cancelled) setMessage(e instanceof Error ? e.message : "Failed to load test cases.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleNew() {
    router.push(`/script-testing/test-cases/${crypto.randomUUID()}`);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this test case? This cannot be undone.")) return;
    setMessage("");
    try {
      await deleteTestCaseRecord(id);
      setTestCases((prev) => prev.filter((tc) => tc.id !== id));
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Failed to delete test case.");
    }
  }

  async function downloadTestCaseJson(tc: TestCase) {
    const json = JSON.stringify(await testCaseToExportJsonWithCourseData(tc), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (tc.name || "test-case").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.href = url;
    a.download = `${safeName || "test-case"}-session.json`;
    a.click();
    URL.revokeObjectURL(url);
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
          {message && (
            <div className="border-b border-zinc-100 px-4 py-3 text-sm text-red-600">
              {message}
            </div>
          )}
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
                {isLoading ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-zinc-600" colSpan={4}>
                      Loading test cases...
                    </td>
                  </tr>
                ) : testCases.length === 0 ? (
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
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => downloadTestCaseJson(tc)}
                            aria-label="Download JSON"
                            title="Download JSON"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
                          >
                            <DownloadIcon />
                          </button>
                          <Link
                            href={`/script-testing/test-cases/${tc.id}`}
                            aria-label="Edit"
                            title="Edit"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
                          >
                            <EditIcon />
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(tc.id)}
                            aria-label="Delete"
                            title="Delete"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 shadow-sm hover:bg-red-100"
                          >
                            <TrashIcon />
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
