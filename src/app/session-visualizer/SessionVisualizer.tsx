"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SessionMap = dynamic(() => import("./SessionMap"), { ssr: false });

type Hole = {
  hole_number: number;
  tee_lat: number;
  tee_lng: number;
  green_lat: number;
  green_lng: number;
  allotted_time: number;
};

type CourseLandmark = {
  id: string;
  landmark_type: "putting_green" | "clubhouse" | "driving_range" | "other";
  latitude: number;
  longitude: number;
};

type Group = {
  group_id: string;
  label?: string | null;
  tee_time?: string | null;
  player_user_ids: string[];
};

type PlayerLocation = {
  id: string;
  recorded_at: string;
  latitude: number;
  longitude: number;
  horizontal_accuracy: number | null;
};

type Player = {
  user_id: string;
  email?: string | null;
  locations: PlayerLocation[];
};

type SessionExport = {
  version: number;
  exported_at: string;
  session_id: string;
  session_name?: string;
  course_id: string;
  course_name?: string;
  holes: Hole[];
  course_landmarks?: CourseLandmark[];
  groups: Group[];
  players: Player[];
};

type PlayerPin = {
  userId: string;
  email: string | null;
  latitude: number;
  longitude: number;
  recordedAt: string;
  groupId: string | null;
  groupLabel: string | null;
  groupPlayerCount: number;
};

type GroupPin = {
  groupId: string;
  label: string | null;
  latitude: number;
  longitude: number;
  playerCount: number;
};

type ViewMode = "players" | "groups";
type PlaybackSpeed = 1 | 2 | 4;

const STORAGE_KEY = "session-visualizer-state-v2";

function formatTimestamp(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function getAllTimestamps(data: SessionExport | null): number[] {
  if (!data) return [];
  const times = data.players.flatMap((p) =>
    p.locations.map((l) => new Date(l.recorded_at).getTime())
  );
  return Array.from(new Set(times)).sort((a, b) => a - b);
}

function getLatestLocationAtOrBefore(
  player: Player,
  timeMs: number
): PlayerLocation | null {
  let best: PlayerLocation | null = null;

  for (const loc of player.locations) {
    const locMs = new Date(loc.recorded_at).getTime();
    if (locMs <= timeMs) {
      if (!best || locMs > new Date(best.recorded_at).getTime()) {
        best = loc;
      }
    }
  }

  return best;
}

function sameCenter(
  a: [number, number] | null,
  b: [number, number] | null,
  epsilon = 0.0000001
) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) < epsilon && Math.abs(a[1] - b[1]) < epsilon;
}

