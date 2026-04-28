"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { LocationPin, ViewTarget } from "./TestCaseBuilderMap";

const TestCaseBuilderMap = dynamic(() => import("./TestCaseBuilderMap"), { ssr: false });

const GROUP_COLORS = [
  "#2563eb", "#16a34a", "#dc2626", "#9333ea",
  "#ea580c", "#0891b2", "#be185d", "#ca8a04",
];
const UNASSIGNED_COLOR = "#6b7280";

function makeId() {
  return Math.random().toString(36).slice(2);
}

type CourseOption = { id: string; name: string };
type MockGroup = { localId: string; label: string; teeTime: string }; // teeTime: datetime-local or ""
type MockPlayer = { localId: string; name: string; groupId: string | null };
type Snapshot = { localId: string; timestamp: string; sourceGroupId: string | null };
type MockLocation = { localId: string; snapshotId: string; playerId: string; lat: number; lng: number };

function defaultTimestamp() {
  const now = new Date();
  now.setSeconds(0, 0);
  return now.toISOString().slice(0, 16);
}

function advanceByMinutes(ts: string, minutes: number) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().slice(0, 16);
}

export default function TestCaseBuilder({ courseOptions }: { courseOptions: CourseOption[] }) {
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedCourseName, setSelectedCourseName] = useState("");
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);

  const [groups, setGroups] = useState<MockGroup[]>([]);
  const [players, setPlayers] = useState<MockPlayer[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [locations, setLocations] = useState<MockLocation[]>([]);

  const [activeSnapshotIdx, setActiveSnapshotIdx] = useState(0);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeSnapshot = snapshots[activeSnapshotIdx] ?? null;

  // ── Derived ───────────────────────────────────────────────────

  const groupColorMap = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach((g, i) => m.set(g.localId, GROUP_COLORS[i % GROUP_COLORS.length]));
    return m;
  }, [groups]);

  function playerColor(p: MockPlayer) {
    return p.groupId ? (groupColorMap.get(p.groupId) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR;
  }

  function isBlockedAtSnapshot(snap: Snapshot | null, player: MockPlayer): boolean {
    if (!snap || !player.groupId) return false;
    const group = groups.find((g) => g.localId === player.groupId);
    if (!group?.teeTime) return false;
    return snap.timestamp < group.teeTime;
  }

  const snapshotLocs = useMemo(
    () => (activeSnapshot ? locations.filter((l) => l.snapshotId === activeSnapshot.localId) : []),
    [locations, activeSnapshot]
  );

  const filteredPlayers = useMemo(() => {
    if (activePlayerId) return players.filter((p) => p.localId === activePlayerId);
    if (activeGroupId) return players.filter((p) => p.groupId === activeGroupId);
    return players;
  }, [players, activePlayerId, activeGroupId]);

  const activePlayerObj = players.find((p) => p.localId === activePlayerId) ?? null;
  const isCurrentPlayerBlocked = activePlayerObj ? isBlockedAtSnapshot(activeSnapshot, activePlayerObj) : false;
  const isPlacing = !!activePlayerId && !!activeSnapshot && !isCurrentPlayerBlocked;

  const pins = useMemo<LocationPin[]>(() => {
    return filteredPlayers.flatMap((player) => {
      const loc = snapshotLocs.find((l) => l.playerId === player.localId);
      if (!loc) return [];
      return [{
        id: loc.localId,
        lat: loc.lat,
        lng: loc.lng,
        color: playerColor(player),
        isActivePlayer: player.localId === activePlayerId,
        playerName: player.name || "Player",
      }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPlayers, snapshotLocs, activePlayerId, groupColorMap]);

  // ── Course ────────────────────────────────────────────────────

  async function handleCourseChange(courseId: string) {
    setSelectedCourseId(courseId);
    if (!courseId) { setSelectedCourseName(""); return; }
    setSelectedCourseName(courseOptions.find((c) => c.id === courseId)?.name ?? "");
    setLoadingCourse(true);
    try {
      const data = await fetch(`/api/courses/${courseId}/data`).then((r) => r.json());
      const latlngs: [number, number][] = (data.holes ?? []).flatMap(
        (h: { teeLat: number; teeLng: number; greenLat: number; greenLng: number }) => [
          [h.teeLat, h.teeLng] as [number, number],
          [h.greenLat, h.greenLng] as [number, number],
        ]
      );
      if (latlngs.length > 0) setViewTarget({ key: Date.now(), latlngs });
    } catch { /* ignore */ } finally { setLoadingCourse(false); }
  }

  // ── Groups ────────────────────────────────────────────────────

  function addGroup() {
    setGroups((prev) => [...prev, { localId: makeId(), label: `Group ${prev.length + 1}`, teeTime: "" }]);
  }

  function updateGroup(id: string, patch: Partial<MockGroup>) {
    setGroups((prev) => prev.map((g) => (g.localId === id ? { ...g, ...patch } : g)));

    if ("teeTime" in patch) {
      const newTeeTime = patch.teeTime ?? "";
      const existingSnap = snapshots.find((s) => s.sourceGroupId === id);

      if (!newTeeTime) {
        // Tee time cleared — remove the auto-snapshot and its locations
        if (existingSnap) {
          setLocations((prev) => prev.filter((l) => l.snapshotId !== existingSnap.localId));
          setSnapshots((prev) => {
            const next = prev.filter((s) => s.localId !== existingSnap.localId);
            setActiveSnapshotIdx((cur) => Math.min(cur, Math.max(0, next.length - 1)));
            return next;
          });
        }
      } else if (existingSnap) {
        // Update the existing auto-snapshot's timestamp
        setSnapshots((prev) => prev.map((s) => s.localId === existingSnap.localId ? { ...s, timestamp: newTeeTime } : s));
      } else {
        // Create a new auto-snapshot for this group's tee time
        setSnapshots((prev) => [...prev, { localId: makeId(), timestamp: newTeeTime, sourceGroupId: id }]);
      }
    }
  }

  function removeGroup(id: string) {
    const snap = snapshots.find((s) => s.sourceGroupId === id);
    if (snap) {
      setLocations((prev) => prev.filter((l) => l.snapshotId !== snap.localId));
      setSnapshots((prev) => {
        const next = prev.filter((s) => s.localId !== snap.localId);
        setActiveSnapshotIdx((cur) => Math.min(cur, Math.max(0, next.length - 1)));
        return next;
      });
    }
    setGroups((prev) => prev.filter((g) => g.localId !== id));
    // Re-assign players to the first remaining group
    setGroups((prev) => {
      const firstRemaining = prev[0]?.localId ?? null;
      setPlayers((pp) => pp.map((p) => (p.groupId === id ? { ...p, groupId: firstRemaining } : p)));
      return prev;
    });
    if (activeGroupId === id) setActiveGroupId(null);
  }

  function toggleGroupFilter(id: string) {
    setActiveGroupId((prev) => (prev === id ? null : id));
    setActivePlayerId(null);
  }

  // ── Players ───────────────────────────────────────────────────

  function addPlayer() {
    const p: MockPlayer = {
      localId: makeId(),
      name: `Player ${players.length + 1}`,
      groupId: groups[0]?.localId ?? null,
    };
    setPlayers((prev) => [...prev, p]);
  }

  function updatePlayer(id: string, patch: Partial<MockPlayer>) {
    setPlayers((prev) => prev.map((p) => (p.localId === id ? { ...p, ...patch } : p)));
  }

  function removePlayer(id: string) {
    setPlayers((prev) => prev.filter((p) => p.localId !== id));
    setLocations((prev) => prev.filter((l) => l.playerId !== id));
    if (activePlayerId === id) setActivePlayerId(null);
  }

  function togglePlayerSelect(id: string, blocked: boolean) {
    if (blocked) return;
    setActivePlayerId((prev) => (prev === id ? null : id));
    setActiveGroupId(null);
  }

  // ── Snapshots ─────────────────────────────────────────────────

  function addSnapshot() {
    const lastTs = snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : defaultTimestamp();
    const ts = snapshots.length > 0 ? advanceByMinutes(lastTs, 5) : lastTs;
    setSnapshots((prev) => {
      const next = [...prev, { localId: makeId(), timestamp: ts, sourceGroupId: null }];
      setActiveSnapshotIdx(next.length - 1);
      return next;
    });
  }

  function removeSnapshot(idx: number) {
    const snap = snapshots[idx];
    setLocations((prev) => prev.filter((l) => l.snapshotId !== snap.localId));
    setSnapshots((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setActiveSnapshotIdx((cur) => Math.min(cur, Math.max(0, next.length - 1)));
      return next;
    });
  }

  function updateSnapshotTs(idx: number, ts: string) {
    setSnapshots((prev) => prev.map((s, i) => (i === idx ? { ...s, timestamp: ts } : s)));
  }

  // ── Map click ─────────────────────────────────────────────────

  function handleMapClick(lat: number, lng: number) {
    if (!isPlacing || !activePlayerId || !activeSnapshot) return;
    setLocations((prev) => [
      ...prev.filter((l) => !(l.snapshotId === activeSnapshot.localId && l.playerId === activePlayerId)),
      { localId: makeId(), snapshotId: activeSnapshot.localId, playerId: activePlayerId, lat, lng },
    ]);
  }

  function clearPlayerLoc(playerId: string) {
    if (!activeSnapshot) return;
    setLocations((prev) =>
      prev.filter((l) => !(l.snapshotId === activeSnapshot.localId && l.playerId === playerId))
    );
  }

  // ── Export ────────────────────────────────────────────────────

  function buildSessionJson() {
    const sorted = [...snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      session_id: makeId(),
      session_name: "Mock Session",
      course_id: selectedCourseId || "",
      course_name: selectedCourseName || "",
      holes: [],
      course_landmarks: [],
      groups: groups.map((g) => ({
        group_id: g.localId,
        label: g.label,
        tee_time: g.teeTime || null,
        players: players.filter((p) => p.groupId === g.localId).map((p) => ({ user_id: p.localId, using_carts: false })),
      })),
      players: players.map((p) => ({
        user_id: p.localId,
        email: p.name || p.localId,
        locations: sorted.flatMap((snap) => {
          const loc = locations.find((l) => l.snapshotId === snap.localId && l.playerId === p.localId);
          if (!loc) return [];
          return [{ id: makeId(), recorded_at: new Date(snap.timestamp).toISOString(), latitude: loc.lat, longitude: loc.lng, horizontal_accuracy: null }];
        }),
      })),
    };
  }

  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(buildSessionJson(), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const inputCls = "rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-900 outline-none focus:border-zinc-400 focus:bg-white";

  // Label to show next to snapshot in the scroller (group name if auto-created)
  const activeSnapSourceGroup = activeSnapshot?.sourceGroupId
    ? groups.find((g) => g.localId === activeSnapshot.sourceGroupId)
    : null;

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* ── Left panel ── */}
      <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto pr-1">

        {/* Course */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-900">Course</h2>
          </div>
          <div className="px-3 py-2">
            <select
              value={selectedCourseId}
              onChange={(e) => handleCourseChange(e.target.value)}
              disabled={loadingCourse}
              className={`${inputCls} w-full`}
            >
              <option value="">— Select a course —</option>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {loadingCourse && <p className="mt-1 text-xs text-zinc-400">Loading course…</p>}
          </div>
        </div>

        {/* Groups */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-900">Groups</h2>
            <button type="button" onClick={addGroup} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">+ Add</button>
          </div>
          {groups.length === 0 ? (
            <p className="px-4 py-3 text-xs text-zinc-400">No groups yet.</p>
          ) : (
            <div className="max-h-36 divide-y divide-zinc-100 overflow-y-auto">
              {groups.map((g, i) => {
                const isFiltered = activeGroupId === g.localId;
                return (
                  <div
                    key={g.localId}
                    onClick={() => toggleGroupFilter(g.localId)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors ${isFiltered ? "bg-blue-50" : "hover:bg-zinc-50"}`}
                  >
                    <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }} />
                    <input
                      value={g.label}
                      onChange={(e) => updateGroup(g.localId, { label: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Label"
                      className={`${inputCls} min-w-0 flex-1`}
                    />
                    <input
                      type="datetime-local"
                      value={g.teeTime}
                      onChange={(e) => updateGroup(g.localId, { teeTime: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      title="Tee time"
                      className={`${inputCls} w-36 shrink-0`}
                    />
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeGroup(g.localId); }} className="shrink-0 text-xs text-zinc-300 hover:text-red-500">✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Players */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-900">Players</h2>
            <button type="button" onClick={addPlayer} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">+ Add</button>
          </div>
          {players.length === 0 ? (
            <p className="px-4 py-3 text-xs text-zinc-400">No players yet.</p>
          ) : (
            <div className="max-h-40 divide-y divide-zinc-100 overflow-y-auto">
              {players.map((p) => {
                const color = playerColor(p);
                const isActive = p.localId === activePlayerId;
                return (
                  <div
                    key={p.localId}
                    onClick={() => togglePlayerSelect(p.localId, false)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors ${isActive ? "bg-blue-50" : "hover:bg-zinc-50"}`}
                  >
                    <div className="h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm" style={{ background: color }} />
                    <input
                      value={p.name}
                      onChange={(e) => { e.stopPropagation(); updatePlayer(p.localId, { name: e.target.value }); }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Name"
                      className={`${inputCls} min-w-0 flex-1 bg-transparent`}
                    />
                    {groups.length > 0 && (
                      <select
                        value={p.groupId ?? ""}
                        onChange={(e) => { e.stopPropagation(); updatePlayer(p.localId, { groupId: e.target.value || null }); }}
                        onClick={(e) => e.stopPropagation()}
                        className={`${inputCls} w-24 shrink-0`}
                      >
                        {groups.map((g) => <option key={g.localId} value={g.localId}>{g.label || "Unnamed"}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); removePlayer(p.localId); }} className="shrink-0 text-xs text-zinc-300 hover:text-red-500">✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Snapshots */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-900">Snapshots</h2>
            <button type="button" onClick={addSnapshot} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">+ Add</button>
          </div>

          {snapshots.length === 0 ? (
            <p className="px-4 py-3 text-xs text-zinc-400">
              {groups.some((g) => g.teeTime)
                ? "Tee time snapshots created. Add more or select one above."
                : "Set group tee times or click + Add to create snapshots."}
            </p>
          ) : (
            <>
              {/* Scroller */}
              <div className="flex items-center gap-1 border-b border-zinc-100 px-2 py-2">
                <button
                  type="button"
                  onClick={() => setActiveSnapshotIdx((i) => Math.max(0, i - 1))}
                  disabled={activeSnapshotIdx === 0}
                  className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-100 disabled:opacity-30"
                >
                  ‹
                </button>
                <div className="flex min-w-0 flex-1 flex-col">
                  <input
                    type="datetime-local"
                    value={activeSnapshot?.timestamp ?? ""}
                    onChange={(e) => updateSnapshotTs(activeSnapshotIdx, e.target.value)}
                    className={`${inputCls} w-full`}
                  />
                  {activeSnapSourceGroup && (
                    <span className="mt-0.5 truncate text-xs text-zinc-400">
                      Tee time · {activeSnapSourceGroup.label}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSnapshotIdx((i) => Math.min(snapshots.length - 1, i + 1))}
                  disabled={activeSnapshotIdx === snapshots.length - 1}
                  className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-100 disabled:opacity-30"
                >
                  ›
                </button>
                <span className="shrink-0 text-xs text-zinc-400">{activeSnapshotIdx + 1}/{snapshots.length}</span>
                <button
                  type="button"
                  onClick={() => removeSnapshot(activeSnapshotIdx)}
                  className="ml-0.5 shrink-0 text-xs text-zinc-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>

              {/* Player rows */}
              {players.length === 0 ? (
                <p className="px-4 py-3 text-xs text-zinc-400">Add players first.</p>
              ) : filteredPlayers.length === 0 ? (
                <p className="px-4 py-3 text-xs text-zinc-400">No players match the current filter.</p>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {filteredPlayers.map((player) => {
                    const blocked = isBlockedAtSnapshot(activeSnapshot, player);
                    const loc = blocked ? null : snapshotLocs.find((l) => l.playerId === player.localId);
                    const isActive = player.localId === activePlayerId;
                    return (
                      <div
                        key={player.localId}
                        onClick={() => togglePlayerSelect(player.localId, blocked)}
                        className={`flex items-center gap-2 px-3 py-1.5 transition-colors ${
                          blocked
                            ? "cursor-default opacity-40"
                            : isActive
                            ? "cursor-pointer bg-blue-50"
                            : "cursor-pointer hover:bg-zinc-50"
                        }`}
                      >
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: blocked ? "#d1d5db" : playerColor(player) }}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-zinc-800">
                          {player.name || "Player"}
                        </span>
                        {blocked ? (
                          <span className="shrink-0 text-xs text-zinc-300">before tee</span>
                        ) : loc ? (
                          <>
                            <span className="shrink-0 font-mono text-xs text-zinc-500">
                              {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); clearPlayerLoc(player.localId); }}
                              className="ml-0.5 shrink-0 text-xs text-zinc-300 hover:text-red-500"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <span className="shrink-0 text-xs text-zinc-300">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Placement hint */}
              {activePlayerId && activeSnapshot && !isCurrentPlayerBlocked && (
                <div className="border-t border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-xs text-blue-600">
                    Click the map to place <strong>{activePlayerObj?.name ?? "player"}</strong>
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Export */}
        <div className="pb-4">
          <button
            type="button"
            onClick={copyJson}
            disabled={players.length === 0 || snapshots.length === 0}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-40"
          >
            {copied ? "Copied!" : "Copy Session JSON"}
          </button>
          <p className="mt-1.5 text-xs text-zinc-400">Paste into the Session Visualizer to preview.</p>
        </div>
      </div>

      {/* ── Map ── */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TestCaseBuilderMap
          pins={pins}
          isPlacing={isPlacing}
          viewTarget={viewTarget}
          onMapClick={handleMapClick}
        />
      </div>
    </div>
  );
}
