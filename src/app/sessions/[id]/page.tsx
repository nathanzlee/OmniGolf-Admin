import {
  getSession,
  getSessionGroups,
  getSessionGroupPlayers,
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

  return (
    <SessionEditor
      session={session}
      initialGroups={groups}
      initialGroupPlayers={groupPlayers}
      courses={courses}
      users={users}
    />
  );
}