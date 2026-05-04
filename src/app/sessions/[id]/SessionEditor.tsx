"use client";

import Link from "next/link";
import { useMemo, useEffect, useState } from "react";
import {
  deleteSession,
  HoleInput,
  CourseLandmarkInput,
  SessionDetail,
  SessionGroupInput,
  SessionGroupPlayerRecord,
  SessionGroupRecord,
  SessionStatus,
  updateSession,
  UserSelectOption,
} from "../../actions";
import AdminNav from "@/components/AdminNav";
import { DownloadIcon, TrashIcon } from "@/components/ActionIcons";
import { useRouter } from "next/navigation";

type CourseOption = {
  id: string;
  name: string;
};

type GroupRow = {
  localId: string;
  label: string;
  teeTime: string;
  startHole: number;
  players: { userId: string; usingCarts: boolean }[];
};

type PacingEventType = "hole" | "off course";

type PacingRow = {
  id: string;
  groupId: string;
  eventType: PacingEventType | "";
  landmark: string;
  startTime: string;
  endTime: string;
};

type SessionEventType = "behind pace" | "group split" | "group join" | "leave course";

type SessionEventRow = {
  id: string;
  groupId: string;
  eventType: SessionEventType | "";
  landmark: string;
  time: string;
};

const PACING_EVENT_TYPES: PacingEventType[] = ["hole", "off course"];

const SESSION_EVENT_TYPES: SessionEventType[] = [
  "behind pace",
  "group split",
  "group join",
  "leave course",
];

const LANDMARK_LABELS: Record<string, string> = {
  putting_green: "Putting Green",
  clubhouse: "Clubhouse",
  driving_range: "Driving Range",
  other: "Other",
};

type LandmarkOption = { value: string; label: string };

function buildLandmarkOptions(
  holes: HoleInput[],
  landmarks: CourseLandmarkInput[]
): LandmarkOption[] {
  const options: LandmarkOption[] = holes.map((h) => ({
    value: `hole:${h.holeNumber}`,
    label: `Hole ${h.holeNumber}`,
  }));

  const typeCounts = new Map<string, number>();
  for (const l of landmarks) {
    typeCounts.set(l.landmarkType, (typeCounts.get(l.landmarkType) ?? 0) + 1);
  }

  const typeIndices = new Map<string, number>();
  for (const l of landmarks) {
    if (!l.id) continue;
    const idx = (typeIndices.get(l.landmarkType) ?? 0) + 1;
    typeIndices.set(l.landmarkType, idx);
    const base = LANDMARK_LABELS[l.landmarkType] ?? l.landmarkType;
    const count = typeCounts.get(l.landmarkType) ?? 1;
    options.push({
      value: `landmark:${l.id}`,
      label: count > 1 ? `${base} ${idx}` : base,
    });
  }

  return options;
}

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

function makeLocalId() {
  return Math.random().toString(36).slice(2);
}

