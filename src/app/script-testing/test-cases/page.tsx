"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import ScriptTestingSubnav from "../ScriptTestingSubnav";
import { deleteTestCaseRecord, listTestCases } from "@/app/actions";
import {
  TEST_CASE_LABEL_OPTIONS,
  TestCase,
  TestCaseLabel,
  testCaseToExportJsonWithCourseData,
} from "@/lib/testCases";
import { DownloadIcon, EditIcon, TrashIcon } from "@/components/ActionIcons";

const thClass =
  "border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600";

export default function TestCasesPage() {
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [courseFilter, setCourseFilter] = useState("");
  const [labelFilters, setLabelFilters] = useState<TestCaseLabel[]>([]);
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

  function toggleLabelFilter(label: TestCaseLabel) {
    setLabelFilters((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  }

  const courseOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const tc of testCases) {
      if (!tc.courseId) continue;
      byId.set(tc.courseId, tc.courseName || "Unnamed Course");
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [testCases]);

  const filteredTestCases = useMemo(
    () =>
      testCases.filter((tc) => {
        if (courseFilter && tc.courseId !== courseFilter) return false;
        return labelFilters.every((label) => tc.labels?.includes(label));
      }),
    [courseFilter, labelFilters, testCases]
  );

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
          <div className="border-b border-zinc-100 px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Course</label>
                <select
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-400"
                >
                  <option value="">All courses</option>
                  {courseOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-zinc-600">Labels</label>
                <div className="flex flex-wrap gap-2">
                  {TEST_CASE_LABEL_OPTIONS.map((label) => {
                    const selected = labelFilters.includes(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleLabelFilter(label)}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          selected
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl">
            <table className="w-full min-w-[500px] border-collapse">
              <thead>
                <tr className="bg-zinc-50">
                  <th className={thClass}>Name</th>
                  <th className={thClass}>Course</th>
                  <th className={thClass + " text-right"}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-zinc-600" colSpan={3}>
                      Loading test cases...
                    </td>
                  </tr>
                ) : testCases.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-zinc-600" colSpan={3}>
                      No test cases yet. Click &ldquo;Add new test case&rdquo;.
                    </td>
                  </tr>
                ) : filteredTestCases.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-zinc-600" colSpan={3}>
                      No test cases match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredTestCases.map((tc) => (
                    <tr key={tc.id} className="hover:bg-zinc-50">
                      <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-900">
                        {tc.name || "Untitled"}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-600">
                        {tc.courseName ?? "—"}
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
