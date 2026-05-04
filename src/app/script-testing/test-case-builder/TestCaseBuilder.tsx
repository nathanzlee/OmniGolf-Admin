"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getTestCase, listTestCases, upsertTestCaseRecord } from "@/app/actions";
import type { LocationData, TestCase, TestCaseCartPath } from "@/lib/testCases";
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

function formatDateTimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  ].join("-") + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type CourseOption = { id: string; name: string };
type MockGroup = { localId: string; label: string; teeTime: string; startHole?: number };
type MockPlayer = { localId: string; name: string; groupId: string | null; usingCarts: boolean };
type Snapshot = { localId: string; timestamp: string; sourceGroupId: string | null };
type MockLocation = { localId: string; snapshotId: string; playerId: string; lat: number; lng: number };

type CourseHole = { holeNumber: number; teeLat: number; teeLng: number; greenLat: number; greenLng: number; allottedTime: number };
type CourseLandmark = { id?: string; landmarkType: string; endpoint1Lat: number; endpoint1Lng: number; endpoint2Lat?: number; endpoint2Lng?: number };
type CourseCartPath = TestCaseCartPath;

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
  return formatDateTimeLocal(now);
}

function advanceByMinutes(ts: string, minutes: number) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() + minutes);
  return formatDateTimeLocal(d);
}