function formatForDatetimeLocal(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function buildInitialGroups(
  groups: SessionGroupRecord[],
  groupPlayers: SessionGroupPlayerRecord[]
) {
  return groups.map((g) => ({
    localId: g.id,
    label: g.label ?? "",
    teeTime: formatForDatetimeLocal(g.tee_time),
    startHole: g.start_hole ?? 1,
    players: groupPlayers
      .filter((p) => p.group_id === g.id)
      .map((p) => ({ userId: p.user_id, usingCarts: p.using_carts })),
  }));
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

export default function SessionEditor({
  session,
  initialGroups,
  initialGroupPlayers,
  courses,
  users,
  courseHoles,
  courseLandmarks,
}: {
  session: SessionDetail;
  initialGroups: SessionGroupRecord[];
  initialGroupPlayers: SessionGroupPlayerRecord[];
  courses: CourseOption[];
  users: UserSelectOption[];
  courseHoles: HoleInput[];
  courseLandmarks: CourseLandmarkInput[];
}) {
  const router = useRouter();

  const [courseId, setCourseId] = useState(session.course_id);
  const [name, setName] = useState(session.name);
  const [sessionDate, setSessionDate] = useState(session.session_date ?? "");
  const [status, setStatus] = useState<SessionStatus>(session.status);
  const [groups, setGroups] = useState<GroupRow[]>(() =>
    buildInitialGroups(initialGroups, initialGroupPlayers)
  );
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Collapsible section state
  const [sectionsOpen, setSectionsOpen] = useState({
    sessionConfig: true,
    groupPacing: true,
    events: true,
  });

  function toggleSection(key: keyof typeof sectionsOpen) {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Group Pacing state
  const [pacingRows, setPacingRows] = useState<PacingRow[]>([]);
  const [pacingRowsLoaded, setPacingRowsLoaded] = useState(false);
  const pacingKey = `omnigolf-group-pacing-v1-${session.id}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(pacingKey);
      setPacingRows(raw ? (JSON.parse(raw) as PacingRow[]) : []);
    } catch {
      setPacingRows([]);
    }
    setPacingRowsLoaded(true);
  }, [pacingKey]);

  useEffect(() => {
    if (!pacingRowsLoaded) return;
    window.localStorage.setItem(pacingKey, JSON.stringify(pacingRows));
  }, [pacingRows, pacingRowsLoaded, pacingKey]);

  // Session Events state
  const [sessionEvents, setSessionEvents] = useState<SessionEventRow[]>([]);
  const [sessionEventsLoaded, setSessionEventsLoaded] = useState(false);
  const eventsKey = `omnigolf-session-events-v1-${session.id}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(eventsKey);
      setSessionEvents(raw ? (JSON.parse(raw) as SessionEventRow[]) : []);
    } catch {
      setSessionEvents([]);
    }
    setSessionEventsLoaded(true);
  }, [eventsKey]);

  useEffect(() => {
    if (!sessionEventsLoaded) return;
    window.localStorage.setItem(eventsKey, JSON.stringify(sessionEvents));
  }, [sessionEvents, sessionEventsLoaded, eventsKey]);

  // Landmark options
  const holeOptions = useMemo<LandmarkOption[]>(
    () =>
      courseHoles.map((h) => ({
        value: `hole:${h.holeNumber}`,
        label: `Hole ${h.holeNumber}`,
      })),
    [courseHoles]
  );

  const offCourseOptions = useMemo<LandmarkOption[]>(
    () =>
      buildLandmarkOptions(
        [],
        courseLandmarks.filter((l) =>
          ["putting_green", "driving_range", "clubhouse"].includes(l.landmarkType)
        )
      ),
    [courseLandmarks]
  );

  const allLandmarkOptions = useMemo<LandmarkOption[]>(
    () => buildLandmarkOptions(courseHoles, courseLandmarks),
    [courseHoles, courseLandmarks]
  );

  function getLandmarkOptionsForPacingEvent(eventType: PacingEventType | ""): LandmarkOption[] {
    if (eventType === "hole") return holeOptions;
    if (eventType === "off course") return offCourseOptions;
    return [];
  }

  function computeGroupsAtHole(holeNumber: number, excludeEventId?: string): GroupRow[] {
    const splitJoins = sessionEvents
      .filter(
        (ev) =>
          ev.id !== excludeEventId &&
          (ev.eventType === "group split" || ev.eventType === "group join") &&
          ev.landmark.startsWith("hole:")
      )
      .map((ev) => ({ ...ev, holeNum: parseInt(ev.landmark.split(":")[1], 10) }))
      .filter((ev) => !isNaN(ev.holeNum) && ev.holeNum <= holeNumber)
      .sort((a, b) => a.holeNum - b.holeNum);

    let gs: GroupRow[] = [...groups];
    for (const ev of splitJoins) {
      if (ev.eventType === "group split") {
        const g = gs.find((x) => x.localId === ev.groupId);
        if (g) {
          gs = gs.filter((x) => x.localId !== ev.groupId);
          gs.push(
            { localId: `${ev.groupId}-a`, label: `${g.label}a`, teeTime: g.teeTime, startHole: g.startHole, players: [] },
            { localId: `${ev.groupId}-b`, label: `${g.label}b`, teeTime: g.teeTime, startHole: g.startHole, players: [] }
          );
        }
      } else if (ev.eventType === "group join") {
        gs = gs.filter((x) => x.localId !== ev.groupId);
      }
    }
    return gs;
  }

  // Group Pacing row functions
  function addPacingRow() {
    setPacingRows((prev) => [
      ...prev,
      { id: makeLocalId(), groupId: "", eventType: "", landmark: "", startTime: "", endTime: "" },
    ]);
  }

  function updatePacingRow(
    id: string,
    field: keyof Omit<PacingRow, "id">,
    value: string
  ) {
    setPacingRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        if (field === "eventType") {
          const opts = getLandmarkOptionsForPacingEvent(updated.eventType as PacingEventType);
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

  function removePacingRow(id: string) {
    setPacingRows((prev) => prev.filter((r) => r.id !== id));
  }

  // Session Event row functions
  function addSessionEvent() {
    setSessionEvents((prev) => [
      ...prev,
      { id: makeLocalId(), groupId: "", eventType: "", landmark: "", time: "" },
    ]);
  }

  function updateSessionEvent(
    id: string,
    field: keyof Omit<SessionEventRow, "id">,
    value: string
  ) {
    setSessionEvents((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        const updated = { ...e, [field]: value };
        if (field === "eventType") {
          if (updated.eventType === "leave course") {
            updated.landmark = "";
          } else {
            updated.time = "";
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

  function removeSessionEvent(id: string) {
    setSessionEvents((prev) => prev.filter((e) => e.id !== id));
  }

  // Group helpers
  const usersById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  const assignedUserIds = useMemo(
    () => new Set(groups.flatMap((g) => g.players.map((p) => p.userId))),
    [groups]
  );

  const canSave = useMemo(() => {
    if (!courseId) return false;
    if (!name.trim()) return false;
    return true;
  }, [courseId, name]);

  function addGroup() {
    setGroups((prev) => [
      ...prev,
      { localId: makeLocalId(), label: "", teeTime: "", startHole: 1, players: [] },
    ]);
  }

  function removeGroup(localId: string) {
    setGroups((prev) => prev.filter((g) => g.localId !== localId));
  }

  function updateGroup(localId: string, field: "label" | "teeTime", value: string) {
    setGroups((prev) =>
      prev.map((g) => (g.localId === localId ? { ...g, [field]: value } : g))
    );
  }

  function updateGroupStartHole(localId: string, startHole: number) {
    setGroups((prev) =>
      prev.map((g) => (g.localId === localId ? { ...g, startHole } : g))
    );
  }

  function assignPlayerToGroup(userId: string, localId: string) {
    if (!userId) return;
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        players:
          g.localId === localId
            ? g.players.some((p) => p.userId === userId)
              ? g.players
              : [...g.players, { userId, usingCarts: false }]
            : g.players.filter((p) => p.userId !== userId),
      }))
    );
  }

  function unassignPlayerFromGroup(userId: string, localId: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.localId === localId
          ? { ...g, players: g.players.filter((p) => p.userId !== userId) }
          : g
      )
    );
  }

  function togglePlayerUsingCarts(userId: string, localId: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.localId === localId
          ? {
              ...g,
              players: g.players.map((p) =>
                p.userId === userId ? { ...p, usingCarts: !p.usingCarts } : p
              ),
            }
          : g
      )
    );
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function toPayload(): SessionGroupInput[] {
    return groups.map((g) => ({
      id: uuidPattern.test(g.localId) ? g.localId : undefined,
      label: g.label.trim() || undefined,
      teeTime: g.teeTime ? new Date(g.teeTime).toISOString() : undefined,
      startHole: g.startHole,
      players: g.players,
    }));
  }

  async function onSave() {
    setMessage("");
    setIsSaving(true);
    try {
      await updateSession({
        sessionId: session.id,
        courseId,
        name,
        sessionDate: sessionDate || undefined,
        status,
        groups: toPayload(),
      });
      setMessage("✅ Saved changes.");
    } catch (e: any) {
      setMessage(`❌ ${e?.message ?? "Failed to save session"}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function onDownload() {
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}/export`);
      const data = await response.json();

      const labelMap = new Map(allLandmarkOptions.map((o) => [o.value, o.label]));
      const groupLabelMap = new Map(
        groups.map((g, i) => [g.localId, g.label.trim() || `Group ${i + 1}`])
      );

      data.group_pacing = pacingRows.map((r) => ({
        group_id: r.groupId || null,
        group_label: r.groupId ? (groupLabelMap.get(r.groupId) ?? null) : null,
        event_type: r.eventType,
        landmark: r.landmark || null,
        landmark_label: r.landmark ? (labelMap.get(r.landmark) ?? r.landmark) : null,
        start_time: r.startTime || null,
        end_time: r.endTime || null,
      }));

      data.events = sessionEvents.map((e) => ({
        group_id: e.groupId || null,
        group_label: e.groupId ? (groupLabelMap.get(e.groupId) ?? null) : null,
        event_type: e.eventType,
        landmark: e.landmark || null,
        landmark_label: e.landmark ? (labelMap.get(e.landmark) ?? e.landmark) : null,
        time: e.time || null,
      }));

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session_${session.id}_export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      window.alert(`Download failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setIsDownloading(false);
    }
  }

  async function onDelete() {
    const confirmed = window.confirm(
      `Delete "${session.name}"? This will remove the session and all groups. This cannot be undone.`
    );
    if (!confirmed) return;

    setMessage("");
    setIsDeleting(true);
    try {
      await deleteSession(session.id);
      router.push("/sessions");
      router.refresh();
    } catch (e: any) {
      setMessage(`❌ ${e?.message ?? "Failed to delete session"}`);
    } finally {
      setIsDeleting(false);
    }
  }

  const thClass =
    "border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600";

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="sessions" />

        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Edit Session</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Update session details, record group pacing, and log session events.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/sessions"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              ← Back to sessions
            </Link>
            <button
              type="button"
              onClick={onDownload}
              disabled={isDownloading}
              aria-label="Download JSON"
              title={isDownloading ? "Downloading" : "Download JSON"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              <DownloadIcon />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label="Delete"
              title={isDeleting ? "Deleting" : "Delete"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 shadow-sm hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* ── Section: Session Configurations ── */}
        <div className="mb-3">
          <SectionHeader
            title="Session Configurations"
            open={sectionsOpen.sessionConfig}
            onToggle={() => toggleSection("sessionConfig")}
          />
        </div>

        {sectionsOpen.sessionConfig && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            {/* Session metadata */}
            <div className="mb-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700">Session name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass + " w-full"}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700">Course</label>
                <select
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  className={inputClass + " w-full"}
                >
                  <option value="">Select a course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700">Session date</label>
                <input
                  type="date"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                  className={inputClass + " w-full"}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SessionStatus)}
                  className={inputClass + " w-full"}
                >
                  <option value="planned">planned</option>
                  <option value="active">active</option>
                  <option value="completed">completed</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </div>
            </div>

            <hr className="mb-6 border-zinc-200" />

            {/* Groupings subsection */}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Groupings</h3>
                <p className="mt-1 text-xs text-zinc-600">
                  Add groups, edit their labels, and assign players directly into them.
                </p>
              </div>
              <button
                type="button"
                onClick={addGroup}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              >
                + Add group
              </button>
            </div>

            <div className="space-y-4">
              {groups.length === 0 ? (
                <div className="text-sm text-zinc-500">No groups yet.</div>
              ) : (
                groups.map((group, index) => (
                  <div
                    key={group.localId}
                    className="rounded-xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-zinc-900">Group {index + 1}</div>
                      <button
                        type="button"
                        onClick={() => removeGroup(group.localId)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        Remove group
                      </button>
                    </div>

                    <div className="mb-3">
                      <label className="mb-2 block text-sm font-medium text-zinc-700">Group label</label>
                      <input
                        value={group.label}
                        onChange={(e) => updateGroup(group.localId, "label", e.target.value)}
                        placeholder="e.g. Group A"
                        className={inputClass + " w-full max-w-sm"}
                      />
                    </div>

                    <div className="mb-3">
                      <label className="mb-2 block text-sm font-medium text-zinc-700">Tee time</label>
                      <input
                        type="datetime-local"
                        value={group.teeTime}
                        onChange={(e) => updateGroup(group.localId, "teeTime", e.target.value)}
                        className={inputClass + " w-full max-w-sm"}
                      />
                    </div>

                    <div className="mb-3">
                      <label className="mb-2 block text-sm font-medium text-zinc-700">Start hole</label>
                      <select
                        value={group.startHole}
                        onChange={(e) => updateGroupStartHole(group.localId, Number(e.target.value))}
                        className={inputClass + " w-full max-w-sm"}
                      >
                        {Array.from({ length: 18 }, (_, i) => i + 1).map((hole) => (
                          <option key={hole} value={hole}>
                            Hole {hole}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mb-3">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const userId = e.target.value;
                          if (userId) assignPlayerToGroup(userId, group.localId);
                          e.currentTarget.value = "";
                        }}
                        className={inputClass + " w-full max-w-sm"}
                      >
                        <option value="">Add player to this group</option>
                        {users
                          .filter(
                            (user) =>
                              !assignedUserIds.has(user.id) ||
                              group.players.some((p) => p.userId === user.id)
                          )
                          .map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.label}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      {group.players.length === 0 ? (
                        <div className="text-xs text-zinc-500">No players assigned yet.</div>
                      ) : (
                        group.players.map(({ userId, usingCarts }) => (
                          <div
                            key={userId}
                            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2"
                          >
                            <div className="text-sm text-zinc-900">
                              {usersById.get(userId)?.label ?? userId}
                            </div>
                            <div className="flex items-center gap-3">
                              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 select-none">
                                <input
                                  type="checkbox"
                                  checked={usingCarts}
                                  onChange={() => togglePlayerUsingCarts(userId, group.localId)}
                                  className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-900"
                                />
                                Using cart
                              </label>
                              <button
                                type="button"
                                onClick={() => unassignPlayerFromGroup(userId, group.localId)}
                                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-50"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Section: Group Pacing ── */}
        <div className="mb-3">
          <SectionHeader
            title="Group Pacing"
            open={sectionsOpen.groupPacing}
            onToggle={() => toggleSection("groupPacing")}
          />
        </div>

        {sectionsOpen.groupPacing && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            {status !== "completed" ? (
              <p className="text-sm text-zinc-500">
                Group pacing is editable once the session is marked as{" "}
                <span className="font-medium">completed</span>.
              </p>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-4">
                  <p className="text-xs text-zinc-600">
                    Record each group&apos;s hole-by-hole pacing. Saved automatically.
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
                                  {getLandmarkOptionsForPacingEvent(row.eventType).map((o) => (
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
              </>
            )}
          </div>
        )}

        {/* ── Section: Events ── */}
        <div className="mb-3">
          <SectionHeader
            title="Events"
            open={sectionsOpen.events}
            onToggle={() => toggleSection("events")}
          />
        </div>

        {sectionsOpen.events && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <p className="text-xs text-zinc-600">
                Log session-level events. Saved automatically.
              </p>
              <button
                type="button"
                onClick={addSessionEvent}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              >
                + Add event
              </button>
            </div>

            {sessionEvents.length === 0 ? (
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
                    {sessionEvents.map((event) => {
                      const isLeave = event.eventType === "leave course";
                      const holeNum =
                        !isLeave && event.landmark.startsWith("hole:")
                          ? parseInt(event.landmark.split(":")[1], 10)
                          : null;
                      const groupsForRow =
                        isLeave || event.landmark === "off course"
                          ? groups
                          : holeNum !== null
                          ? computeGroupsAtHole(holeNum, event.id)
                          : [];
                      const landmarkEnabled = event.eventType !== "" && !isLeave;
                      const groupEnabled =
                        event.eventType !== "" && (isLeave || event.landmark !== "");
                      const dc = " disabled:opacity-40 disabled:cursor-not-allowed";
                      const eventLandmarkOpts: LandmarkOption[] = [
                        { value: "off course", label: "Off course" },
                        ...holeOptions,
                      ];
                      return (
                        <tr key={event.id} className="border-b border-zinc-100 last:border-0">
                          <td className="px-3 py-2">
                            <select
                              value={event.eventType}
                              onChange={(e) => updateSessionEvent(event.id, "eventType", e.target.value)}
                              className={inputClass + " w-full"}
                            >
                              <option value="">— select —</option>
                              {SESSION_EVENT_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {!isLeave ? (
                              <select
                                value={event.landmark}
                                onChange={(e) => updateSessionEvent(event.id, "landmark", e.target.value)}
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
                              value={event.groupId}
                              onChange={(e) => updateSessionEvent(event.id, "groupId", e.target.value)}
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
                                value={event.time}
                                onChange={(e) => updateSessionEvent(event.id, "time", e.target.value)}
                                className={inputClass}
                              />
                            ) : (
                              <span className="text-sm text-zinc-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeSessionEvent(event.id)}
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
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save changes"}
          </button>
          <div className="text-xs font-mono text-zinc-700">{message}</div>
        </div>
      </div>
    </main>
  );
}
