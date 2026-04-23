import AdminNav from "@/components/AdminNav";
import SessionVisualizer from "./SessionVisualizer";
import { listSessions } from "../actions";

export default async function SessionVisualizerPage() {
  const allSessions = await listSessions();
  const completedSessions = allSessions
    .filter((s) => s.status === "completed")
    .map((s) => ({
      id: s.id,
      name: s.name,
      sessionDate: s.session_date ?? null,
      courseName:
        s.golf_courses && !Array.isArray(s.golf_courses)
          ? (s.golf_courses as { name: string }).name
          : null,
    }));

  return (
    <main className="h-screen overflow-hidden bg-zinc-50">
      <div className="mx-auto flex h-full max-w-7xl flex-col px-6 py-6">
        <AdminNav current="session-visualizer" />
        <div className="min-h-0 flex-1">
          <SessionVisualizer completedSessions={completedSessions} />
        </div>
      </div>
    </main>
  );
}