function sortSnapshotsByTimestamp(items: Snapshot[]) {
  return items
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((a, b) => a.snapshot.timestamp.localeCompare(b.snapshot.timestamp) || a.index - b.index)
    .map(({ snapshot }) => snapshot);
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
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"new" | "existing">("new");
  const [exportName, setExportName] = useState("");
  const [targetTestCaseId, setTargetTestCaseId] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [currentTestCase, setCurrentTestCase] = useState<TestCase | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const editTestCaseId = searchParams.get("tcId");
  const restoringRef = useRef(false);
  const mapViewRef = useRef<{ center: [number, number]; zoom: number }>({ center: [39.5, -98.35], zoom: 4 });
  const [mapInitView, setMapInitView] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const activeSnapshot = snapshots[activeSnapshotIdx] ?? null;

  // ── LocalStorage ──────────────────────────────────────────────

  function applyState(saved: SavedState) {
    if (saved.groups) setGroups(saved.groups.map((g) => ({ ...g, startHole: g.startHole ?? 1 })));
    if (saved.players) setPlayers(saved.players);
    if (saved.snapshots) {
      const activeSnapshotId = saved.snapshots[saved.activeSnapshotIdx]?.localId;
      const sorted = sortSnapshotsByTimestamp(saved.snapshots);
      setSnapshots(sorted);
      if (activeSnapshotId) {
        setActiveSnapshotIdx(Math.max(0, sorted.findIndex((s) => s.localId === activeSnapshotId)));
      }
    }
    if (saved.locations) setLocations(saved.locations);
    if (typeof saved.selectedCourseId === "string") setSelectedCourseId(saved.selectedCourseId);
    if (typeof saved.selectedCourseName === "string") setSelectedCourseName(saved.selectedCourseName);
    if (typeof saved.activeSnapshotIdx === "number" && !saved.snapshots) setActiveSnapshotIdx(saved.activeSnapshotIdx);
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

  const resetBuilderState = useCallback(() => {
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
    setMapInitView({ center: [39.5, -98.35], zoom: 4 });
    setActivePlayerId(null);
    setActiveGroupId(null);
  }, []);

  const fitMapToLocationData = useCallback((data: LocationData) => {
    const playerLatLngs: [number, number][] = data.players.flatMap((p) =>
      p.locations.map((loc) => [loc.lat, loc.lng] as [number, number])
    );
    const courseLatLngs: [number, number][] = data.holes.flatMap((h) => [
      [h.teeLat, h.teeLng] as [number, number],
      [h.greenLat, h.greenLng] as [number, number],
    ]);
    const landmarkLatLngs: [number, number][] = data.landmarks.flatMap((l) => {
      const points: [number, number][] = [[l.endpoint1Lat, l.endpoint1Lng]];
      if (l.endpoint2Lat != null && l.endpoint2Lng != null) points.push([l.endpoint2Lat, l.endpoint2Lng]);
      return points;
    });
    const latlngs = playerLatLngs.length > 0 ? playerLatLngs : [...courseLatLngs, ...landmarkLatLngs];
    if (latlngs.length > 0) setViewTarget({ key: Date.now(), latlngs });
  }, []);

  const applyLocationData = useCallback((data: LocationData) => {
    const snapshotIdByTimestamp = new Map<string, string>();
    const nextSnapshots = Array.from(
      new Set(data.players.flatMap((p) => p.locations.map((loc) => loc.timestamp)))
    )
      .sort()
      .map((timestamp) => {
        const localId = makeId();
        snapshotIdByTimestamp.set(timestamp, localId);
        return { localId, timestamp: timestamp.slice(0, 16), sourceGroupId: null };
      });

    setSelectedCourseId(data.courseId);
    setSelectedCourseName(data.courseName);
    setCourseHoles(data.holes);
    setCourseLandmarks(data.landmarks);
    setCourseCartPaths(data.cartPaths ?? []);
    setGroups(data.groups.map((g) => ({ ...g, startHole: g.startHole ?? 1 })));
    setPlayers(
      data.players.map((p) => ({
        localId: p.localId,
        name: p.name,
        groupId: p.groupId,
        usingCarts: p.usingCarts ?? false,
      }))
    );
    setSnapshots(nextSnapshots);
    setLocations(
      data.players.flatMap((p) =>
        p.locations.flatMap((loc) => {
          const snapshotId = snapshotIdByTimestamp.get(loc.timestamp);
          if (!snapshotId) return [];
          return [{ localId: makeId(), snapshotId, playerId: p.localId, lat: loc.lat, lng: loc.lng }];
        })
      )
    );
    setActiveSnapshotIdx(0);
    setActivePlayerId(null);
    setActiveGroupId(null);
    fitMapToLocationData(data);
  }, [fitMapToLocationData]);

  async function loadMissingCartPaths(courseId: string) {
    try {
      const data = await fetch(`/api/courses/${courseId}/data`).then((r) => r.json());
      if (data.cartPaths) {
        setCourseCartPaths(
          data.cartPaths as { holeNumber: number; label: string | null; pathType: string; coordinates: { lat: number; lng: number }[] }[]
        );
      }
    } catch {
      /* ignore */
    }
  }

  // Auto-load on mount
  useEffect(() => {
    if (editTestCaseId) {
      setMapReady(true);
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setMapReady(true);
      return;
    }
    try {
      restoringRef.current = true;
      applyState(JSON.parse(raw) as SavedState);
    } catch { /* ignore */ } finally {
      setTimeout(() => { restoringRef.current = false; setMapReady(true); }, 0);
    }
  }, [applyLocationData, editTestCaseId]);

  useEffect(() => {
    let cancelled = false;

    listTestCases()
      .then((cases) => {
        if (!cancelled) setTestCases(cases);
      })
      .catch(() => {
        if (!cancelled) setTestCases([]);
      });

    if (!editTestCaseId) {
      setCurrentTestCase(null);
      return () => {
        cancelled = true;
      };
    }

    restoringRef.current = true;
    getTestCase(editTestCaseId)
      .then((tc) => {
        if (cancelled) return;
        setCurrentTestCase(tc);
        if (tc?.locationData) {
          applyLocationData(tc.locationData);
          if (!tc.locationData.cartPaths?.length && tc.locationData.courseId) {
            void loadMissingCartPaths(tc.locationData.courseId);
          }
        } else {
          resetBuilderState();
        }
        setExportMode("existing");
        setTargetTestCaseId(editTestCaseId);
        setExportName(tc?.name ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentTestCase(null);
          resetBuilderState();
        }
      })
      .finally(() => {
        if (!cancelled) setTimeout(() => { restoringRef.current = false; }, 0);
      });

    return () => {
      cancelled = true;
    };
  }, [applyLocationData, editTestCaseId, resetBuilderState]);

  // Auto-save on state changes
  useEffect(() => {
    if (editTestCaseId) return;
    if (restoringRef.current) return;
    const payload: SavedState = {
      selectedCourseId, selectedCourseName,
      groups, players, snapshots, locations, activeSnapshotIdx,
      courseHoles, courseLandmarks, courseCartPaths,
      mapCenter: mapViewRef.current.center,
      mapZoom: mapViewRef.current.zoom,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [editTestCaseId, selectedCourseId, selectedCourseName, groups, players, snapshots, locations, activeSnapshotIdx, courseHoles, courseLandmarks, courseCartPaths]);

  function clearState() {
    if (!editTestCaseId) window.localStorage.removeItem(STORAGE_KEY);
    resetBuilderState();
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
    setGroups((prev) => [...prev, { localId: makeId(), label: `Group ${prev.length + 1}`, teeTime: "", startHole: 1 }]);
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
        const activeSnapshotId = snapshots[activeSnapshotIdx]?.localId;
        setSnapshots((prev) => {
          const next = sortSnapshotsByTimestamp(
            prev.map((s) => s.localId === existingSnap.localId ? { ...s, timestamp: newTeeTime } : s)
          );
          if (activeSnapshotId) {
            setActiveSnapshotIdx(Math.max(0, next.findIndex((s) => s.localId === activeSnapshotId)));
          }
          return next;
        });
      } else {
        setSnapshots((prev) => sortSnapshotsByTimestamp([...prev, { localId: makeId(), timestamp: newTeeTime, sourceGroupId: id }]));
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
    const ts = snapshots.length > 0 ? advanceByMinutes(lastTs, 1) : lastTs;
    const localId = makeId();
    setSnapshots((prev) => {
      const next = sortSnapshotsByTimestamp([...prev, { localId, timestamp: ts, sourceGroupId: null }]);
      setActiveSnapshotIdx(Math.max(0, next.findIndex((s) => s.localId === localId)));
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
    const snapshotId = snapshots[idx]?.localId;
    setSnapshots((prev) => {
      const next = sortSnapshotsByTimestamp(prev.map((s, i) => (i === idx ? { ...s, timestamp: ts } : s)));
      if (snapshotId) {
        setActiveSnapshotIdx(Math.max(0, next.findIndex((s) => s.localId === snapshotId)));
      }
      return next;
    });
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

  function getPreviousPlayerLoc(playerId: string): MockLocation | null {
    for (let idx = activeSnapshotIdx - 1; idx >= 0; idx -= 1) {
      const snap = snapshots[idx];
      const loc = locations.find((l) => l.snapshotId === snap.localId && l.playerId === playerId);
      if (loc) return loc;
    }
    return null;
  }

  function applyPreviousPlayerLoc(playerId: string) {
    if (!activeSnapshot) return;
    const prevLoc = getPreviousPlayerLoc(playerId);
    if (!prevLoc) return;
    setLocations((prev) => [
      ...prev.filter((l) => !(l.snapshotId === activeSnapshot.localId && l.playerId === playerId)),
      {
        localId: makeId(),
        snapshotId: activeSnapshot.localId,
        playerId,
        lat: prevLoc.lat,
        lng: prevLoc.lng,
      },
    ]);
  }

  // ── Export ────────────────────────────────────────────────────

  function buildLocationData(): LocationData {
    const sorted = [...snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return {
      courseId: selectedCourseId || "",
      courseName: selectedCourseName || "",
      holes: courseHoles,
      landmarks: courseLandmarks.map((l) => ({ ...l, id: l.id ?? makeId() })),
      cartPaths: courseCartPaths,
      groups: groups.map((g) => ({
        localId: g.localId,
        label: g.label,
        teeTime: g.teeTime,
        startHole: g.startHole ?? 1,
      })),
      players: players.map((p) => ({
        localId: p.localId,
        name: p.name || p.localId,
        groupId: p.groupId,
        usingCarts: p.usingCarts,
        locations: sorted.flatMap((snap) => {
          const loc = locations.find((l) => l.snapshotId === snap.localId && l.playerId === p.localId);
          if (!loc) return [];
          return [{ timestamp: snap.timestamp, lat: loc.lat, lng: loc.lng }];
        }),
      })),
    };
  }

  async function openExportDialog() {
    setExportMessage("");
    let cases: TestCase[] = [];
    try {
      cases = await listTestCases();
      setTestCases(cases);
    } catch (e: unknown) {
      setExportMessage(e instanceof Error ? e.message : "Failed to load test cases.");
    }
    setExportName(selectedCourseName ? `${selectedCourseName} Mock` : "Mock Location Data");
    if (editTestCaseId && cases.some((tc) => tc.id === editTestCaseId)) {
      setExportMode("existing");
      setTargetTestCaseId(editTestCaseId);
    } else if (targetTestCaseId && cases.some((tc) => tc.id === targetTestCaseId)) {
      setExportMode("existing");
    } else {
      setExportMode("new");
      setTargetTestCaseId(cases[0]?.id ?? "");
    }
    setExportOpen(true);
  }

  async function exportToTestCase() {
    setExportMessage("");
    try {
      const locationData = buildLocationData();
      const now = new Date().toISOString();

      if (exportMode === "existing") {
        const existing = await getTestCase(targetTestCaseId);
        if (!existing) {
          setExportMessage("Choose a test case to update.");
          return;
        }
        await upsertTestCaseRecord({
          ...existing,
          courseId: locationData.courseId || null,
          courseName: locationData.courseName || null,
          holes: locationData.holes,
          landmarks: locationData.landmarks,
          groups: locationData.groups,
          locationData,
          updatedAt: now,
        });
        router.push(`/script-testing/test-cases/${existing.id}`);
        return;
      }

      const id = crypto.randomUUID();
      const tc: TestCase = {
        id,
        name: exportName.trim() || (selectedCourseName ? `${selectedCourseName} Mock` : "Mock Location Data"),
        description: "",
        courseId: locationData.courseId || null,
        courseName: locationData.courseName || null,
        holes: locationData.holes,
        landmarks: locationData.landmarks,
        groups: locationData.groups,
        pacingRows: [],
        events: [],
        sessionJson: "",
        locationData,
        createdAt: now,
        updatedAt: now,
      };
      await upsertTestCaseRecord(tc);
      router.push(`/script-testing/test-cases/${id}`);
    } catch (e: unknown) {
      setExportMessage(e instanceof Error ? e.message : "Failed to export.");
    }
  }

  async function saveToCurrentTestCase() {
    if (!editTestCaseId) return;
    try {
      const locationData = buildLocationData();
      const existing = currentTestCase ?? await getTestCase(editTestCaseId);
      const now = new Date().toISOString();
      const tc: TestCase = existing
        ? {
            ...existing,
            courseId: locationData.courseId || null,
            courseName: locationData.courseName || null,
            holes: locationData.holes,
            landmarks: locationData.landmarks,
            groups: locationData.groups,
            locationData,
            updatedAt: now,
          }
        : {
            id: editTestCaseId,
            name: selectedCourseName ? `${selectedCourseName} Mock` : "Untitled Test Case",
            description: "",
            courseId: locationData.courseId || null,
            courseName: locationData.courseName || null,
            holes: locationData.holes,
            landmarks: locationData.landmarks,
            groups: locationData.groups,
            pacingRows: [],
            events: [],
            sessionJson: "",
            locationData,
            createdAt: now,
            updatedAt: now,
          };
      await upsertTestCaseRecord(tc);
      router.push(`/script-testing/test-cases/${editTestCaseId}`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to save test case.");
    }
  }

  const inputCls = "rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-900 outline-none focus:border-zinc-400 focus:bg-white";
  const activeSnapSourceGroup = activeSnapshot?.sourceGroupId
    ? groups.find((g) => g.localId === activeSnapshot.sourceGroupId)
    : null;

  const exportModal = exportOpen ? (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Export</h2>
          <button
            type="button"
            onClick={() => setExportOpen(false)}
            className="text-xs text-zinc-300 hover:text-zinc-600"
          >
            ✕
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
          <button
            type="button"
            onClick={() => setExportMode("new")}
            className={`rounded-md px-2 py-1.5 text-xs font-medium ${exportMode === "new" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
          >
            New
          </button>
          <button
            type="button"
            onClick={() => setExportMode("existing")}
            disabled={testCases.length === 0}
            className={`rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-40 ${exportMode === "existing" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
          >
            Existing
          </button>
        </div>

        {exportMode === "new" ? (
          <input
            value={exportName}
            onChange={(e) => setExportName(e.target.value)}
            placeholder="Test case name"
            className={`${inputCls} mb-3 w-full py-1.5`}
          />
        ) : (
          <select
            value={targetTestCaseId}
            onChange={(e) => setTargetTestCaseId(e.target.value)}
            className={`${inputCls} mb-3 w-full py-1.5`}
          >
            <option value="">Select a test case</option>
            {testCases.map((tc) => (
              <option key={tc.id} value={tc.id}>{tc.name || "Untitled"}</option>
            ))}
          </select>
        )}

        {exportMessage && <p className="mb-2 text-xs text-red-600">{exportMessage}</p>}
        <button
          type="button"
          onClick={() => void exportToTestCase()}
          disabled={exportMode === "existing" && !targetTestCaseId}
          className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-40"
        >
          {exportMode === "new" ? "Create test case" : "Update test case"}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* ── Left panel ── */}
      <div className="flex w-80 shrink-0 flex-col gap-3 pr-1">

        {/* Course */}
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
                    <select
                      value={g.startHole ?? 1}
                      onChange={(e) => updateGroup(g.localId, { startHole: Number(e.target.value) })}
                      onClick={(e) => e.stopPropagation()}
                      title="Start hole"
                      className={`${inputCls} w-16 shrink-0`}
                    >
                      {Array.from({ length: 18 }, (_, holeIdx) => holeIdx + 1).map((hole) => (
                        <option key={hole} value={hole}>{hole}</option>
                      ))}
                    </select>
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
                <div className="max-h-48 divide-y divide-zinc-100 overflow-y-auto">
                  {filteredPlayers.map((player) => {
                    const blocked = isBlockedAtSnapshot(activeSnapshot, player);
                    const loc = blocked ? null : snapshotLocs.find((l) => l.playerId === player.localId);
                    const prevLoc = blocked || loc ? null : getPreviousPlayerLoc(player.localId);
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
                          prevLoc ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); applyPreviousPlayerLoc(player.localId); }}
                              className="shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                              title={`Use ${prevLoc.lat.toFixed(4)}, ${prevLoc.lng.toFixed(4)}`}
                            >
                              Use previous
                            </button>
                          ) : (
                            <span className="shrink-0 text-xs text-zinc-300">—</span>
                          )
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
          {/* Export / Save */}
          <div className="group relative">
            <button
              type="button"
              onClick={() => {
                if (editTestCaseId) void saveToCurrentTestCase();
                else void openExportDialog();
              }}
              disabled={players.length === 0 || snapshots.length === 0}
              className="flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              {editTestCaseId ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
              )}
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 z-50">
              {editTestCaseId ? "Save" : "Export"}
            </span>
          </div>

          {/* Clear / Back */}
          <div className="group relative">
            <button
              type="button"
              onClick={() => {
                if (editTestCaseId) router.push(`/script-testing/test-cases/${editTestCaseId}`);
                else clearState();
              }}
              className={`flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 shadow-sm ${
                editTestCaseId
                  ? "hover:bg-zinc-50"
                  : "hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              }`}
            >
              {editTestCaseId ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5"/>
                  <path d="M12 19l-7-7 7-7"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              )}
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 z-50">
              {editTestCaseId ? "Back" : "Clear"}
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
              if (editTestCaseId) return;
              try {
                const raw = window.localStorage.getItem(STORAGE_KEY);
                const parsed = raw
                  ? JSON.parse(raw)
                  : {
                      selectedCourseId,
                      selectedCourseName,
                      groups,
                      players,
                      snapshots,
                      locations,
                      activeSnapshotIdx,
                      courseHoles,
                      courseLandmarks,
                      courseCartPaths,
                    };
                parsed.mapCenter = center;
                parsed.mapZoom = zoom;
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
              } catch { /* ignore */ }
            }}
          />
        )}
      </div>
      {exportModal}
    </div>
  );
}
