"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type LocationPin = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  index: number;
  isActivePlayer: boolean;
  playerName: string;
};

export type ViewTarget = {
  key: number;
  latlngs: [number, number][];
};

function makeLocationIcon(color: string, index: number, isActivePlayer: boolean) {
  const size = isActivePlayer ? 22 : 12;
  const anchor = size / 2;
  const inner = isActivePlayer
    ? `<span style="font-size:9px;font-weight:800;color:white;line-height:1">${index}</span>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center">${inner}</div>`,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
}

function ViewHandler({ target }: { target: ViewTarget | null }) {
  const map = useMap();
  const prevKey = useRef(-1);

  useEffect(() => {
    if (!target || target.key === prevKey.current) return;
    prevKey.current = target.key;
    if (target.latlngs.length === 1) {
      map.flyTo(target.latlngs[0], Math.max(map.getZoom(), 15), { animate: true, duration: 0.8 });
    } else {
      map.fitBounds(L.latLngBounds(target.latlngs), { padding: [60, 60], maxZoom: 17, animate: true });
    }
  }, [map, target]);

  return null;
}

function ClickHandler({
  active,
  onMapClick,
}: {
  active: boolean;
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (active) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function TestCaseBuilderMap({
  pins,
  isPlacing,
  viewTarget,
  onMapClick,
}: {
  pins: LocationPin[];
  isPlacing: boolean;
  viewTarget?: ViewTarget | null;
  onMapClick: (lat: number, lng: number) => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);

  return (
    <div
      className="h-full w-full overflow-hidden rounded-2xl border border-zinc-200 shadow-sm"
      style={{ cursor: isPlacing ? "crosshair" : undefined }}
    >
      <MapContainer
        center={[39.5, -98.35]}
        zoom={4}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ViewHandler target={viewTarget ?? null} />
        <ClickHandler active={isPlacing} onMapClick={onMapClick} />
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={makeLocationIcon(pin.color, pin.index, pin.isActivePlayer)}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={0.9}>
              <span className="text-xs">
                <strong>{pin.playerName}</strong> #{pin.index}
              </span>
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
