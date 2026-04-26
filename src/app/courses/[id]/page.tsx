import { redirect } from "next/navigation";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/courses/build?courseId=${id}`);
}
