import { listCoursesForSelect } from "@/app/actions";
import TestCaseEditor from "./TestCaseEditor";

export default async function TestCaseEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const courses = await listCoursesForSelect();
  return <TestCaseEditor id={id} courses={courses} />;
}