export default function SessionVisualizer() {
  const [data, setData] = useState<SessionExport | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState("");
  const [timeIndex, setTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("players");
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [mapCenterOverride, setMapCenterOverride] = useState<[number, number] | null>(null);
  const [mapZoomOverride, setMapZoomOverride] = useState<number | null>(null);

  const restoringRef = useRef(false);

  const timestamps = useMemo(() => getAllTimestamps(data), [data]);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      restoringRef.current = true;

      const saved = JSON.parse(raw) as {
        jsonText?: string;
        timeIndex?: number;
        isPlaying?: boolean;
        selectedPlayerId?: string | null;
        selectedGroupId?: string | null;
        viewMode?: ViewMode;
        playbackSpeed?: PlaybackSpeed;
        mapCenter?: [number, number] | null;
        mapZoom?: number | null;
      };

      if (saved.mapCenter) {
        setMapCenterOverride(saved.mapCenter);
      }

      if (typeof saved.mapZoom === "number") {
        setMapZoomOverride(saved.mapZoom);
      }

      if (saved.viewMode === "players" || saved.viewMode === "groups") {
        setViewMode(saved.viewMode);
      }

      if (saved.playbackSpeed === 1 || saved.playbackSpeed === 2 || saved.playbackSpeed === 4) {
        setPlaybackSpeed(saved.playbackSpeed);
      }

      if (saved.jsonText) {
        setJsonText(saved.jsonText);
        loadParsedJson(saved.jsonText, {
          restoredTimeIndex:
            typeof saved.timeIndex === "number" ? saved.timeIndex : 0,
          restoredSelectedPlayerId:
            "selectedPlayerId" in saved ? saved.selectedPlayerId ?? null : null,
          restoredSelectedGroupId:
            "selectedGroupId" in saved ? saved.selectedGroupId ?? null : null,
        });
      } else {
        if (typeof saved.timeIndex === "number") {
          setTimeIndex(saved.timeIndex);
        }

        if (typeof saved.isPlaying === "boolean") {
          setIsPlaying(saved.isPlaying);
        }

        if ("selectedPlayerId" in saved) {
          setSelectedPlayerId(saved.selectedPlayerId ?? null);
        }

        if ("selectedGroupId" in saved) {
          setSelectedGroupId(saved.selectedGroupId ?? null);
        }
      }
    } catch {
      // ignore bad saved state
    } finally {
      window.setTimeout(() => {
        restoringRef.current = false;
      }, 0);
    }
  }, []);

  useEffect(() => {
    if (restoringRef.current) return;

    const payload = {
      jsonText,
      timeIndex,
      isPlaying,
      selectedPlayerId,
      selectedGroupId,
      viewMode,
      playbackSpeed,
      mapCenter: mapCenterOverride,
      mapZoom: mapZoomOverride,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    jsonText,
    timeIndex,
    isPlaying,
    selectedPlayerId,
    selectedGroupId,
    viewMode,
    playbackSpeed,
    mapCenterOverride,
    mapZoomOverride,
  ]);

  useEffect(() => {
    if (!isPlaying || timestamps.length <= 1) return;

    const intervalMs =
      playbackSpeed === 1 ? 1000 : playbackSpeed === 2 ? 500 : 250;

    const timer = window.setInterval(() => {
      setTimeIndex((prev) => {
        if (prev >= timestamps.length - 1) {
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, timestamps.length, playbackSpeed]);

  useEffect(() => {
    if (timeIndex >= timestamps.length && timestamps.length > 0) {
      setTimeIndex(timestamps.length - 1);
    }
  }, [timeIndex, timestamps.length]);

  const currentTimeMs = timestamps.length > 0 ? timestamps[timeIndex] : null;
  const currentTimeIso =
    currentTimeMs != null ? new Date(currentTimeMs).toISOString() : null;

  const groupByPlayerId = useMemo(() => {
    const map = new Map<
      string,
      { groupId: string; groupLabel?: string | null; playerCount: number }
    >();

    if (!data) return map;

    for (const group of data.groups) {
      for (const playerUserId of group.player_user_ids) {
        map.set(playerUserId, {
          groupId: group.group_id,
          groupLabel: group.label ?? null,
          playerCount: group.player_user_ids.length,
        });
      }
    }

    return map;
  }, [data]);

  const playerPins = useMemo<PlayerPin[]>(() => {
    if (!data || currentTimeMs == null) return [];

    return data.players
      .map((player) => {
        const loc = getLatestLocationAtOrBefore(player, currentTimeMs);
        if (!loc) return null;

        const groupInfo = groupByPlayerId.get(player.user_id);

        return {
          userId: player.user_id,
          email: player.email ?? null,
          latitude: loc.latitude,
          longitude: loc.longitude,
          recordedAt: loc.recorded_at,
          groupId: groupInfo?.groupId ?? null,
          groupLabel: groupInfo?.groupLabel ?? null,
          groupPlayerCount: groupInfo?.playerCount ?? 0,
        };
      })
      .filter((x): x is PlayerPin => x !== null);
  }, [data, currentTimeMs, groupByPlayerId]);

  const groupPins = useMemo<GroupPin[]>(() => {
    if (!data) return [];

    return data.groups
      .map((group) => {
        const playersInGroup = playerPins.filter((pin) =>
          group.player_user_ids.includes(pin.userId)
        );

        if (playersInGroup.length === 0) return null;

        const avgLat =
          playersInGroup.reduce((sum, p) => sum + p.latitude, 0) /
          playersInGroup.length;

        const avgLng =
          playersInGroup.reduce((sum, p) => sum + p.longitude, 0) /
          playersInGroup.length;

        return {
          groupId: group.group_id,
          label: group.label ?? null,
          latitude: avgLat,
          longitude: avgLng,
          playerCount: playersInGroup.length,
        };
      })
      .filter((x): x is GroupPin => x !== null);
  }, [data, playerPins]);

  function loadParsedJson(
    text: string,
    options?: {
      restoredTimeIndex?: number;
      restoredSelectedPlayerId?: string | null;
      restoredSelectedGroupId?: string | null;
    }
  ) {
    setError("");

    try {
      const parsed = JSON.parse(text) as SessionExport;

      if (!parsed.players || !parsed.groups || !parsed.holes) {
        throw new Error("Invalid session JSON structure.");
      }

      const nextTimestamps = getAllTimestamps(parsed);
      const nextTimeIndex =
        nextTimestamps.length === 0
          ? 0
          : Math.min(
              Math.max(options?.restoredTimeIndex ?? 0, 0),
              nextTimestamps.length - 1
            );

      setData(parsed);
      setTimeIndex(nextTimeIndex);
      setSelectedPlayerId(options?.restoredSelectedPlayerId ?? null);
      setSelectedGroupId(options?.restoredSelectedGroupId ?? null);
      setIsPlaying(false);

      if (!options) {
        setMapCenterOverride(null);
        setMapZoomOverride(null);
      }
    } catch (e: any) {
      setData(null);
      setError(e?.message ?? "Failed to parse JSON.");
    }
  }

  async function onFileSelected(file: File) {
    const text = await file.text();
    setJsonText(text);
    loadParsedJson(text);
  }

  function clearSavedState() {
    window.localStorage.removeItem(STORAGE_KEY);
    setData(null);
    setJsonText("");
    setError("");
    setTimeIndex(0);
    setIsPlaying(false);
    setSelectedPlayerId(null);
    setSelectedGroupId(null);
    setViewMode("players");
    setPlaybackSpeed(1);
    setMapCenterOverride(null);
    setMapZoomOverride(null);
  }

  const mapCenter = useMemo<[number, number]>(() => {
    if (mapCenterOverride) return mapCenterOverride;

    if (viewMode === "players" && playerPins.length > 0) {
      return [playerPins[0].latitude, playerPins[0].longitude];
    }

    if (viewMode === "groups" && groupPins.length > 0) {
      return [groupPins[0].latitude, groupPins[0].longitude];
    }

    if (data?.course_landmarks?.length) {
      return [data.course_landmarks[0].latitude, data.course_landmarks[0].longitude];
    }

    if (data?.holes?.length) {
      return [data.holes[0].tee_lat, data.holes[0].tee_lng];
    }

    return [37.7749, -122.4194];
  }, [data, playerPins, groupPins, viewMode, mapCenterOverride]);

  const selectedPlayerPin = useMemo(
    () => playerPins.find((p) => p.userId === selectedPlayerId) ?? null,
    [playerPins, selectedPlayerId]
  );

  const selectedGroupPin = useMemo(
    () => groupPins.find((g) => g.groupId === selectedGroupId) ?? null,
    [groupPins, selectedGroupId]
  );

  const handleViewChange = useCallback(
    (nextCenter: [number, number], nextZoom: number) => {
      setMapCenterOverride((prev) =>
        sameCenter(prev, nextCenter) ? prev : nextCenter
      );
      setMapZoomOverride((prev) => (prev === nextZoom ? prev : nextZoom));
    },
    []
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">
            Session Visualizer
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Upload a session JSON export and scrub through time to see player or group positions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50">
            Upload JSON
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFileSelected(file);
                e.currentTarget.value = "";
              }}
            />
          </label>

          <button
            type="button"
            onClick={clearSavedState}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            Clear saved state
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="grid min-h-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex min-h-0 h-full flex-col gap-6 overflow-hidden">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-900">Session Info</h2>
            <div className="mt-3 space-y-2 text-sm text-zinc-700">
              <div>
                <span className="font-medium">Session:</span>{" "}
                {data?.session_name ?? "—"}
              </div>
              <div>
                <span className="font-medium">Course:</span>{" "}
                {data?.course_name ?? "—"}
              </div>
              <div>
                <span className="font-medium">Current Time:</span>{" "}
                {formatTimestamp(currentTimeIso)}
              </div>
              <div>
                <span className="font-medium">Players Visible:</span>{" "}
                {playerPins.length}
              </div>
              <div>
                <span className="font-medium">Groups Visible:</span>{" "}
                {groupPins.length}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-900">Timeline</h2>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={timestamps.length <= 1}
                  onClick={() => setPlaybackSpeed(1)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium shadow-sm ${
                    playbackSpeed === 1
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  1x
                </button>
                <button
                  type="button"
                  disabled={timestamps.length <= 1}
                  onClick={() => setPlaybackSpeed(2)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium shadow-sm ${
                    playbackSpeed === 2
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  2x
                </button>
                <button
                  type="button"
                  disabled={timestamps.length <= 1}
                  onClick={() => setPlaybackSpeed(4)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium shadow-sm ${
                    playbackSpeed === 4
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  4x
                </button>
                <button
                  type="button"
                  disabled={timestamps.length <= 1}
                  onClick={() => setIsPlaying((prev) => !prev)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
                >
                  {isPlaying ? "Pause" : "Play"}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <input
                type="range"
                min={0}
                max={Math.max(timestamps.length - 1, 0)}
                step={1}
                value={timeIndex}
                onChange={(e) => setTimeIndex(Number(e.target.value))}
                className="w-full"
                disabled={timestamps.length === 0}
              />
            </div>

            <div className="mt-3 flex justify-between text-xs text-zinc-500">
              <span>
                {timestamps.length
                  ? formatTimestamp(new Date(timestamps[0]).toISOString())
                  : "—"}
              </span>
              <span>
                {timestamps.length
                  ? formatTimestamp(
                      new Date(timestamps[timestamps.length - 1]).toISOString()
                    )
                  : "—"}
              </span>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-900">Map View</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode("players")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium shadow-sm ${
                    viewMode === "players"
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  Players
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("groups")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium shadow-sm ${
                    viewMode === "groups"
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  Groups
                </button>
              </div>
            </div>

            {viewMode === "players" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <h3 className="text-sm font-semibold text-zinc-900">Players</h3>
                <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {playerPins.length === 0 ? (
                    <div className="text-sm text-zinc-500">
                      No player positions at this time.
                    </div>
                  ) : (
                    playerPins.map((player) => (
                      <button
                        key={player.userId}
                        type="button"
                        onClick={() => {
                          setSelectedPlayerId(player.userId);
                          setSelectedGroupId(null);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                          selectedPlayerId === player.userId
                            ? "border-zinc-900 bg-zinc-100 text-zinc-900"
                            : "border-zinc-200 bg-zinc-50 text-zinc-800"
                        }`}
                      >
                        <div className="font-medium">{player.email || player.userId}</div>
                        <div className="text-xs text-zinc-500">
                          {player.groupLabel || player.groupId || "No group"}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {formatTimestamp(player.recordedAt)}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <h3 className="text-sm font-semibold text-zinc-900">Groups</h3>
                <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {groupPins.length === 0 ? (
                    <div className="text-sm text-zinc-500">
                      No group positions at this time.
                    </div>
                  ) : (
                    groupPins.map((group) => (
                      <button
                        key={group.groupId}
                        type="button"
                        onClick={() => {
                          setSelectedGroupId(group.groupId);
                          setSelectedPlayerId(null);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                          selectedGroupId === group.groupId
                            ? "border-zinc-900 bg-zinc-100 text-zinc-900"
                            : "border-zinc-200 bg-zinc-50 text-zinc-800"
                        }`}
                      >
                        <div className="font-medium">
                          {group.label || group.groupId}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {group.playerCount} player{group.playerCount === 1 ? "" : "s"}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl">
            <SessionMap
              center={mapCenter}
              initialZoom={mapZoomOverride ?? 16}
              landmarks={data?.course_landmarks ?? []}
              playerPins={playerPins}
              groupPins={groupPins}
              viewMode={viewMode}
              selectedPlayerId={selectedPlayerPin?.userId ?? null}
              selectedGroupId={selectedGroupPin?.groupId ?? null}
              onViewChange={handleViewChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}