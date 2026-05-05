"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import ScriptTestingSubnav from "../../ScriptTestingSubnav";
import { deleteTestCaseRecord, getTestCase, upsertTestCaseRecord } from "@/app/actions";
import { DownloadIcon, TrashIcon } from "@/components/ActionIcons";
import {
  TestCase,
  TestCaseGroup,
  TestCasePacingRow,
  TestCaseEventRow,
  TestCaseHole,
  TestCaseLandmark,
  LocationData,
  LandmarkOption,
  PacingEventType,
  TEST_CASE_LABEL_OPTIONS,
  TestCaseEventType,
  TestCaseLabel,
  buildLandmarkOptions,
  testCaseToExportJsonWithCourseData,
} from "@/lib/testCases";

// Local UI types that allow empty eventType for newly-added unsaved rows
type PacingRowUI = Omit<TestCasePacingRow, "eventType"> & { eventType: PacingEventType | "" };
type EventRowUI = Omit<TestCaseEventRow, "eventType"> & { eventType: TestCaseEventType | "" };

const PACING_EVENT_TYPES: PacingEventType[] = ["hole", "off course"];
const EVENT_TYPES: TestCaseEventType[] = [
  "behind pace",
  "group split",
  "group join",
  "leave course",
  "skip_hole",
  "pass_group",
];

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";
const thClass =
  "border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600";

function SectionHeader({
  title,
  open,
  onToggle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm hover:bg-zinc-50"
    >
      <span className="text-sm font-semibold text-zinc-900">{title}</span>
      <span className="text-xs text-zinc-400">{open ? "▲" : "▼"}</span>
    </button>
  );
}

function makeId() {
  return Math.random().toString(36).slice(2);
}

