"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import ScriptTestingSubnav from "../../ScriptTestingSubnav";
import {
  TestCase,
  TestCaseGroup,
  TestCasePacingRow,
  TestCaseEventRow,
  TestCaseHole,
  TestCaseLandmark,
  LandmarkOption,
  PacingEventType,
  TestCaseEventType,
  loadTestCases,
  upsertTestCase,
  removeTestCase,
  buildLandmarkOptions,
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
];

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";
const thClass =
  "border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600";

function makeId() {
  return Math.random().toString(36).slice(2);
}

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

// Parse groups, holes, and landmarks out of a session export JSON
function parseSessionJson(json: string): {
  groups: TestCaseGroup[];
  holes: TestCaseHole[];
  landmarks: TestCaseLandmark[];
  courseName: string | null;
} {
  try {
    const data = JSON.parse(json);
    const groups: TestCaseGroup[] = (data.groups ?? []).map((g: any) => ({
      localId: String(g.group_id ?? g.id ?? makeId()),
      label: g.label ?? "",
      teeTime: g.tee_time
        ? new Date(g.tee_time).toISOString().slice(0, 16)
        : "",
    }));
    const holes: TestCaseHole[] = (data.holes ?? []).map((h: any) => ({
      holeNumber: h.hole_number,
      teeLat: h.tee_lat,
      teeLng: h.tee_lng,
      greenLat: h.green_lat,
      greenLng: h.green_lng,
      allottedTime: h.allotted_time,
    }));
    const landmarks: TestCaseLandmark[] = (data.course_landmarks ?? []).map(
      (l: any) => ({
        id: l.id ?? makeId(),
        landmarkType: l.landmark_type,
        endpoint1Lat: l.endpoint1_latitude ?? l.latitude,
        endpoint1Lng: l.endpoint1_longitude ?? l.longitude,
        ...(l.endpoint2_latitude != null
          ? {
              endpoint2Lat: l.endpoint2_latitude,
              endpoint2Lng: l.endpoint2_longitude,
            }
          : {}),
      })
    );
    const courseName: string | null = data.course_name ?? null;
    return { groups, holes, landmarks, courseName };
  } catch {
    return { groups: [], holes: [], landmarks: [], courseName: null };
  }
}

export default function TestCaseEditor({
  id,
}: {
  id: string;
  courses?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("New Test Case");
  const [description, setDescription] = useState("");
  const [sessionJson, setSessionJson] = useState("");
  const [sessionJsonName, setSessionJsonName] = useState<string | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [groups, setGroups] = useState<TestCaseGroup[]>([]);
  const [holes, setHoles] = useState<TestCaseHole[]>([]);
  const [landmarks, setLandmarks] = useState<TestCaseLandmark[]>([]);
  const [pacingRows, setPacingRows] = useState<PacingRowUI[]>([]);
  const [events, setEvents] = useState<EventRowUI[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState({
    config: true,
    groupPacing: true,
    events: true,
  });

  // Load from localStorage on mount
  useEffect(() => {
    const tc = loadTestCases().find((t) => t.id === id);
    if (tc) {
      setName(tc.name);
      setDescription(tc.description ?? "");
      setSessionJson(tc.sessionJson ?? "");
      setCourseName(tc.courseName ?? null);
      setGroups(tc.groups);
      setHoles(tc.holes);
      setLandmarks(tc.landmarks);
      setPacingRows(tc.pacingRows);
      setEvents(tc.events);
      // Recover file name hint from JSON if present
      try {
        const parsed = JSON.parse(tc.sessionJson ?? "");
        if (parsed?.session_name) setSessionJsonName(parsed.session_name);
      } catch { /* ignore */ }
    }
    setLoaded(true);
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
            { localId: `${ev.groupId}-a`, label: `${g.label}a`, teeTime: g.teeTime },
            { localId: `${ev.groupId}-b`, label: `${g.label}b`, teeTime: g.teeTime }
          );
        }
      } else if (ev.eventType === "group join") {
        gs = gs.filter((x) => x.localId !== ev.groupId);
      }
    }
    return gs;
  }

  // ── JSON upload ────────────────────────────────────────────────────────────

  function handleJsonUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setSessionJson(text);
      setSessionJsonName(file.name);
      const parsed = parseSessionJson(text);
      setGroups(parsed.groups);
      setHoles(parsed.holes);
      setLandmarks(parsed.landmarks);
      if (parsed.courseName) setCourseName(parsed.courseName);
      // Clear landmark references in existing pacing/events rows
      setPacingRows((prev) => prev.map((r) => ({ ...r, landmark: "" })));
      setEvents((prev) => prev.map((ev) => ({ ...ev, landmark: "" })));
    };
    reader.readAsText(file);
    e.currentTarget.value = "";
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
    setEvents((prev) => prev.filter((e) => e.id !== evId));
  }

  // ── Save / Delete ───────────────────────────────────────────────────────────

  function buildTestCase(): TestCase {
    const existing = loadTestCases().find((t) => t.id === id);
    return {
      id,
      name: name.trim() || "Untitled Test Case",
      description,
      courseId: null,
      courseName,
      holes,
      landmarks,
      groups,
      pacingRows: pacingRows.filter((r) => r.eventType !== "").map((r) => r as TestCasePacingRow),
      events: events.filter((e) => e.eventType !== "").map((e) => e as TestCaseEventRow),
      sessionJson,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function onSave() {
    setMessage("");
    setIsSaving(true);
    try {
      upsertTestCase(buildTestCase());
      setMessage("✅ Saved.");
    } catch (e: any) {
      setMessage(`❌ ${e?.message ?? "Failed to save."}`);
    } finally {
      setIsSaving(false);
    }
  }

  function onDelete() {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      removeTestCase(id);
      router.push("/script-testing/test-cases");
    } catch {
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
              Upload a session JSON, then record actual pacing and events for comparison.
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
              onClick={onDelete}
              disabled={isDeleting}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-50"
            >
              {isDeleting ? "Deleting…" : "Delete"}
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

            <hr className="mb-6 border-zinc-200" />

            {/* Session JSON upload */}
            <div className="mb-2">
              <h3 className="mb-1 text-sm font-semibold text-zinc-900">Session JSON</h3>
              <p className="mb-3 text-xs text-zinc-600">
                Upload a session export JSON. Groups, holes, and landmarks will be
                loaded from it automatically.
              </p>

              {sessionJson ? (
                <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <div>
                    <span className="font-mono text-xs text-zinc-800">
                      {sessionJsonName ?? "session.json"}
                    </span>
                    {courseName && (
                      <span className="ml-2 text-xs text-zinc-500">— {courseName}</span>
                    )}
                    {groups.length > 0 && (
                      <span className="ml-2 text-xs text-zinc-500">
                        · {groups.length} group{groups.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {holeOptions.length > 0 && (
                      <span className="ml-2 text-xs text-zinc-500">
                        · {holeOptions.length} hole{holeOptions.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => jsonInputRef.current?.click()}
                    className="ml-3 shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => jsonInputRef.current?.click()}
                  className="w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-4 text-center text-sm text-zinc-500 hover:bg-zinc-100"
                >
                  Click to upload session JSON
                </button>
              )}
              <input
                ref={jsonInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleJsonUpload}
              />
            </div>
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
