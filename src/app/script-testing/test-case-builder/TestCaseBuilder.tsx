"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upsertTestCase } from "@/lib/testCases";
import type { TestCase } from "@/lib/testCases";
import type { LocationPin, ViewTarget } from "./TestCaseBuilderMap";

const TestCaseBuilderMap = dynamic(() => import("./TestCaseBuilderMap"), { ssr: false });

const GROUP_COLORS = [
  "#2563eb", "#16a34a", "#dc2626", "#9333ea",
  "#ea580c", "#0891b2", "#be185d", "#ca8a04",
];
const UNASSIGNED_COLOR = "#6b7280";
const STORAGE_KEY = "test-case-builder-state-v1";

function makeId() {
  return Math.random().toString(36).slice(2);
}

type CourseOption = { id: string; name: string };
type MockGroup = { localId: string; label: string; teeTime: string };
type MockPlayer = { localId: string; name: string; groupId: string | null; usingCarts: boolean };
type Snapshot = { localId: string; timestamp: string; sourceGroupId: string | null };
type MockLocation = { localId: string; snapshotId: string; playerId: string; lat: number; lng: number };

type CourseHole = { holeNumber: number; teeLat: number; teeLng: number; greenLat: number; greenLng: number; allottedTime: number };
type CourseLandmark = { landmarkType: string; endpoint1Lat: number; endpoint1Lng: number; endpoint2Lat?: number; endpoint2Lng?: number };
type CourseCartPath = { holeNumber: number; label: string | null; pathType: string; coordinates: { lat: number; lng: number }[] };

