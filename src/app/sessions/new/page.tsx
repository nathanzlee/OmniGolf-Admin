"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  createSession,
  listCoursesForSelect,
  listUsersForSelect,
  SessionGroupInput,
  SessionStatus,
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

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

function makeLocalId() {
  return Math.random().toString(36).slice(2);
}

export default function NewSessionPage() {
  const router = useRouter();

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [users, setUsers] = useState<UserSelectOption[]>([]);
  const [courseId, setCourseId] = useState("");
  const [name, setName] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [status, setStatus] = useState<SessionStatus>("planned");
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const usersById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  useEffect(() => {
    async function loadData() {
      try {
        const [courseResult, userResult] = await Promise.all([
          listCoursesForSelect(),
          listUsersForSelect(),
        ]);
        setCourses(courseResult);
        setUsers(userResult);
      } catch (e: any) {
        setMessage(`❌ ${e?.message ?? "Failed to load form data"}`);
      }
    }

    void loadData();
  }, []);

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

  function toPayload(): SessionGroupInput[] {
    return groups.map((g) => ({
      label: g.label.trim() || undefined,
      teeTime: g.teeTime ? new Date(g.teeTime).toISOString() : undefined,
      playerUserIds: g.playerUserIds,
    }));
  }

  async function onSave() {
    setMessage("");
    setIsSaving(true);

    try {
      const result = await createSession({
        courseId,
        name,
        sessionDate: sessionDate || undefined,
        status,
        groups: toPayload(),
      });

      router.replace(`/sessions/${result.sessionId}`);
    } catch (e: any) {
      setMessage(`❌ ${e?.message ?? "Failed to save session"}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="sessions" />

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Add a Session</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Create a session and assign players directly into groups.
            </p>
          </div>

          <Link
            href="/sessions"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            ← Back to sessions
          </Link>
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
                placeholder="e.g. Harding Park Saturday Round"
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
                Add groups, set labels, and assign players directly into them.
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

        <div className="flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Create session"}
          </button>

          <div className="text-xs font-mono text-zinc-700">{message}</div>
        </div>
      </div>
    </main>
  );
}