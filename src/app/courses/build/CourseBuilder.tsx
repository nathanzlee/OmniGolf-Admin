"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveCourseHoles, HoleInput, CourseLandmarkInput } from "../../actions";
import type { CartPath, MapPin } from "./CourseBuilderMap";

const CourseBuilderMap = dynamic(() => import("./CourseBuilderMap"), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────────────────

type LandmarkType = "putting_green" | "clubhouse" | "driving_range" | "other";

type HoleState = {
  holeNumber: number;
  teeLat: number | null;
  teeLng: number | null;
  greenLat: number | null;
  greenLng: number | null;
  allottedTime: string;
  cartPath: { lat: number; lng: number }[];
};

type LandmarkState = {
  localId: string;
  landmarkType: LandmarkType;
  ep1Lat: number | null;
  ep1Lng: number | null;
  ep2Lat: number | null;
  ep2Lng: number | null;
};

type ActiveField =
  | { kind: "tee"; holeIndex: number }
  | { kind: "green"; holeIndex: number }
  | { kind: "cartPath"; holeIndex: number }
  | { kind: "lm_ep1"; lmIndex: number }
  | { kind: "lm_ep2"; lmIndex: number };

// ── Constants ──────────────────────────────────────────────────────────────────

const LANDMARK_LABELS: Record<LandmarkType, string> = {
  putting_green: "Putting Green",
  clubhouse: "Clubhouse",
  driving_range: "Driving Range",
  other: "Other",
};

const LANDMARK_TYPES: LandmarkType[] = [
  "putting_green",
  "clubhouse",
  "driving_range",
  "other",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2);
}

function fmtCoord(v: number | null) {
  if (v === null) return null;
  return v.toFixed(5);
}

function initHoles(): HoleState[] {
  return Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    teeLat: null,
    teeLng: null,
    greenLat: null,
    greenLng: null,
    allottedTime: "12",
    cartPath: [],
  }));
}

// ── FieldButton ────────────────────────────────────────────────────────────────

