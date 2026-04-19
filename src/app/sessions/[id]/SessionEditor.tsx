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
import { useRouter } from "next/navigation";

type CourseOption = {
  id: string;
  name: string;
};

type GroupRow = {
  localId: string;
  label: string;
  teeTime: string;
  playerUserIds: string[];
};

type EventType =
  | "start hole"
  | "finish hole"
  | "behind pace"
  | "group join"
  | "group split"
  | "off course"
  | "leave course";

type AnswerEventRow = {
  id: string;
  groupId: string;
  eventType: EventType;
  landmark: string;
  time: string;
};

const EVENT_TYPES: EventType[] = [
  "start hole",
  "finish hole",
  "behind pace",
  "group join",
  "group split",
  "off course",
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
    playerUserIds: groupPlayers
      .filter((p) => p.group_id === g.id)
      .map((p) => p.user_id),
  }));
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

  // Answer sheet state
  const [answerEvents, setAnswerEvents] = useState<AnswerEventRow[]>([]);
  const [answerEventsLoaded, setAnswerEventsLoaded] = useState(false);

  const answerSheetKey = `omnigolf-answer-sheet-v1-${session.id}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(answerSheetKey);
      setAnswerEvents(raw ? (JSON.parse(raw) as AnswerEventRow[]) : []);
    } catch {
      setAnswerEvents([]);
    }
    setAnswerEventsLoaded(true);
  }, [answerSheetKey]);

  useEffect(() => {
    if (!answerEventsLoaded) return;
    window.localStorage.setItem(answerSheetKey, JSON.stringify(answerEvents));
  }, [answerEvents, answerEventsLoaded, answerSheetKey]);

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

  function getLandmarkOptionsForEventType(eventType: EventType): LandmarkOption[] {
    if (
      eventType === "start hole" ||
      eventType === "finish hole" ||
      eventType === "behind pace" ||
      eventType === "group join" ||
      eventType === "group split"
    ) {
      return holeOptions;
    }
    if (eventType === "off course") {
      return offCourseOptions;
    }
    return allLandmarkOptions;
  }

  function addAnswerEvent() {
    setAnswerEvents((prev) => [
      ...prev,
      { id: makeLocalId(), groupId: "", eventType: "start hole", landmark: "", time: "" },
    ]);
  }

  function updateAnswerEvent(
    id: string,
    field: keyof Omit<AnswerEventRow, "id">,
    value: string
  ) {
    setAnswerEvents((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        const updated = { ...e, [field]: value };
        if (field === "eventType") {
          const opts = getLandmarkOptionsForEventType(updated.eventType as EventType);
          if (updated.landmark && !opts.some((o) => o.value === updated.landmark)) {
            updated.landmark = "";
          }
        }
        return updated;
      })
    );
  }

  function removeAnswerEvent(id: string) {
    setAnswerEvents((prev) => prev.filter((e) => e.id !== id));
  }

  const usersById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  const assignedUserIds = useMemo(
    () => new Set(groups.flatMap((g) => g.playerUserIds)),
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
      { localId: makeLocalId(), label: "", teeTime: "", playerUserIds: [] },
    ]);
  }

  function removeGroup(localId: string) {
    setGroups((prev) => prev.filter((g) => g.localId !== localId));
  }

  function updateGroup(
    localId: string,
    field: "label" | "teeTime",
    value: string
  ) {
    setGroups((prev) =>
      prev.map((g) => (g.localId === localId ? { ...g, [field]: value } : g))
    );
  }

  function assignPlayerToGroup(userId: string, localId: string) {
    if (!userId) return;

    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        playerUserIds:
          g.localId === localId
            ? g.playerUserIds.includes(userId)
              ? g.playerUserIds
              : [...g.playerUserIds, userId]
            : g.playerUserIds.filter((id) => id !== userId),
      }))
    );
  }

  function unassignPlayerFromGroup(userId: string, localId: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.localId === localId
          ? {
              ...g,
              playerUserIds: g.playerUserIds.filter((id) => id !== userId),
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
      playerUserIds: g.playerUserIds,
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

      data.events_answer_sheet = answerEvents.map((e) => ({
        group_id: e.groupId || null,
        group_label: e.groupId ? (groupLabelMap.get(e.groupId) ?? null) : null,
        event_type: e.eventType,
        landmark: e.landmark || null,
        landmark_label: e.landmark ? (labelMap.get(e.landmark) ?? e.landmark) : null,
        time: e.time || null,
      }));

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
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

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="sessions" />

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Edit Session</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Update the session details and assign players directly into groups.
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
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {isDownloading ? "Downloading..." : "Download JSON"}
            </button>

            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete session"}
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700">
                Session name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass + " w-full"}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700">
                Course
              </label>
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
              <label className="mb-2 block text-sm font-medium text-zinc-700">
                Session date
              </label>
              <input
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className={inputClass + " w-full"}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700">
                Status
              </label>
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
        </div>

        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Groups</h2>
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
                    <div className="text-sm font-semibold text-zinc-900">
                      Group {index + 1}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeGroup(group.localId)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      Remove group
                    </button>
                  </div>

                  <div className="mb-3">
                    <label className="mb-2 block text-sm font-medium text-zinc-700">
                      Group label
                    </label>
                    <input
                      value={group.label}
                      onChange={(e) =>
                        updateGroup(group.localId, "label", e.target.value)
                      }
                      placeholder="e.g. Group A"
                      className={inputClass + " w-full max-w-sm"}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="mb-2 block text-sm font-medium text-zinc-700">
                      Tee time
                    </label>
                    <input
                      type="datetime-local"
                      value={group.teeTime}
                      onChange={(e) =>
                        updateGroup(group.localId, "teeTime", e.target.value)
                      }
                      className={inputClass + " w-full max-w-sm"}
                    />
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
                            group.playerUserIds.includes(user.id)
                        )
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.label}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    {group.playerUserIds.length === 0 ? (
                      <div className="text-xs text-zinc-500">
                        No players assigned to this group yet.
                      </div>
                    ) : (
                      group.playerUserIds.map((userId) => (
                        <div
                          key={userId}
                          className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2"
                        >
                          <div className="text-sm text-zinc-900">
                            {usersById.get(userId)?.label ?? userId}
                          </div>

                          <button
                            type="button"
                            onClick={() => unassignPlayerFromGroup(userId, group.localId)}
                            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save changes"}
          </button>

          <div className="text-xs font-mono text-zinc-700">{message}</div>
        </div>

        {status === "completed" && (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">Answer Sheet</h2>
                <p className="mt-1 text-xs text-zinc-600">
                  Record observed events to compare against pacing script output. Saved automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={addAnswerEvent}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              >
                + Add event
              </button>
            </div>

            {answerEvents.length === 0 ? (
              <div className="text-sm text-zinc-500">
                No events yet. Click &ldquo;+ Add event&rdquo; to record what happened during this round.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full min-w-[600px] border-collapse">
                  <thead>
                    <tr className="bg-zinc-50">
                      <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Group
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Event Type
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Landmark
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Time
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {answerEvents.map((event) => (
                      <tr key={event.id} className="border-b border-zinc-100 last:border-0">
                        <td className="px-3 py-2">
                          <select
                            value={event.groupId}
                            onChange={(e) =>
                              updateAnswerEvent(event.id, "groupId", e.target.value)
                            }
                            className={inputClass + " w-full"}
                          >
                            <option value="">—</option>
                            {groups.map((g, i) => (
                              <option key={g.localId} value={g.localId}>
                                {g.label.trim() || `Group ${i + 1}`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={event.eventType}
                            onChange={(e) =>
                              updateAnswerEvent(event.id, "eventType", e.target.value)
                            }
                            className={inputClass + " w-full"}
                          >
                            {EVENT_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={event.landmark}
                            onChange={(e) =>
                              updateAnswerEvent(event.id, "landmark", e.target.value)
                            }
                            className={inputClass + " w-full"}
                          >
                            <option value="">—</option>
                            {getLandmarkOptionsForEventType(event.eventType).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="time"
                            value={event.time}
                            onChange={(e) =>
                              updateAnswerEvent(event.id, "time", e.target.value)
                            }
                            className={inputClass}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeAnswerEvent(event.id)}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