type SavedState = {
  selectedCourseId: string;
  selectedCourseName: string;
  groups: MockGroup[];
  players: MockPlayer[];
  snapshots: Snapshot[];
  locations: MockLocation[];
  activeSnapshotIdx: number;
  courseHoles?: CourseHole[];
  courseLandmarks?: CourseLandmark[];
  courseCartPaths?: CourseCartPath[];
  mapCenter?: [number, number];
  mapZoom?: number;
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
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedCourseName, setSelectedCourseName] = useState("");
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [courseLandmarks, setCourseLandmarks] = useState<CourseLandmark[]>([]);
  const [courseCartPaths, setCourseCartPaths] = useState<CourseCartPath[]>([]);

  const [groups, setGroups] = useState<MockGroup[]>([]);
  const [players, setPlayers] = useState<MockPlayer[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [locations, setLocations] = useState<MockLocation[]>([]);

  const [activeSnapshotIdx, setActiveSnapshotIdx] = useState(0);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [hasRecent, setHasRecent] = useState(false);

  const router = useRouter();
  const restoringRef = useRef(false);
  const mapViewRef = useRef<{ center: [number, number]; zoom: number }>({ center: [39.5, -98.35], zoom: 4 });
  const [mapInitView, setMapInitView] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const activeSnapshot = snapshots[activeSnapshotIdx] ?? null;

  // ── LocalStorage ──────────────────────────────────────────────

  function applyState(saved: SavedState) {
    if (saved.groups) setGroups(saved.groups);
    if (saved.players) setPlayers(saved.players);
    if (saved.snapshots) setSnapshots(saved.snapshots);
    if (saved.locations) setLocations(saved.locations);
    if (typeof saved.selectedCourseId === "string") setSelectedCourseId(saved.selectedCourseId);
    if (typeof saved.selectedCourseName === "string") setSelectedCourseName(saved.selectedCourseName);
    if (typeof saved.activeSnapshotIdx === "number") setActiveSnapshotIdx(saved.activeSnapshotIdx);
    if (saved.courseHoles) setCourseHoles(saved.courseHoles);
    if (saved.courseLandmarks) setCourseLandmarks(saved.courseLandmarks);
    if (saved.courseCartPaths) setCourseCartPaths(saved.courseCartPaths);
    if (saved.mapCenter && saved.mapZoom != null) {
      mapViewRef.current = { center: saved.mapCenter, zoom: saved.mapZoom };
      setMapInitView({ center: saved.mapCenter, zoom: saved.mapZoom });
    }
    setActivePlayerId(null);
    setActiveGroupId(null);
  }

  // Auto-load on mount
  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setMapReady(true);
      return;
    }
    try {
      restoringRef.current = true;
      applyState(JSON.parse(raw) as SavedState);
      setHasRecent(true);
    } catch { /* ignore */ } finally {
      setTimeout(() => { restoringRef.current = false; setMapReady(true); }, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save on state changes
  useEffect(() => {
    if (restoringRef.current) return;
    const payload: SavedState = {
      selectedCourseId, selectedCourseName,
      groups, players, snapshots, locations, activeSnapshotIdx,
      courseHoles, courseLandmarks, courseCartPaths,
      mapCenter: mapViewRef.current.center,
      mapZoom: mapViewRef.current.zoom,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setHasRecent(true);
  }, [selectedCourseId, selectedCourseName, groups, players, snapshots, locations, activeSnapshotIdx]);

  function loadRecent() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      restoringRef.current = true;
      applyState(JSON.parse(raw) as SavedState);
    } catch { /* ignore */ } finally {
      setTimeout(() => { restoringRef.current = false; }, 0);
    }
  }

  function clearState() {
    window.localStorage.removeItem(STORAGE_KEY);
    setGroups([]);
    setPlayers([]);
    setSnapshots([]);
    setLocations([]);
    setSelectedCourseId("");
    setSelectedCourseName("");
    setActiveSnapshotIdx(0);
    setCourseHoles([]);
    setCourseLandmarks([]);
    setCourseCartPaths([]);
    mapViewRef.current = { center: [39.5, -98.35], zoom: 4 };
    setMapInitView(null);
    setActivePlayerId(null);
    setActiveGroupId(null);
    setHasRecent(false);
  }

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
    if (!courseId) {
      setSelectedCourseName("");
      setCourseHoles([]);
      setCourseLandmarks([]);
      setCourseCartPaths([]);
      return;
    }
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
      if (data.holes) setCourseHoles(data.holes);
      if (data.landmarks) setCourseLandmarks(data.landmarks);
      if (data.cartPaths) setCourseCartPaths(
        (data.cartPaths as { holeNumber: number; label: string | null; pathType: string; coordinates: { lat: number; lng: number }[] }[])
      );
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
        if (existingSnap) {
          setLocations((prev) => prev.filter((l) => l.snapshotId !== existingSnap.localId));
          setSnapshots((prev) => {
            const next = prev.filter((s) => s.localId !== existingSnap.localId);
            setActiveSnapshotIdx((cur) => Math.min(cur, Math.max(0, next.length - 1)));
            return next;
          });
        }
      } else if (existingSnap) {
        setSnapshots((prev) => prev.map((s) => s.localId === existingSnap.localId ? { ...s, timestamp: newTeeTime } : s));
      } else {
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
    setGroups((prev) => {
      const remaining = prev.filter((g) => g.localId !== id);
      const firstId = remaining[0]?.localId ?? null;
      setPlayers((pp) => pp.map((p) => (p.groupId === id ? { ...p, groupId: firstId } : p)));
      return remaining;
    });
    if (activeGroupId === id) setActiveGroupId(null);
  }

  function toggleGroupFilter(id: string) {
    setActiveGroupId((prev) => (prev === id ? null : id));
    setActivePlayerId(null);
  }

  // ── Players ───────────────────────────────────────────────────

  function addPlayer() {
    setPlayers((prev) => [
      ...prev,
      { localId: makeId(), name: `Player ${prev.length + 1}`, groupId: groups[0]?.localId ?? null, usingCarts: false },
    ]);
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

    // Cart paths grouped by hole number
    const cpByHole = new Map<number, CourseCartPath[]>();
    for (const cp of courseCartPaths) {
      if (!cpByHole.has(cp.holeNumber)) cpByHole.set(cp.holeNumber, []);
      cpByHole.get(cp.holeNumber)!.push(cp);
    }

    return {
      version: 1,
      exported_at: new Date().toISOString(),
      session_id: makeId(),
      session_name: selectedCourseName ? `${selectedCourseName} Mock` : "Mock Session",
      course_id: selectedCourseId || "",
      course_name: selectedCourseName || "",
      holes: courseHoles.map((h) => ({
        hole_number: h.holeNumber,
        tee_lat: h.teeLat,
        tee_lng: h.teeLng,
        green_lat: h.greenLat,
        green_lng: h.greenLng,
        allotted_time: h.allottedTime,
        cart_paths: (cpByHole.get(h.holeNumber) ?? []).map((cp) => ({
          label: cp.label ?? null,
          path_type: cp.pathType,
          coordinates: cp.coordinates,
        })),
      })),
      course_landmarks: courseLandmarks.map((l) => {
        if (l.landmarkType === "driving_range" && l.endpoint2Lat != null) {
          const midLat = (l.endpoint1Lat + l.endpoint2Lat) / 2;
          const midLng = (l.endpoint1Lng + (l.endpoint2Lng ?? l.endpoint1Lng)) / 2;
          return {
            id: makeId(),
            landmark_type: l.landmarkType,
            latitude: midLat,
            longitude: midLng,
            endpoint1_latitude: l.endpoint1Lat,
            endpoint1_longitude: l.endpoint1Lng,
            endpoint2_latitude: l.endpoint2Lat,
            endpoint2_longitude: l.endpoint2Lng,
          };
        }
        return {
          id: makeId(),
          landmark_type: l.landmarkType,
          latitude: l.endpoint1Lat,
          longitude: l.endpoint1Lng,
        };
      }),
      groups: groups.map((g) => ({
        group_id: g.localId,
        label: g.label,
        tee_time: g.teeTime ? new Date(g.teeTime).toISOString() : null,
        players: players
          .filter((p) => p.groupId === g.localId)
          .map((p) => ({ user_id: p.localId, using_carts: p.usingCarts })),
      })),
      players: players.map((p) => ({
        user_id: p.localId,
        email: p.name || p.localId,
        using_carts: p.usingCarts,
        locations: sorted.flatMap((snap) => {
          const loc = locations.find((l) => l.snapshotId === snap.localId && l.playerId === p.localId);
          if (!loc) return [];
          return [{ id: makeId(), recorded_at: new Date(snap.timestamp).toISOString(), latitude: loc.lat, longitude: loc.lng, horizontal_accuracy: null }];
        }),
      })),
      group_pacing: [],
      events: [],
    };
  }

  function downloadJson() {
    const json = JSON.stringify(buildSessionJson(), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mock-session-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAsTestCase() {
    const json = JSON.stringify(buildSessionJson(), null, 2);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tc: TestCase = {
      id,
      name: selectedCourseName ? `${selectedCourseName} Mock` : "Mock Session",
      description: "",
      courseId: selectedCourseId || null,
      courseName: selectedCourseName || null,
      holes: [],
      landmarks: [],
      groups: groups.map((g) => ({ localId: g.localId, label: g.label, teeTime: g.teeTime })),
      pacingRows: [],
      events: [],
      sessionJson: json,
      createdAt: now,
      updatedAt: now,
    };
    upsertTestCase(tc);
    router.push(`/script-testing/test-cases/${id}`);
  }

  const inputCls = "rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-900 outline-none focus:border-zinc-400 focus:bg-white";
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
            <div className="max-h-48 divide-y divide-zinc-100 overflow-y-auto">
              {players.map((p) => {
                const color = playerColor(p);
                const isActive = p.localId === activePlayerId;
                return (
                  <div
                    key={p.localId}
                    onClick={() => togglePlayerSelect(p.localId, false)}
                    className={`flex cursor-pointer items-center gap-1.5 px-3 py-2 transition-colors ${isActive ? "bg-blue-50" : "hover:bg-zinc-50"}`}
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
                        className={`${inputCls} w-20 shrink-0`}
                      >
                        {groups.map((g) => <option key={g.localId} value={g.localId}>{g.label || "Unnamed"}</option>)}
                      </select>
                    )}
                    <label
                      className="flex shrink-0 cursor-pointer items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                      title="Using cart"
                    >
                      <input
                        type="checkbox"
                        checked={p.usingCarts}
                        onChange={(e) => updatePlayer(p.localId, { usingCarts: e.target.checked })}
                        className="h-3 w-3 cursor-pointer rounded accent-zinc-600"
                      />
                      <span className="text-xs text-zinc-400">Cart</span>
                    </label>
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
              Set group tee times or click + Add to create snapshots.
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
                          blocked ? "cursor-default opacity-40"
                            : isActive ? "cursor-pointer bg-blue-50"
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

        {/* Actions */}
        <div className="flex gap-2 pb-4">
          {/* Download session JSON */}
          <div className="group relative">
            <button
              type="button"
              onClick={downloadJson}
              disabled={players.length === 0 || snapshots.length === 0}
              className="flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 z-50">
              Download session JSON
            </span>
          </div>

          {/* Export as new test case */}
          <div className="group relative">
            <button
              type="button"
              onClick={exportAsTestCase}
              disabled={players.length === 0 || snapshots.length === 0}
              className="flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 z-50">
              Export as new test case
            </span>
          </div>

          {/* Clear */}
          <div className="group relative">
            <button
              type="button"
              onClick={clearState}
              className="flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 z-50">
              Clear
            </span>
          </div>
        </div>
      </div>

      {/* ── Map ── */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mapReady && (
          <TestCaseBuilderMap
            pins={pins}
            isPlacing={isPlacing}
            viewTarget={viewTarget}
            initialCenter={mapInitView?.center ?? [39.5, -98.35]}
            initialZoom={mapInitView?.zoom ?? 4}
            onMapClick={handleMapClick}
            onViewChange={(center, zoom) => {
              mapViewRef.current = { center, zoom };
            }}
          />
        )}
      </div>
    </div>
  );
}