export default function TestCaseEditor({
  id,
}: {
  id: string;
  courses?: { id: string; name: string }[];
}) {
  const router = useRouter();

  const [name, setName] = useState("New Test Case");
  const [description, setDescription] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [sessionJson, setSessionJson] = useState("");
  const [locationData, setLocationData] = useState<LocationData | null>(null);
  const [groups, setGroups] = useState<TestCaseGroup[]>([]);
  const [labels, setLabels] = useState<TestCaseLabel[]>([]);
  const [holes, setHoles] = useState<TestCaseHole[]>([]);
  const [landmarks, setLandmarks] = useState<TestCaseLandmark[]>([]);
  const [pacingRows, setPacingRows] = useState<PacingRowUI[]>([]);
  const [events, setEvents] = useState<EventRowUI[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [existingTestCase, setExistingTestCase] = useState<TestCase | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState({
    config: true,
    locationData: true,
    groupPacing: true,
    events: true,
  });

  // Load from the shared test_cases table on mount
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    getTestCase(id)
      .then((tc) => {
        if (cancelled) return;
        setExistingTestCase(tc);
        if (tc) {
          setName(tc.name);
          setDescription(tc.description ?? "");
          setCourseId(tc.courseId ?? null);
          setCourseName(tc.courseName ?? null);
          setSessionJson(tc.sessionJson ?? "");
          setLocationData(tc.locationData ?? null);
          setGroups(tc.groups);
          setLabels(tc.labels ?? []);
          setHoles(tc.holes);
          setLandmarks(tc.landmarks);
          setPacingRows(tc.pacingRows);
          setEvents(tc.events);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setMessage(e instanceof Error ? e.message : "Failed to load test case.");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Landmark options derived from stored holes/landmarks
  const holeOptions = useMemo<LandmarkOption[]>(
    () =>
      holes.map((h) => ({
        value: `hole:${h.holeNumber}`,
        label: `Hole ${h.holeNumber}`,
      })),
    [holes]
  );

  const offCourseOptions = useMemo<LandmarkOption[]>(
    () =>
      buildLandmarkOptions(
        [],
        landmarks.filter((l) =>
          ["putting_green", "driving_range", "clubhouse"].includes(l.landmarkType)
        )
      ),
    [landmarks]
  );

  function getLandmarkOptionsForPacing(eventType: PacingEventType | ""): LandmarkOption[] {
    if (eventType === "hole") return holeOptions;
    if (eventType === "off course") return offCourseOptions;
    return [];
  }

  function computeGroupsAtHole(holeNumber: number, excludeEventId?: string): TestCaseGroup[] {
    const splitJoins = events
      .filter(
        (ev) =>
          ev.id !== excludeEventId &&
          (ev.eventType === "group split" || ev.eventType === "group join") &&
          ev.landmark.startsWith("hole:")
      )
      .map((ev) => ({ ...ev, holeNum: parseInt(ev.landmark.split(":")[1], 10) }))
      .filter((ev) => !isNaN(ev.holeNum) && ev.holeNum <= holeNumber)
      .sort((a, b) => a.holeNum - b.holeNum);

    let gs: TestCaseGroup[] = [...groups];
    for (const ev of splitJoins) {
      if (ev.eventType === "group split") {
        const g = gs.find((x) => x.localId === ev.groupId);
        if (g) {
          gs = gs.filter((x) => x.localId !== ev.groupId);
          gs.push(
            { localId: `${ev.groupId}-a`, label: `${g.label}a`, teeTime: g.teeTime, startHole: g.startHole },
            { localId: `${ev.groupId}-b`, label: `${g.label}b`, teeTime: g.teeTime, startHole: g.startHole }
          );
        }
      } else if (ev.eventType === "group join") {
        gs = gs.filter((x) => x.localId !== ev.groupId);
      }
    }
    return gs;
  }

  // ── Pacing rows ─────────────────────────────────────────────────────────────

  function addPacingRow() {
    setPacingRows((prev) => [
      ...prev,
      { id: makeId(), groupId: "", eventType: "", landmark: "", startTime: "", endTime: "" },
    ]);
  }

  function updatePacingRow(
    rowId: string,
    field: keyof Omit<PacingRowUI, "id">,
    value: string
  ) {
    setPacingRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const updated = { ...r, [field]: value };
        if (field === "eventType") {
          const opts = getLandmarkOptionsForPacing(updated.eventType as PacingEventType);
          if (updated.landmark && !opts.some((o) => o.value === updated.landmark)) {
            updated.landmark = "";
          }
          updated.groupId = "";
        }
        if (field === "landmark") {
          updated.groupId = "";
        }
        return updated;
      })
    );
  }

  function removePacingRow(rowId: string) {
    if (!window.confirm("Delete this pacing row? This cannot be undone.")) return;
    setPacingRows((prev) => prev.filter((r) => r.id !== rowId));
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  function addEvent() {
    setEvents((prev) => [
      ...prev,
      { id: makeId(), groupId: "", eventType: "", landmark: "", time: "" },
    ]);
  }

  function updateEvent(
    evId: string,
    field: keyof Omit<EventRowUI, "id">,
    value: string
  ) {
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== evId) return e;
        const updated = { ...e, [field]: value };
        if (field === "eventType") {
          if (updated.eventType === "leave course") updated.landmark = "";
          else updated.time = "";
          updated.groupId = "";
        }
        if (field === "landmark") {
          updated.groupId = "";
        }
        return updated;
      })
    );
  }

  function removeEvent(evId: string) {
    if (!window.confirm("Delete this event? This cannot be undone.")) return;
    setEvents((prev) => prev.filter((e) => e.id !== evId));
  }

  function toggleLabel(label: TestCaseLabel) {
    setLabels((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  }

  // ── Save / Delete ───────────────────────────────────────────────────────────

  function buildTestCase(): TestCase {
    return {
      id,
      name: name.trim() || "Untitled Test Case",
      description,
      courseId,
      courseName,
      holes,
      landmarks,
      groups,
      labels,
      pacingRows: pacingRows.filter((r) => r.eventType !== "").map((r) => r as TestCasePacingRow),
      events: events.filter((e) => e.eventType !== "").map((e) => e as TestCaseEventRow),
      sessionJson,
      locationData: existingTestCase?.locationData ?? locationData ?? null,
      createdAt: existingTestCase?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async function onSave() {
    setMessage("");
    setIsSaving(true);
    try {
      const tc = buildTestCase();
      await upsertTestCaseRecord(tc);
      setExistingTestCase(tc);
      setMessage("Saved.");
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setIsSaving(false);
    }
  }

  async function goToTestCaseBuilder() {
    setMessage("");
    setIsSaving(true);
    try {
      const tc = buildTestCase();
      await upsertTestCaseRecord(tc);
      setExistingTestCase(tc);
      router.push(`/script-testing/test-case-builder?tcId=${id}`);
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Failed to save before opening the builder.");
    } finally {
      setIsSaving(false);
    }
  }

  async function downloadSessionJson() {
    const tc = buildTestCase();
    const json = JSON.stringify(await testCaseToExportJsonWithCourseData(tc), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (tc.name || "test-case").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.href = url;
    a.download = `${safeName || "test-case"}-session.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onDelete() {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      await deleteTestCaseRecord(id);
      router.push("/script-testing/test-cases");
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Failed to delete test case.");
      setIsDeleting(false);
    }
  }

  if (!loaded) return null;

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="fixed left-16 top-24 z-10">
        <ScriptTestingSubnav />
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="script-testing" />

        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Edit Test Case</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Configure location data, pacing, and events for script comparison.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/script-testing/test-cases"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              ← Back
            </Link>
            <button
              type="button"
              onClick={downloadSessionJson}
              aria-label="Download JSON"
              title="Download JSON"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              <DownloadIcon />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label="Delete"
              title={isDeleting ? "Deleting" : "Delete"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-50"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* ── Session Configurations ─────────────────────────────────── */}
        <div className="mb-3">
          <SectionHeader
            title="Session Configurations"
            open={sectionsOpen.config}
            onToggle={() => setSectionsOpen((p) => ({ ...p, config: !p.config }))}
          />
        </div>

        {sectionsOpen.config && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            {/* Name */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-zinc-700">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass + " w-full max-w-sm"}
              />
            </div>

            {/* Description */}
            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-zinc-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this test case covers..."
                rows={3}
                className={inputClass + " w-full resize-none"}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700">Labels</label>
              <div className="flex flex-wrap gap-2">
                {TEST_CASE_LABEL_OPTIONS.map((label) => {
                  const selected = labels.includes(label);
                  return (
                    <label
                      key={label}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleLabel(label)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* ── Location Data ──────────────────────────────────────────── */}
        <div className="mb-3">
          <SectionHeader
            title="Location Data"
            open={sectionsOpen.locationData}
            onToggle={() => setSectionsOpen((p) => ({ ...p, locationData: !p.locationData }))}
          />
        </div>

        {sectionsOpen.locationData && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            {locationData ? (
              <div>
                <div className="mb-3 flex flex-wrap gap-4">
                  {locationData.courseId && (
                    <span className="text-xs text-zinc-600">
                      <span className="font-medium text-zinc-500">Course ID: </span>
                      <span className="font-mono">{locationData.courseId}</span>
                    </span>
                  )}
                  {locationData.courseName && (
                    <span className="text-xs text-zinc-600">
                      <span className="font-medium text-zinc-500">Course: </span>
                      {locationData.courseName}
                    </span>
                  )}
                  <span className="text-xs text-zinc-600">
                    <span className="font-medium text-zinc-500">Groups: </span>
                    {locationData.groups.length}
                  </span>
                  <span className="text-xs text-zinc-600">
                    <span className="font-medium text-zinc-500">Players: </span>
                    {locationData.players.length}
                  </span>
                  <span className="text-xs text-zinc-600">
                    <span className="font-medium text-zinc-500">Locations: </span>
                    {locationData.players.reduce((sum, p) => sum + p.locations.length, 0)}
                  </span>
                  <span className="text-xs text-zinc-600">
                    <span className="font-medium text-zinc-500">Cart Paths: </span>
                    {locationData.cartPaths?.length ?? 0}
                  </span>
                </div>
                {locationData.players.length > 0 && (
                  <div className="mb-3 overflow-x-auto rounded-lg border border-zinc-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-zinc-50">
                          <th className="px-3 py-2 text-left font-semibold text-zinc-500">Player</th>
                          <th className="px-3 py-2 text-left font-semibold text-zinc-500">Group</th>
                          <th className="px-3 py-2 text-left font-semibold text-zinc-500">Locations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {locationData.players.map((p, pi) => {
                          const grp = locationData.groups.find((g) => g.localId === p.groupId);
                          return (
                            <tr key={p.localId ?? pi} className="border-t border-zinc-100">
                              <td className="px-3 py-1.5 text-zinc-800">{p.name || p.localId || "—"}</td>
                              <td className="px-3 py-1.5 text-zinc-600">{grp?.label ?? "—"}</td>
                              <td className="px-3 py-1.5 text-zinc-600">{p.locations.length}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void goToTestCaseBuilder()}
                    disabled={isSaving}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Edit in Test Case Builder
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("Clear location data?")) return;
                      setLocationData(null);
                      if (!existingTestCase) return;
                      const updated = {
                        ...existingTestCase,
                        locationData: null,
                        courseId: null,
                        courseName: null,
                        holes: [],
                        landmarks: [],
                        groups: [],
                        updatedAt: new Date().toISOString(),
                      };
                      await upsertTestCaseRecord(updated);
                      setExistingTestCase(updated);
                      setCourseId(null);
                      setCourseName(null);
                      setGroups([]);
                      setHoles([]);
                      setLandmarks([]);
                    }}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500">
                  No location data set. Use the Test Case Builder to add players and locations.
                </p>
                <button
                  type="button"
                  onClick={() => void goToTestCaseBuilder()}
                  disabled={isSaving}
                  className="ml-4 shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
                >
                  Go to Test Case Builder
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Group Pacing ───────────────────────────────────────────── */}
        <div className="mb-3">
          <SectionHeader
            title="Group Pacing"
            open={sectionsOpen.groupPacing}
            onToggle={() =>
              setSectionsOpen((p) => ({ ...p, groupPacing: !p.groupPacing }))
            }
          />
        </div>

        {sectionsOpen.groupPacing && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <p className="text-xs text-zinc-600">
                Record each group&apos;s hole-by-hole pacing for comparison against
                script output.
              </p>
              <button
                type="button"
                onClick={addPacingRow}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              >
                + Add row
              </button>
            </div>

            {pacingRows.length === 0 ? (
              <div className="text-sm text-zinc-500">No rows yet.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full min-w-[760px] border-collapse">
                  <thead>
                    <tr className="bg-zinc-50">
                      <th className={thClass}>Event Type</th>
                      <th className={thClass}>Landmark</th>
                      <th className={thClass}>Group</th>
                      <th className={thClass}>Start Time</th>
                      <th className={thClass}>End Time</th>
                      <th className="border-b border-zinc-200 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {pacingRows.map((row) => {
                      const holeNum =
                        row.eventType === "hole" && row.landmark.startsWith("hole:")
                          ? parseInt(row.landmark.split(":")[1], 10)
                          : null;
                      const groupsForRow =
                        row.eventType === "off course"
                          ? groups
                          : holeNum !== null
                          ? computeGroupsAtHole(holeNum)
                          : [];
                      const landmarkEnabled = row.eventType !== "";
                      const groupEnabled =
                        row.eventType === "off course" ||
                        (row.eventType === "hole" && row.landmark !== "");
                      const timesEnabled = groupEnabled;
                      const dc = " disabled:opacity-40 disabled:cursor-not-allowed";
                      return (
                        <tr key={row.id} className="border-b border-zinc-100 last:border-0">
                          <td className="px-3 py-2">
                            <select
                              value={row.eventType}
                              onChange={(e) => updatePacingRow(row.id, "eventType", e.target.value)}
                              className={inputClass + " w-full"}
                            >
                              <option value="">— select —</option>
                              {PACING_EVENT_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={row.landmark}
                              onChange={(e) => updatePacingRow(row.id, "landmark", e.target.value)}
                              disabled={!landmarkEnabled}
                              className={inputClass + " w-full" + dc}
                            >
                              <option value="">—</option>
                              {getLandmarkOptionsForPacing(row.eventType).map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={row.groupId}
                              onChange={(e) => updatePacingRow(row.id, "groupId", e.target.value)}
                              disabled={!groupEnabled}
                              className={inputClass + " w-full" + dc}
                            >
                              <option value="">—</option>
                              {groupsForRow.map((g, i) => (
                                <option key={g.localId} value={g.localId}>
                                  {g.label.trim() || `Group ${i + 1}`}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="time"
                              value={row.startTime}
                              onChange={(e) => updatePacingRow(row.id, "startTime", e.target.value)}
                              disabled={!timesEnabled}
                              className={inputClass + dc}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="time"
                              value={row.endTime}
                              onChange={(e) => updatePacingRow(row.id, "endTime", e.target.value)}
                              disabled={!timesEnabled}
                              className={inputClass + dc}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removePacingRow(row.id)}
                              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Events ────────────────────────────────────────────────── */}
        <div className="mb-3">
          <SectionHeader
            title="Events"
            open={sectionsOpen.events}
            onToggle={() => setSectionsOpen((p) => ({ ...p, events: !p.events }))}
          />
        </div>

        {sectionsOpen.events && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <p className="text-xs text-zinc-600">Log session-level events.</p>
              <button
                type="button"
                onClick={addEvent}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              >
                + Add event
              </button>
            </div>

            {events.length === 0 ? (
              <div className="text-sm text-zinc-500">No events yet.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full min-w-[600px] border-collapse">
                  <thead>
                    <tr className="bg-zinc-50">
                      <th className={thClass}>Event Type</th>
                      <th className={thClass}>Landmark</th>
                      <th className={thClass}>Group</th>
                      <th className={thClass}>Time</th>
                      <th className="border-b border-zinc-200 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => {
                      const isLeave = ev.eventType === "leave course";
                      const holeNum =
                        !isLeave && ev.landmark.startsWith("hole:")
                          ? parseInt(ev.landmark.split(":")[1], 10)
                          : null;
                      const groupsForRow =
                        isLeave || ev.landmark === "off course"
                          ? groups
                          : holeNum !== null
                          ? computeGroupsAtHole(holeNum, ev.id)
                          : [];
                      const landmarkEnabled = ev.eventType !== "" && !isLeave;
                      const groupEnabled =
                        ev.eventType !== "" && (isLeave || ev.landmark !== "");
                      const dc = " disabled:opacity-40 disabled:cursor-not-allowed";
                      const eventLandmarkOpts: LandmarkOption[] = [
                        { value: "off course", label: "Off course" },
                        ...holeOptions,
                      ];
                      return (
                        <tr key={ev.id} className="border-b border-zinc-100 last:border-0">
                          <td className="px-3 py-2">
                            <select
                              value={ev.eventType}
                              onChange={(e) => updateEvent(ev.id, "eventType", e.target.value)}
                              className={inputClass + " w-full"}
                            >
                              <option value="">— select —</option>
                              {EVENT_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {!isLeave ? (
                              <select
                                value={ev.landmark}
                                onChange={(e) => updateEvent(ev.id, "landmark", e.target.value)}
                                disabled={!landmarkEnabled}
                                className={inputClass + " w-full" + dc}
                              >
                                <option value="">—</option>
                                {eventLandmarkOpts.map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-sm text-zinc-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={ev.groupId}
                              onChange={(e) => updateEvent(ev.id, "groupId", e.target.value)}
                              disabled={!groupEnabled}
                              className={inputClass + " w-full" + dc}
                            >
                              <option value="">—</option>
                              {groupsForRow.map((g, i) => (
                                <option key={g.localId} value={g.localId}>
                                  {g.label.trim() || `Group ${i + 1}`}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {isLeave ? (
                              <input
                                type="time"
                                value={ev.time}
                                onChange={(e) => updateEvent(ev.id, "time", e.target.value)}
                                className={inputClass}
                              />
                            ) : (
                              <span className="text-sm text-zinc-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeEvent(ev.id)}
                              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>
          <div className="font-mono text-xs text-zinc-700">{message}</div>
        </div>
      </div>
    </main>
  );
}
