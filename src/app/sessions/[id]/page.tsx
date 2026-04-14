import {
  getSession,
  getSessionGroups,
  getSessionGroupPlayers,
  getCourseHoles,
  getCourseLandmarks,
  listCoursesForSelect,
  listUsersForSelect,
} from "../../actions";
import SessionEditor from "./SessionEditor";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [session, groups, groupPlayers, courses, users] = await Promise.all([
    getSession(id),
    getSessionGroups(id),
    getSessionGroupPlayers(id),
    listCoursesForSelect(),
    listUsersForSelect(),
  ]);

  const [courseHoles, courseLandmarks] = await Promise.all([
    getCourseHoles(session.course_id),
    getCourseLandmarks(session.course_id),
  ]);

  return (
    <SessionEditor
      session={session}
      initialGroups={groups}
      initialGroupPlayers={groupPlayers}
      courses={courses}
      users={users}
      courseHoles={courseHoles}
      courseLandmarks={courseLandmarks}
    />
  );
}
