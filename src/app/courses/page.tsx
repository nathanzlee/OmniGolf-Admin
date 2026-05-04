import Link from "next/link";
import { listCourses } from "../actions";
import AdminNav from "@/components/AdminNav";
import { EditIcon } from "@/components/ActionIcons";

export default async function CoursesPage() {
  const courses = await listCourses();

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="courses" />
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Courses</h1>
            <p className="mt-1 text-sm text-zinc-600">
              View and edit saved courses + hole coordinates.
            </p>
          </div>

          <Link
            href="/courses/build"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
          >
            + Add new course
          </Link>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto rounded-xl">
            <table className="w-full min-w-[700px] border-collapse">
              <thead>
                <tr className="bg-zinc-50">
                  <th className="border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                    Course
                  </th>
                  <th className="border-b border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                    Created
                  </th>
                  <th className="border-b border-zinc-200 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-zinc-600">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {courses.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-zinc-600" colSpan={3}>
                      No courses yet. Click “+ Add new course”.
                    </td>
                  </tr>
                ) : (
                  courses.map((c) => (
                    <tr key={c.id} className="hover:bg-zinc-50">
                      <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-900">
                        {c.name}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-600">
                        {new Date(c.created_at).toLocaleString()}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-right">
                        <Link
                          href={`/courses/build?courseId=${c.id}`}
                          aria-label="Edit"
                          title="Edit"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
                        >
                          <EditIcon />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 text-xs text-zinc-500">
            Use the edit action to update hole coordinates, cart paths, and landmarks.
          </div>
        </div>
      </div>
    </main>
  );
}
