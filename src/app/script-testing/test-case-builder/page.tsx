import AdminNav from "@/components/AdminNav";
import ScriptTestingSubnav from "../ScriptTestingSubnav";
import TestCaseBuilder from "./TestCaseBuilder";
import { Suspense } from "react";
import { listCoursesForSelect } from "@/app/actions";
import { redirect } from "next/navigation";

export default async function TestCaseBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ tcId?: string }>;
}) {
  const [courseOptions, { tcId }] = await Promise.all([
    listCoursesForSelect(),
    searchParams,
  ]);

  if (!tcId) redirect("/script-testing/test-cases");

  return (
    <main className="h-screen overflow-hidden bg-zinc-50">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-6">
        <AdminNav current="script-testing" />
        <div className="fixed left-16 top-24 z-10">
          <ScriptTestingSubnav />
        </div>
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-zinc-900">Test Case Builder</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Create groups and players, then click the map to place player locations with timestamps.
          </p>
        </div>
        <Suspense>
          <TestCaseBuilder courseOptions={courseOptions} />
        </Suspense>
      </div>
    </main>
  );
}
