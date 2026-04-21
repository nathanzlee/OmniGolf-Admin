import AdminNav from "@/components/AdminNav";
import ScriptTester from "./ScriptTester";

export default function ScriptTestingPage() {
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
        <ScriptTester />
      </div>
    </main>
  );
}
