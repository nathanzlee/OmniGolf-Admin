import AdminNav from "@/components/AdminNav";
import ScriptTester from "./ScriptTester";
import { listSessions } from "../actions";

export default async function ScriptTestingPage() {
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
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="script-testing" />
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">Script Testing</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Upload your group pacing Python script and a session JSON file to view the output.
          </p>
        </div>
        <ScriptTester completedSessions={completedSessions} />
      </div>
    </main>
  );
}
