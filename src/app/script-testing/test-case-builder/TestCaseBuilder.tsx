"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { LocationPin, ViewTarget } from "./TestCaseBuilderMap";

const TestCaseBuilderMap = dynamic(() => import("./TestCaseBuilderMap"), { ssr: false });

const GROUP_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be185d",
  "#ca8a04",
];

const UNASSIGNED_COLOR = "#6b7280";

function makeId() {
  return Math.random().toString(36).slice(2);
}

type CourseOption = {
  id: string;
  name: string;
};

type MockGroup = {
  localId: string;
  label: string;
  teeTime: string;
};

type MockPlayer = {
  localId: string;
  name: string;
  groupId: string | null;
};

type MockLocation = {
  localId: string;
  playerId: string;
  lat: number;
  lng: number;
  timestamp: string;
};

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
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedCourseName, setSelectedCourseName] = useState<string>("");
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);

  const [groups, setGroups] = useState<MockGroup[]>([]);
  const [players, setPlayers] = useState<MockPlayer[]>([]);
  const [locations, setLocations] = useState<MockLocation[]>([]);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [activeTimestamp, setActiveTimestamp] = useState(defaultTimestamp);
  const [copied, setCopied] = useState(false);

  const activePlayer = players.find((p) => p.localId === activePlayerId) ?? null;

  const groupColorMap = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((g, i) => map.set(g.localId, GROUP_COLORS[i % GROUP_COLORS.length]));
    return map;
  }, [groups]);

  function playerColor(p: MockPlayer) {
    return p.groupId ? (groupColorMap.get(p.groupId) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR;
  }

  const pins = useMemo<LocationPin[]>(() => {
    const byPlayer = new Map<string, MockLocation[]>();
    for (const loc of locations) {
      const arr = byPlayer.get(loc.playerId) ?? [];
      arr.push(loc);
      byPlayer.set(loc.playerId, arr);
    }
    const result: LocationPin[] = [];
    for (const player of players) {
      const locs = (byPlayer.get(player.localId) ?? []).sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp)
      );
      const color = playerColor(player);
      const isActivePlayer = player.localId === activePlayerId;
      locs.forEach((loc, i) => {
        result.push({
          id: loc.localId,
          lat: loc.lat,
          lng: loc.lng,
          color,
          index: i + 1,
          isActivePlayer,
          playerName: player.name || "Player",
        });
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, players, activePlayerId, groupColorMap]);

  // ── Course selection ──────────────────────────────────────────

  async function handleCourseChange(courseId: string) {
    setSelectedCourseId(courseId);
    if (!courseId) {
      setSelectedCourseName("");
      return;
    }
    const opt = courseOptions.find((c) => c.id === courseId);
    setSelectedCourseName(opt?.name ?? "");
    setLoadingCourse(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/data`);
      const data = await res.json();
      const holes: { teeLat: number; teeLng: number; greenLat: number; greenLng: number }[] =
        data.holes ?? [];
      const latlngs: [number, number][] = holes.flatMap((h) => [
        [h.teeLat, h.teeLng] as [number, number],
        [h.greenLat, h.greenLng] as [number, number],
      ]);
      if (latlngs.length > 0) {
        setViewTarget({ key: Date.now(), latlngs });
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoadingCourse(false);
    }
  }

  // ── Groups ──────────────────────────────────────────────────

  function addGroup() {
    setGroups((prev) => [
      ...prev,
      { localId: makeId(), label: `Group ${prev.length + 1}`, teeTime: "" },
    ]);
  }

  function updateGroup(id: string, patch: Partial<MockGroup>) {
    setGroups((prev) => prev.map((g) => (g.localId === id ? { ...g, ...patch } : g)));
  }

  function removeGroup(id: string) {
    setGroups((prev) => prev.filter((g) => g.localId !== id));
    setPlayers((prev) => prev.map((p) => (p.groupId === id ? { ...p, groupId: null } : p)));
  }

  // ── Players ─────────────────────────────────────────────────

  function addPlayer() {
    const p: MockPlayer = {
      localId: makeId(),
      name: `Player ${players.length + 1}`,
      groupId: null,
    };
    setPlayers((prev) => [...prev, p]);
    setActivePlayerId(p.localId);
  }

  function updatePlayer(id: string, patch: Partial<MockPlayer>) {
    setPlayers((prev) => prev.map((p) => (p.localId === id ? { ...p, ...patch } : p)));
  }

  function removePlayer(id: string) {
    setPlayers((prev) => prev.filter((p) => p.localId !== id));
    setLocations((prev) => prev.filter((l) => l.playerId !== id));
    if (activePlayerId === id) setActivePlayerId(null);
  }

  // ── Locations ────────────────────────────────────────────────

  function handleMapClick(lat: number, lng: number) {
    if (!activePlayerId) return;
    setLocations((prev) => [
      ...prev,
      { localId: makeId(), playerId: activePlayerId, lat, lng, timestamp: activeTimestamp },
    ]);
    setActiveTimestamp((ts) => advanceByMinutes(ts, 5));
  }

  function updateLocation(id: string, patch: Partial<MockLocation>) {
    setLocations((prev) => prev.map((l) => (l.localId === id ? { ...l, ...patch } : l)));
  }

  function removeLocation(id: string) {
    setLocations((prev) => prev.filter((l) => l.localId !== id));
  }

  // ── Export ───────────────────────────────────────────────────

  function buildSessionJson() {
    const byPlayer = new Map<string, MockLocation[]>();
    for (const loc of locations) {
      const arr = byPlayer.get(loc.playerId) ?? [];
      arr.push(loc);
      byPlayer.set(loc.playerId, arr);
    }
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
        players: players
          .filter((p) => p.groupId === g.localId)
          .map((p) => ({ user_id: p.localId, using_carts: false })),
      })),
      players: players.map((p) => ({
        user_id: p.localId,
        email: p.name || p.localId,
        locations: (byPlayer.get(p.localId) ?? [])
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map((loc) => ({
            id: makeId(),
            recorded_at: new Date(loc.timestamp).toISOString(),
            latitude: loc.lat,
            longitude: loc.lng,
            horizontal_accuracy: null,
          })),
      })),
    };
  }

  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(buildSessionJson(), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeLocs = locations
    .filter((l) => l.playerId === activePlayerId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const inputCls =
    "rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-900 outline-none focus:border-zinc-400 focus:bg-white";

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* Left panel */}
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
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {loadingCourse && (
              <p className="mt-1 text-xs text-zinc-400">Loading course…</p>
            )}
          </div>
        </div>

        {/* Groups */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-900">Groups</h2>
            <button
              type="button"
              onClick={addGroup}
              className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
            >
              + Add
            </button>
          </div>
          {groups.length === 0 ? (
            <p className="px-4 py-3 text-xs text-zinc-400">No groups yet.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {groups.map((g, i) => (
                <div key={g.localId} className="flex items-center gap-2 px-3 py-2">
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }}
                  />
                  <input
                    value={g.label}
                    onChange={(e) => updateGroup(g.localId, { label: e.target.value })}
                    placeholder="Label"
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                  <input
                    type="time"
                    value={g.teeTime}
                    onChange={(e) => updateGroup(g.localId, { teeTime: e.target.value })}
                    title="Tee time"
                    className={`${inputCls} w-20 shrink-0`}
                  />
                  <button
                    type="button"
                    onClick={() => removeGroup(g.localId)}
                    className="shrink-0 text-xs text-zinc-300 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Players */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-zinc-900">Players</h2>
            <button
              type="button"
              onClick={addPlayer}
              className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
            >
              + Add
            </button>
          </div>
          {players.length === 0 ? (
            <p className="px-4 py-3 text-xs text-zinc-400">No players yet.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {players.map((p) => {
                const color = playerColor(p);
                const isActive = p.localId === activePlayerId;
                return (
                  <div
                    key={p.localId}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors ${
                      isActive ? "bg-blue-50" : "hover:bg-zinc-50"
                    }`}
                    onClick={() => setActivePlayerId(isActive ? null : p.localId)}
                  >
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm"
                      style={{ background: color }}
                    />
                    <input
                      value={p.name}
                      onChange={(e) => {
                        e.stopPropagation();
                        updatePlayer(p.localId, { name: e.target.value });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Name"
                      className={`${inputCls} min-w-0 flex-1 bg-transparent`}
                    />
                    <select
                      value={p.groupId ?? ""}
                      onChange={(e) => {
                        e.stopPropagation();
                        updatePlayer(p.localId, { groupId: e.target.value || null });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={`${inputCls} w-24 shrink-0`}
                    >
                      <option value="">No group</option>
                      {groups.map((g) => (
                        <option key={g.localId} value={g.localId}>
                          {g.label || "Unnamed"}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePlayer(p.localId);
                      }}
                      className="shrink-0 text-xs text-zinc-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Placement panel */}
        {players.length > 0 && (
          <div
            className={`rounded-xl border bg-white shadow-sm ${
              activePlayer ? "border-blue-200" : "border-zinc-200"
            }`}
          >
            <div
              className={`border-b px-4 py-2.5 ${
                activePlayer ? "border-blue-100" : "border-zinc-100"
              }`}
            >
              {activePlayer ? (
                <>
                  <p className="text-xs font-semibold text-blue-700">
                    Placing:{" "}
                    <span style={{ color: playerColor(activePlayer) }}>
                      {activePlayer.name || "Player"}
                    </span>
                    <span className="ml-1 font-normal text-blue-500">
                      — click map to add location
                    </span>
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="shrink-0 text-xs text-zinc-500">Next timestamp:</span>
                    <input
                      type="datetime-local"
                      value={activeTimestamp}
                      onChange={(e) => setActiveTimestamp(e.target.value)}
                      className={`${inputCls} flex-1`}
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-zinc-500">
                  Select a player above to place them on the map.
                </p>
              )}
            </div>

            {activePlayer && (
              <>
                {activeLocs.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-zinc-400">
                    No locations yet — click the map to add points.
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-100">
                    {activeLocs.map((loc, idx) => (
                      <div key={loc.localId} className="flex items-center gap-1.5 px-3 py-1.5">
                        <span className="w-4 shrink-0 text-center text-xs font-semibold text-zinc-400">
                          {idx + 1}
                        </span>
                        <span className="w-32 shrink-0 font-mono text-xs text-zinc-600">
                          {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                        </span>
                        <input
                          type="datetime-local"
                          value={loc.timestamp}
                          onChange={(e) =>
                            updateLocation(loc.localId, { timestamp: e.target.value })
                          }
                          className={`${inputCls} min-w-0 flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => removeLocation(loc.localId)}
                          className="shrink-0 text-xs text-zinc-300 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Export */}
        <div className="pb-4">
          <button
            type="button"
            onClick={copyJson}
            disabled={players.length === 0}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-40"
          >
            {copied ? "Copied!" : "Copy Session JSON"}
          </button>
          <p className="mt-1.5 text-xs text-zinc-400">
            Paste into the Session Visualizer to preview.
          </p>
        </div>
      </div>

      {/* Map */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TestCaseBuilderMap
          pins={pins}
          isPlacing={!!activePlayerId}
          viewTarget={viewTarget}
          onMapClick={handleMapClick}
        />
      </div>
    </div>
  );
}
