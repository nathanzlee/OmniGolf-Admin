import Link from "next/link";
import { listSessions } from "../actions";
import AdminNav from "@/components/AdminNav";
import SessionSubnav from "./SessionSubnav";

export default async function SessionsPage() {
  const sessions = await listSessions();

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="sessions" />

        <div className="flex gap-6">
          <SessionSubnav />

          <div className="min-w-0 flex-1">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-zinc-900">Sessions</h1>
                <p className="mt-1 text-sm text-zinc-600">
                  Create and manage tracking sessions for a course round or tournament.
                </p>
              </div>

              <Link
                href="/sessions/new"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
              >
                + Add new session
              </Link>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="overflow-x-auto rounded-xl">
                <table className="w-full min-w-[780px] border-collapse">
                  <thead>
                    <tr className="bg-zinc-50">
                      <th className="border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Session
                      </th>
                      <th className="border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Course
                      </th>
                      <th className="border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Date
                      </th>
                      <th className="border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Status
                      </th>
                      <th className="border-b border-zinc-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {sessions.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-sm text-zinc-600" colSpan={5}>
                          No sessions yet. Click "Add new session".
                        </td>
                      </tr>
                    ) : (
                      sessions.map((s: any) => (
                        <tr key={s.id} className="hover:bg-zinc-50">
                          <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-900">
                            {s.name}
                          </td>
                          <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-600">
                            {Array.isArray(s.golf_courses)
                              ? s.golf_courses[0]?.name ?? "—"
                              : s.golf_courses?.name ?? "—"}
                          </td>
                          <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-600">
                            {s.session_date || "—"}
                          </td>
                          <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-600">
                            {s.status}
                          </td>
                          <td className="border-b border-zinc-100 px-4 py-3">
                            <div className="flex justify-end gap-3">
                              <Link
                                href={`/sessions/${s.id}`}
                                className="text-sm font-medium text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-600"
                              >
                                Edit
                              </Link>
                              <Link
                                href={`/sessions/${s.id}`}
                                className="text-sm font-medium text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-600"
                              >
                                Download JSON
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 text-xs text-zinc-500">
                Use "Download JSON" to export the full session payload for predictions or analysis.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
