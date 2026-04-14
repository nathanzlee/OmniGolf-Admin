import AdminNav from "@/components/AdminNav";
import SessionVisualizer from "./SessionVisualizer";

export default function SessionVisualizerPage() {
  return (
    <main className="h-screen overflow-hidden bg-zinc-50">
      <div className="mx-auto flex h-full max-w-7xl flex-col px-6 py-6">
        <AdminNav current="session-visualizer" />
        <div className="min-h-0 flex-1">
          <SessionVisualizer />
        </div>
      </div>
    </main>
  );
}