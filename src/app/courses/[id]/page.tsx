import {
  getCourse,
  getCourseHoles,
  getCourseLandmarks,
} from "../../actions";
import CourseEditor from "./CourseEditor";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [course, holes, landmarks] = await Promise.all([
    getCourse(id),
    getCourseHoles(id),
    getCourseLandmarks(id),
  ]);

  return (
    <CourseEditor
      course={course}
      initialHoles={holes}
      initialLandmarks={landmarks}
    />
  );
}