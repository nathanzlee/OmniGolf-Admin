"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useEffect, useRef } from "react";

type CourseLandmark = {
  id: string;
  landmark_type: "putting_green" | "clubhouse" | "driving_range" | "other";
  latitude: number;
  longitude: number;
};

type PlayerPin = {
  userId: string;
  email?: string | null;
  latitude: number;
  longitude: number;
  recordedAt: string;
  groupId?: string | null;
  groupLabel?: string | null;
  groupPlayerCount: number;
};

type GroupPin = {
  groupId: string;
  label?: string | null;
  latitude: number;
  longitude: number;
  playerCount: number;
};

type ViewMode = "players" | "groups";

const playerIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      background: #2563eb;
      border: 2px solid white;
      box-shadow: 0 0 0 2px rgba(37,99,235,0.35);
    "></div>
  `,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const groupIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      background: #16a34a;
      border: 2px solid white;
      box-shadow: 0 0 0 2px rgba(22,163,74,0.35);
    "></div>
  `,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const selectedPlayerIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      background: #1e3a8a;
      box-shadow: 0 0 0 2px rgba(30,58,138,0.5), 0 1px 3px rgba(0,0,0,0.3);
    "></div>
  `,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const selectedGroupIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      background: #14532d;
      box-shadow: 0 0 0 2px rgba(20,83,45,0.5), 0 1px 3px rgba(0,0,0,0.3);
    "></div>
  `,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const landmarkIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width: 12px;
      height: 12px;
      border-radius: 9999px;
      background: #a16207;
      border: 2px solid white;
      box-shadow: 0 0 0 2px rgba(161,98,7,0.30);
    "></div>
  `,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function MapViewListener({
  onViewChange,
}: {
  onViewChange?: (center: [number, number], zoom: number) => void;
}) {
  useMapEvents({
    moveend(e) {
      const map = e.target;
      const c = map.getCenter();
      onViewChange?.([c.lat, c.lng], map.getZoom());
    },
    zoomend(e) {
      const map = e.target;
      const c = map.getCenter();
      onViewChange?.([c.lat, c.lng], map.getZoom());
    },
  });

  return null;
}

function MapAutoFocus({
  viewMode,
  playerPins,
  groupPins,
  landmarks,
  selectedPlayerId,
  selectedGroupId,
  dataKey,
  playerPopupRefs,
  groupPopupRefs,
}: {
  viewMode: ViewMode;
  playerPins: PlayerPin[];
  groupPins: GroupPin[];
  landmarks: CourseLandmark[];
  selectedPlayerId: string | null;
  selectedGroupId: string | null;
  dataKey: number;
  playerPopupRefs: React.MutableRefObject<Record<string, L.Marker | null>>;
  groupPopupRefs: React.MutableRefObject<Record<string, L.Marker | null>>;
}) {
  const map = useMap();
  const hasFitInitially = useRef(false);
  const lastSelectedPlayerRef = useRef<string | null>(null);
  const lastSelectedGroupRef = useRef<string | null>(null);

  // Keep latest pins in refs so effects can read them without causing re-runs every tick
  const playerPinsRef = useRef(playerPins);
  const groupPinsRef = useRef(groupPins);
  playerPinsRef.current = playerPins;
  groupPinsRef.current = groupPins;

  // Reset initial fit flag when new data is loaded
  useEffect(() => {
    hasFitInitially.current = false;
  }, [dataKey]);

  useEffect(() => {
    const pins = playerPinsRef.current;
    const gPins = groupPinsRef.current;

    if (viewMode === "players" && selectedPlayerId) {
      if (lastSelectedPlayerRef.current === selectedPlayerId) return;

      const selected = pins.find((p) => p.userId === selectedPlayerId);
      if (selected) {
        lastSelectedPlayerRef.current = selectedPlayerId;
        map.setView(
          [selected.latitude, selected.longitude],
          Math.max(map.getZoom(), 17),
          { animate: true }
        );

        window.setTimeout(() => {
          const marker = playerPopupRefs.current[selected.userId];
          marker?.openPopup();
        }, 0);
      }
      return;
    }

    if (viewMode === "groups" && selectedGroupId) {
      if (lastSelectedGroupRef.current === selectedGroupId) return;

      const selected = gPins.find((g) => g.groupId === selectedGroupId);
      if (selected) {
        lastSelectedGroupRef.current = selectedGroupId;
        map.setView(
          [selected.latitude, selected.longitude],
          Math.max(map.getZoom(), 17),
          { animate: true }
        );

        window.setTimeout(() => {
          const marker = groupPopupRefs.current[selected.groupId];
          marker?.openPopup();
        }, 0);
      }
      return;
    }

    if (viewMode !== "players") {
      lastSelectedPlayerRef.current = null;
    }
    if (viewMode !== "groups") {
      lastSelectedGroupRef.current = null;
    }

    if (hasFitInitially.current) return;

    const modePoints: [number, number][] =
      viewMode === "players"
        ? pins.map((p) => [p.latitude, p.longitude] as [number, number])
        : gPins.map((g) => [g.latitude, g.longitude] as [number, number]);

    const points: [number, number][] = [
      ...modePoints,
      ...landmarks.map((l) => [l.latitude, l.longitude] as [number, number]),
    ];

    if (points.length === 0) return;

    if (points.length === 1) {
      map.setView(points[0], 17, { animate: true });
      hasFitInitially.current = true;
      return;
    }

    map.fitBounds(points, { padding: [40, 40] });
    hasFitInitially.current = true;
  }, [
    map,
    viewMode,
    landmarks,
    selectedPlayerId,
    selectedGroupId,
    playerPopupRefs,
    groupPopupRefs,
    dataKey,
  ]);

  return null;
}

export default function SessionMap({
  center,
  initialZoom,
  landmarks,
  playerPins,
  groupPins,
  viewMode,
  selectedPlayerId,
  selectedGroupId,
  dataKey,
  onViewChange,
}: {
  center: [number, number];
  initialZoom: number;
  landmarks: CourseLandmark[];
  playerPins: PlayerPin[];
  groupPins: GroupPin[];
  viewMode: ViewMode;
  selectedPlayerId: string | null;
  selectedGroupId: string | null;
  dataKey: number;
  onViewChange?: (center: [number, number], zoom: number) => void;
}) {
  const playerMarkerRefs = useRef<Record<string, L.Marker | null>>({});
  const groupMarkerRefs = useRef<Record<string, L.Marker | null>>({});

  useEffect(() => {
    delete (L.Icon.Default.prototype as any)._getIconUrl;
  }, []);

  return (
    <MapContainer center={center} zoom={initialZoom} scrollWheelZoom className="h-full w-full">
      <MapViewListener onViewChange={onViewChange} />

      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapAutoFocus
        viewMode={viewMode}
        playerPins={playerPins}
        groupPins={groupPins}
        landmarks={landmarks}
        selectedPlayerId={selectedPlayerId}
        selectedGroupId={selectedGroupId}
        dataKey={dataKey}
        playerPopupRefs={playerMarkerRefs}
        groupPopupRefs={groupMarkerRefs}
      />

      {landmarks.map((landmark) => (
        <Marker
          key={landmark.id}
          position={[landmark.latitude, landmark.longitude]}
          icon={landmarkIcon}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-medium">Landmark</div>
              <div>{landmark.landmark_type}</div>
            </div>
          </Popup>
        </Marker>
      ))}

      {viewMode === "players" &&
        playerPins.map((player) => (
          <Marker
            key={player.userId}
            position={[player.latitude, player.longitude]}
            icon={player.userId === selectedPlayerId ? selectedPlayerIcon : playerIcon}
            ref={(ref) => {
              playerMarkerRefs.current[player.userId] = ref;
            }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-medium">{player.email || player.userId}</div>
                <div>Group: {player.groupLabel || player.groupId || "—"}</div>
                <div>Players in group: {player.groupPlayerCount ?? 0}</div>
                <div>{new Date(player.recordedAt).toLocaleString()}</div>
              </div>
            </Popup>
          </Marker>
        ))}

      {viewMode === "groups" &&
        groupPins.map((group) => (
          <Marker
            key={group.groupId}
            position={[group.latitude, group.longitude]}
            icon={group.groupId === selectedGroupId ? selectedGroupIcon : groupIcon}
            ref={(ref) => {
              groupMarkerRefs.current[group.groupId] = ref;
            }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-medium">{group.label || group.groupId}</div>
                <div>Players in group: {group.playerCount}</div>
              </div>
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}