function FieldButton({
  label,
  lat,
  lng,
  isActive,
  onClick,
}: {
  label: string;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
  onClick: () => void;
}) {
  const isSet = lat !== null;
  return (
    <button
      type="button"
      title={isSet ? `${fmtCoord(lat)}, ${fmtCoord(lng)}` : `Click to set ${label}`}
      onClick={onClick}
      className={`flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        isActive
          ? "bg-blue-600 text-white ring-2 ring-blue-300 ring-offset-1"
          : isSet
          ? "border border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
          : "border border-zinc-200 bg-zinc-50 text-zinc-400 hover:bg-zinc-100"
      }`}
    >
      <span className="shrink-0">{isActive ? "▸" : isSet ? "●" : "○"}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// ── CartPathButton ─────────────────────────────────────────────────────────────

function CartPathButton({
  pointCount,
  isActive,
  onClick,
  onClear,
}: {
  pointCount: number;
  isActive: boolean;
  onClick: () => void;
  onClear: () => void;
}) {
  const isSet = pointCount > 0;
  return (
    <div className="flex min-w-0 flex-1 gap-0.5">
      <button
        type="button"
        title={isSet ? `${pointCount} cart path point${pointCount === 1 ? "" : "s"}` : "Click to add cart path waypoints"}
        onClick={onClick}
        className={`flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          isActive
            ? "bg-blue-600 text-white ring-2 ring-blue-300 ring-offset-1"
            : isSet
            ? "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
            : "border border-zinc-200 bg-zinc-50 text-zinc-400 hover:bg-zinc-100"
        }`}
      >
        <span className="shrink-0">{isActive ? "▸" : isSet ? "●" : "○"}</span>
        <span className="truncate">{isSet ? `Path (${pointCount})` : "Path"}</span>
      </button>
      {isSet && (
        <button
          type="button"
          title="Clear cart path"
          onClick={onClear}
          className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-500"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CourseBuilder({
  courseOptions,
  initialCourseId,
}: {
  courseOptions: { id: string; name: string }[];
  initialCourseId?: string;
}) {
  const router = useRouter();
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState("");
  const [holes, setHoles] = useState<HoleState[]>(initHoles);
  const [landmarks, setLandmarks] = useState<LandmarkState[]>([]);
  const [activeField, setActiveField] = useState<ActiveField | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [fitKey, setFitKey] = useState(0);

  // Auto-load course from URL param on mount
  useEffect(() => {
    if (initialCourseId) handleLoadCourse(initialCourseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [message, setMessage] = useState("");

  // ── Load existing course ───────────────────────────────────────────────────

  async function handleLoadCourse(courseId: string) {
    if (!courseId) {
      setEditingCourseId(null);
      setCourseName("");
      setHoles(initHoles());
      setLandmarks([]);
      setActiveField(null);
      setMessage("");
      return;
    }
    setLoadingCourse(true);
    setMessage("");
    try {
      const res = await fetch(`/api/courses/${courseId}/data`);
      if (!res.ok) throw new Error("Failed to load course");
      const data = await res.json();

      setEditingCourseId(data.course.id);
      setCourseName(data.course.name);

      const loadedByNumber: Record<number, HoleInput> = {};
      for (const h of data.holes) loadedByNumber[h.holeNumber] = h;

      const cartPathByHole: Record<number, { lat: number; lng: number }[]> = {};
      for (const cp of data.cartPaths ?? []) {
        cartPathByHole[cp.holeNumber] = cp.coordinates ?? [];
      }

      setHoles(
        initHoles().map((blank) => {
          const h = loadedByNumber[blank.holeNumber];
          if (!h) return blank;
          return {
            holeNumber: h.holeNumber,
            teeLat: h.teeLat ?? null,
            teeLng: h.teeLng ?? null,
            greenLat: h.greenLat ?? null,
            greenLng: h.greenLng ?? null,
            allottedTime: String(h.allottedTime),
            cartPath: cartPathByHole[h.holeNumber] ?? [],
          };
        })
      );

      setLandmarks(
        (data.landmarks ?? []).map((l: CourseLandmarkInput) => ({
          localId: makeId(),
          landmarkType: l.landmarkType,
          ep1Lat: l.endpoint1Lat,
          ep1Lng: l.endpoint1Lng,
          ep2Lat: l.endpoint2Lat ?? null,
          ep2Lng: l.endpoint2Lng ?? null,
        }))
      );

      setActiveField(null);
      setFitKey((k) => k + 1);
    } catch (e: unknown) {
      setMessage(`❌ ${e instanceof Error ? e.message : "Failed to load course."}`);
    } finally {
      setLoadingCourse(false);
    }
  }

  // ── Active field label ─────────────────────────────────────────────────────

  const activeLabel = useMemo(() => {
    if (!activeField) return null;
    if (activeField.kind === "tee") return `Hole ${activeField.holeIndex + 1} Tee Box`;
    if (activeField.kind === "green") return `Hole ${activeField.holeIndex + 1} Green`;
    if (activeField.kind === "cartPath") {
      const n = holes[activeField.holeIndex].cartPath.length;
      return `Hole ${activeField.holeIndex + 1} Cart Path${n > 0 ? ` (${n} pts)` : ""}`;
    }
    const lm = landmarks[activeField.lmIndex];
    const type = LANDMARK_LABELS[lm?.landmarkType ?? "other"];
    return activeField.kind === "lm_ep1" ? type : `${type} (far end)`;
  }, [activeField, holes, landmarks]);

  // ── Map pins ───────────────────────────────────────────────────────────────

  const pins = useMemo<MapPin[]>(() => {
    const result: MapPin[] = [];
    for (const h of holes) {
      if (h.teeLat !== null)
        result.push({ id: `tee-${h.holeNumber}`, lat: h.teeLat, lng: h.teeLng!, kind: "tee", label: `T${h.holeNumber}` });
      if (h.greenLat !== null)
        result.push({ id: `green-${h.holeNumber}`, lat: h.greenLat, lng: h.greenLng!, kind: "green", label: `G${h.holeNumber}` });
    }
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      const typeLabel = LANDMARK_LABELS[lm.landmarkType];
      if (lm.ep1Lat !== null)
        result.push({ id: `lm-${lm.localId}-1`, lat: lm.ep1Lat, lng: lm.ep1Lng!, kind: "landmark", label: typeLabel });
      if (lm.ep2Lat !== null)
        result.push({ id: `lm-${lm.localId}-2`, lat: lm.ep2Lat, lng: lm.ep2Lng!, kind: "landmark", label: `${typeLabel} ②` });
    }
    return result;
  }, [holes, landmarks]);

  // ── Cart paths ─────────────────────────────────────────────────────────────

  const cartPaths = useMemo<CartPath[]>(
    () =>
      holes
        .filter((h) => h.cartPath.length > 0)
        .map((h) => ({ holeNumber: h.holeNumber, points: h.cartPath })),
    [holes]
  );

  // ── Map click handler ──────────────────────────────────────────────────────

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!activeField) return;

      if (activeField.kind === "tee") {
        setHoles((prev) =>
          prev.map((h, i) =>
            i === activeField.holeIndex ? { ...h, teeLat: lat, teeLng: lng } : h
          )
        );
        setActiveField({ kind: "green", holeIndex: activeField.holeIndex });
      } else if (activeField.kind === "green") {
        setHoles((prev) =>
          prev.map((h, i) =>
            i === activeField.holeIndex ? { ...h, greenLat: lat, greenLng: lng } : h
          )
        );
        const next = activeField.holeIndex + 1;
        setActiveField(next < 18 ? { kind: "tee", holeIndex: next } : null);
      } else if (activeField.kind === "cartPath") {
        const idx = activeField.holeIndex;
        setHoles((prev) =>
          prev.map((h, i) =>
            i === idx ? { ...h, cartPath: [...h.cartPath, { lat, lng }] } : h
          )
        );
        // Stay active so user can keep adding points
      } else if (activeField.kind === "lm_ep1") {
        setLandmarks((prev) =>
          prev.map((lm, i) =>
            i === activeField.lmIndex ? { ...lm, ep1Lat: lat, ep1Lng: lng } : lm
          )
        );
        const lm = landmarks[activeField.lmIndex];
        setActiveField(
          lm?.landmarkType === "driving_range"
            ? { kind: "lm_ep2", lmIndex: activeField.lmIndex }
            : null
        );
      } else if (activeField.kind === "lm_ep2") {
        setLandmarks((prev) =>
          prev.map((lm, i) =>
            i === activeField.lmIndex ? { ...lm, ep2Lat: lat, ep2Lng: lng } : lm
          )
        );
        setActiveField(null);
      }
    },
    [activeField, landmarks]
  );

  function undoLastCartPathPoint() {
    if (activeField?.kind !== "cartPath") return;
    const i = activeField.holeIndex;
    setHoles((prev) =>
      prev.map((h, idx) =>
        idx === i ? { ...h, cartPath: h.cartPath.slice(0, -1) } : h
      )
    );
  }

  function toggleActive(field: ActiveField) {
    setActiveField((prev) => {
      const same =
        prev?.kind === field.kind &&
        (field.kind === "tee" || field.kind === "green" || field.kind === "cartPath"
          ? (prev as { holeIndex: number }).holeIndex ===
            (field as { holeIndex: number }).holeIndex
          : (prev as { lmIndex: number }).lmIndex ===
            (field as { lmIndex: number }).lmIndex);
      return same ? null : field;
    });
  }

  // ── Landmarks ──────────────────────────────────────────────────────────────

  function addLandmark() {
    setLandmarks((prev) => [
      ...prev,
      { localId: makeId(), landmarkType: "clubhouse", ep1Lat: null, ep1Lng: null, ep2Lat: null, ep2Lng: null },
    ]);
  }

  function updateLandmarkType(i: number, type: LandmarkType) {
    setLandmarks((prev) =>
      prev.map((lm, idx) =>
        idx === i ? { ...lm, landmarkType: type, ep2Lat: null, ep2Lng: null } : lm
      )
    );
    setActiveField((af) => (af?.kind === "lm_ep2" && af.lmIndex === i ? null : af));
  }

  function removeLandmark(i: number) {
    setLandmarks((prev) => prev.filter((_, idx) => idx !== i));
    setActiveField((af) => {
      if (!af) return null;
      if (af.kind === "lm_ep1" || af.kind === "lm_ep2") {
        if (af.lmIndex === i) return null;
        if (af.lmIndex > i) return { ...af, lmIndex: af.lmIndex - 1 };
      }
      return af;
    });
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    setMessage("");
    if (!courseName.trim()) {
      setMessage("❌ Course name is required.");
      return;
    }

    const unset = holes.filter((h) => h.teeLat === null || h.greenLat === null);
    if (unset.length > 0) {
      setMessage(
        `❌ ${unset.length} hole(s) missing coordinates (holes: ${unset.map((h) => h.holeNumber).join(", ")}).`
      );
      return;
    }

    const holesInput: HoleInput[] = holes.map((h) => ({
      holeNumber: h.holeNumber,
      teeLat: h.teeLat!,
      teeLng: h.teeLng!,
      greenLat: h.greenLat!,
      greenLng: h.greenLng!,
      allottedTime: Math.max(1, parseInt(h.allottedTime, 10) || 12),
      cartPathPoints: h.cartPath,
    }));

    const landmarksInput: CourseLandmarkInput[] = landmarks
      .filter((lm) => lm.ep1Lat !== null)
      .map((lm) => ({
        landmarkType: lm.landmarkType,
        endpoint1Lat: lm.ep1Lat!,
        endpoint1Lng: lm.ep1Lng!,
        ...(lm.ep2Lat !== null ? { endpoint2Lat: lm.ep2Lat!, endpoint2Lng: lm.ep2Lng! } : {}),
      }));

    setIsSaving(true);
    try {
      const result = await saveCourseHoles({
        courseId: editingCourseId ?? undefined,
        courseName,
        holes: holesInput,
        landmarks: landmarksInput,
      });
      router.push(`/courses/${result.courseId}`);
    } catch (e: unknown) {
      setMessage(`❌ ${e instanceof Error ? e.message : "Save failed."}`);
    } finally {
      setIsSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const inputCls =
    "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3">
        <h1 className="text-xl font-semibold text-zinc-900">Build Course</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Click a button in the holes table, then click the map to place that pin.
          Tee/Green auto-advance through all 18 holes. Cart path appends waypoints until you click Done.
        </p>
      </div>

      {/* Active field status banner */}
      {activeLabel && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2">
          <span className="text-sm font-medium text-blue-700">
            {activeField?.kind === "cartPath" ? "Click map to add: " : "Click map to place: "}
            <strong>{activeLabel}</strong>
          </span>
          <div className="flex items-center gap-3">
            {activeField?.kind === "cartPath" && holes[activeField.holeIndex].cartPath.length > 0 && (
              <button
                type="button"
                onClick={undoLastCartPathPoint}
                className="text-xs text-blue-500 hover:text-blue-700"
              >
                Undo last
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveField(null)}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[380px_1fr] gap-4 overflow-hidden">
        {/* ── Left panel ── */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          {/* Load existing course */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Load Existing Course
            </label>
            <select
              value={editingCourseId ?? ""}
              onChange={(e) => handleLoadCourse(e.target.value)}
              disabled={loadingCourse}
              className={inputCls + " w-full"}
            >
              <option value="">— New course —</option>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {loadingCourse && <p className="mt-1 text-xs text-zinc-400">Loading…</p>}
            {editingCourseId && !loadingCourse && (
              <p className="mt-1 text-xs text-amber-600">
                Editing existing course — Save will update in place.
              </p>
            )}
          </div>

          {/* Course name */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Course Name
            </label>
            <input
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="e.g. Pebble Beach Golf Links"
              className={inputCls + " w-full"}
            />
          </div>

          {/* Holes table */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-zinc-900">Holes</h2>
            </div>
            <div className="divide-y divide-zinc-100">
              {holes.map((hole, i) => {
                const teeActive = activeField?.kind === "tee" && activeField.holeIndex === i;
                const greenActive = activeField?.kind === "green" && activeField.holeIndex === i;
                const cartPathActive = activeField?.kind === "cartPath" && activeField.holeIndex === i;
                return (
                  <div key={hole.holeNumber} className="flex items-center gap-1.5 px-3 py-1.5">
                    <span className="w-5 shrink-0 text-center text-xs font-semibold text-zinc-500">
                      {hole.holeNumber}
                    </span>
                    <FieldButton
                      label="Tee"
                      lat={hole.teeLat}
                      lng={hole.teeLng}
                      isActive={teeActive}
                      onClick={() => toggleActive({ kind: "tee", holeIndex: i })}
                    />
                    <FieldButton
                      label="Green"
                      lat={hole.greenLat}
                      lng={hole.greenLng}
                      isActive={greenActive}
                      onClick={() => toggleActive({ kind: "green", holeIndex: i })}
                    />
                    <CartPathButton
                      pointCount={hole.cartPath.length}
                      isActive={cartPathActive}
                      onClick={() => toggleActive({ kind: "cartPath", holeIndex: i })}
                      onClear={() =>
                        setHoles((prev) =>
                          prev.map((h, idx) => (idx === i ? { ...h, cartPath: [] } : h))
                        )
                      }
                    />
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={hole.allottedTime}
                      onChange={(e) =>
                        setHoles((prev) =>
                          prev.map((h, idx) =>
                            idx === i ? { ...h, allottedTime: e.target.value } : h
                          )
                        )
                      }
                      title="Allotted time (minutes)"
                      placeholder="min"
                      className="w-12 shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-center text-xs text-zinc-900 outline-none focus:border-zinc-400"
                    />
                  </div>
                );
              })}
            </div>
            <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-400">
              Min = allotted time · Path = cart path waypoints (red dashes on map)
            </div>
          </div>

          {/* Landmarks */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-zinc-900">Landmarks</h2>
              <button
                type="button"
                onClick={addLandmark}
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                + Add
              </button>
            </div>
            {landmarks.length === 0 ? (
              <p className="px-4 py-3 text-xs text-zinc-400">
                No landmarks yet. Click + Add to add putting greens, clubhouse, etc.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100">
                {landmarks.map((lm, i) => {
                  const ep1Active = activeField?.kind === "lm_ep1" && activeField.lmIndex === i;
                  const ep2Active = activeField?.kind === "lm_ep2" && activeField.lmIndex === i;
                  const isDrivingRange = lm.landmarkType === "driving_range";
                  return (
                    <div key={lm.localId} className="flex flex-col gap-1.5 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={lm.landmarkType}
                          onChange={(e) => updateLandmarkType(i, e.target.value as LandmarkType)}
                          className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                        >
                          {LANDMARK_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {LANDMARK_LABELS[t]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeLandmark(i)}
                          className="shrink-0 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex gap-1.5">
                        <FieldButton
                          label={isDrivingRange ? "Start" : "Location"}
                          lat={lm.ep1Lat}
                          lng={lm.ep1Lng}
                          isActive={ep1Active}
                          onClick={() => toggleActive({ kind: "lm_ep1", lmIndex: i })}
                        />
                        {isDrivingRange && (
                          <FieldButton
                            label="Far End"
                            lat={lm.ep2Lat}
                            lng={lm.ep2Lng}
                            isActive={ep2Active}
                            onClick={() => toggleActive({ kind: "lm_ep2", lmIndex: i })}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pb-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : editingCourseId ? "Update Course" : "Save Course"}
            </button>
            {message && <p className="font-mono text-xs text-zinc-700">{message}</p>}
          </div>
        </div>

        {/* ── Map panel ── */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <CourseBuilderMap
            pins={pins}
            cartPaths={cartPaths}
            fitKey={fitKey}
            isPlacingPin={!!activeField}
            onMapClick={handleMapClick}
          />
        </div>
      </div>
    </div>
  );
}
