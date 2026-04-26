import AdminNav from "@/components/AdminNav";
import { listCoursesForSelect } from "@/app/actions";
import CourseBuilder from "./CourseBuilder";

export default async function BuildCoursePage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const [courseOptions, { courseId }] = await Promise.all([
    listCoursesForSelect(),
    searchParams,
  ]);

  return (
    <main className="h-screen overflow-hidden bg-zinc-50">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-6">
        <AdminNav current="courses" />
        <div className="min-h-0 flex-1">
          <CourseBuilder courseOptions={courseOptions} initialCourseId={courseId} />
        </div>
      </div>
    </main>
  );
}
