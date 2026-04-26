"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type PinKind = "tee" | "green" | "landmark";

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
  label: string;
};

export type CartPath = {
  holeNumber: number;
  points: { lat: number; lng: number }[];
};

// Fix default Leaflet icon paths broken by webpack
function fixLeafletIcons() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

const TEE_COLOR = "#2563eb";
const GREEN_COLOR = "#16a34a";
const LANDMARK_COLOR = "#b45309";
const CART_PATH_COLOR = "#ef4444";

function makePinIcon(kind: PinKind, label: string, isActive = false) {
  const bg = kind === "tee" ? TEE_COLOR : kind === "green" ? GREEN_COLOR : LANDMARK_COLOR;
  const ring = isActive ? `box-shadow:0 0 0 3px ${bg},0 0 0 5px rgba(255,255,255,0.6);` : "";
  const size = isActive ? 14 : 10;
  const anchor = isActive ? 7 : 5;
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none">
      <div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2px solid white;${ring}box-shadow:${ring ? "" : "0 1px 3px rgba(0,0,0,0.35)"}"></div>
      <div style="font-size:9px;font-weight:700;color:${bg};white-space:nowrap;text-shadow:-1px -1px 0 white,1px -1px 0 white,-1px 1px 0 white,1px 1px 0 white;line-height:1">${label}</div>
    </div>`,
    iconSize: [50, 28],
    iconAnchor: [25, anchor],
  });
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

function AutoFitPins({ pins, fitKey }: { pins: MapPin[]; fitKey: number }) {
  const map = useMap();
  const prevFitKey = useRef(-1);

  useEffect(() => {
    if (pins.length === 0) return;
    // Fit on first appearance of pins, or whenever fitKey increments
    if (prevFitKey.current === fitKey && prevFitKey.current !== -1) return;
    prevFitKey.current = fitKey;
    const latlngs = pins.map((p) => [p.lat, p.lng] as [number, number]);
    map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 17 });
  }, [map, pins, fitKey]);

  return null;
}

export default function CourseBuilderMap({
  pins,
  cartPaths,
  fitKey,
  isPlacingPin,
  onMapClick,
}: {
  pins: MapPin[];
  cartPaths: CartPath[];
  fitKey: number;
  isPlacingPin: boolean;
  onMapClick: (lat: number, lng: number) => void;
}) {
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    fixLeafletIcons();
  }, []);

  return (
    <div
      className="h-full w-full overflow-hidden rounded-2xl border border-zinc-200 shadow-sm"
      style={{ cursor: isPlacingPin ? "crosshair" : undefined }}
    >
      <MapContainer
        center={[39.5, -98.35]}
        zoom={4}
        style={{ height: "100%", width: "100%" }}
        ref={mapRef}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler active={isPlacingPin} onMapClick={onMapClick} />
        <AutoFitPins pins={pins} fitKey={fitKey} />
        {cartPaths.map((cp) =>
          cp.points.length > 1 ? (
            <Polyline
              key={`cp-${cp.holeNumber}`}
              positions={cp.points.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{
                color: CART_PATH_COLOR,
                weight: 2,
                dashArray: "5 5",
                opacity: 0.85,
              }}
            />
          ) : null
        )}
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={makePinIcon(pin.kind, pin.label)}
          />
        ))}
      </MapContainer>
    </div>
  );
}
