"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  deleteCourse,
  saveCourseHoles,
  HoleInput,
  CourseLandmarkInput,
} from "../../actions";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import { TrashIcon } from "@/components/ActionIcons";
import CourseSubnav from "../CourseSubnav";

type Course = { id: string; name: string; created_at: string };

type HoleRow = {
  holeNumber: number;
  teeLat: string;
  teeLng: string;
  greenLat: string;
  greenLng: string;
  allottedTime: string;
};

type LandmarkRow = {
  id?: string;
  landmarkType: "putting_green" | "clubhouse" | "driving_range" | "other";
  latitude: string;
  longitude: string;
  endLatitude: string;
  endLongitude: string;
};

const numInput =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

const labelInput =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

function fromInitial(initial: HoleInput[]): HoleRow[] {
  const byNum = new Map<number, HoleInput>(initial.map((h) => [h.holeNumber, h]));

  return Array.from({ length: 18 }, (_, i) => {
    const holeNumber = i + 1;
    const h = byNum.get(holeNumber);

    return {
      holeNumber,
      teeLat: h ? String(h.teeLat) : "",
      teeLng: h ? String(h.teeLng) : "",
      greenLat: h ? String(h.greenLat) : "",
      greenLng: h ? String(h.greenLng) : "",
      allottedTime: h ? String(h.allottedTime) : "",
    };
  });
}

function fromInitialLandmarks(initial: CourseLandmarkInput[]): LandmarkRow[] {
  return initial.map((l) => ({
    id: l.id,
    landmarkType: l.landmarkType,
    latitude: l.endpoint1Lat != null ? String(l.endpoint1Lat) : "",
    longitude: l.endpoint1Lng != null ? String(l.endpoint1Lng) : "",
    endLatitude: l.endpoint2Lat != null ? String(l.endpoint2Lat) : "",
    endLongitude: l.endpoint2Lng != null ? String(l.endpoint2Lng) : "",
  }));
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result.map((s) => s.trim());
}

function parseCsv(text: string): HoleRow[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const headers = splitCsvLine(lines[0]);

  const expectedHeaders = [
    "hole",
    "tee_lat",
    "tee_lng",
    "green_lat",
    "green_lng",
    "allotted_time",
  ];

  const matchesExactly =
    headers.length === expectedHeaders.length &&
    headers.every((header, index) => header === expectedHeaders[index]);

  if (!matchesExactly) {
    throw new Error(
      "CSV headers must be exactly: hole,tee_lat,tee_lng,green_lat,green_lng,allotted_time"
    );
  }

  const holes: HoleRow[] = Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    teeLat: "",
    teeLng: "",
    greenLat: "",
    greenLng: "",
    allottedTime: "",
  }));

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const cols = splitCsvLine(lines[rowIndex]);

    if (cols.length < 6) {
      throw new Error(`CSV row ${rowIndex + 1} does not have 6 columns.`);
    }

    const holeRaw = cols[0] ?? "";
    const teeLatRaw = cols[1] ?? "";
    const teeLngRaw = cols[2] ?? "";
    const greenLatRaw = cols[3] ?? "";
    const greenLngRaw = cols[4] ?? "";
    const allottedTimeRaw = cols[5] ?? "";

    const holeNumber = Number(holeRaw);

    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
      throw new Error(`Invalid hole value on CSV row ${rowIndex + 1}: "${holeRaw}"`);
    }

    const coordValues = [teeLatRaw, teeLngRaw, greenLatRaw, greenLngRaw].map((v) => Number(v));
    if (coordValues.some((v) => !Number.isFinite(v))) {
      throw new Error(`Invalid coordinate value on CSV row ${rowIndex + 1}.`);
    }

    const allottedTime = Number(allottedTimeRaw);
    if (!Number.isInteger(allottedTime) || allottedTime <= 0) {
      throw new Error(`Invalid allotted_time on CSV row ${rowIndex + 1}.`);
    }

    holes[holeNumber - 1] = {
      holeNumber,
      teeLat: String(coordValues[0]),
      teeLng: String(coordValues[1]),
      greenLat: String(coordValues[2]),
      greenLng: String(coordValues[3]),
      allottedTime: String(allottedTime),
    };
  }

  return holes;
}

function escapeCsvValue(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export default function CourseEditor({
  course,
  initialHoles,
  initialLandmarks,
}: {
  course: Course;
  initialHoles: HoleInput[];
  initialLandmarks: CourseLandmarkInput[];
}) {
  const router = useRouter();

  const [courseName, setCourseName] = useState(course.name);
  const [holes, setHoles] = useState<HoleRow[]>(() => fromInitial(initialHoles));
  const [landmarks, setLandmarks] = useState<LandmarkRow[]>(() =>
    fromInitialLandmarks(initialLandmarks)
  );
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const canSave = useMemo(() => {
    if (!courseName.trim()) return false;

    const holesValid = holes.every(
      (h) =>
        h.teeLat &&
        h.teeLng &&
        h.greenLat &&
        h.greenLng &&
        h.allottedTime &&
        Number.isInteger(Number(h.allottedTime)) &&
        Number(h.allottedTime) > 0
    );

    const landmarksValid = landmarks.every((l) => {
      if (!l.latitude || !l.longitude) return false;
      if (!Number.isFinite(Number(l.latitude)) || !Number.isFinite(Number(l.longitude))) return false;
      if (l.landmarkType === "driving_range" && (l.endLatitude || l.endLongitude)) {
        return (
          Number.isFinite(Number(l.endLatitude)) &&
          Number.isFinite(Number(l.endLongitude))
        );
      }
      return true;
    });

    return holesValid && landmarksValid;
  }, [courseName, holes, landmarks]);

  function updateHole(
    holeNumber: number,
    field: "teeLat" | "teeLng" | "greenLat" | "greenLng" | "allottedTime",
    value: string
  ) {
    setHoles((prev) =>
      prev.map((h) =>
        h.holeNumber === holeNumber ? { ...h, [field]: value } : h
      )
    );
  }

  function addLandmark() {
    setLandmarks((prev) => [
      ...prev,
      {
        landmarkType: "other",
        latitude: "",
        longitude: "",
        endLatitude: "",
        endLongitude: "",
      },
    ]);
  }

  function updateLandmark(
    index: number,
    field: "landmarkType" | "latitude" | "longitude" | "endLatitude" | "endLongitude",
    value: string
  ) {
    setLandmarks((prev) =>
      prev.map((l, i) => (i === index ? { ...l, [field]: value } : l))
    );
  }

  function removeLandmark(index: number) {
    if (!window.confirm("Delete this landmark? This cannot be undone.")) return;
    setLandmarks((prev) => prev.filter((_, i) => i !== index));
  }

  function toPayload(): HoleInput[] {
    return holes.map((h) => ({
      holeNumber: h.holeNumber,
      teeLat: Number(h.teeLat),
      teeLng: Number(h.teeLng),
      greenLat: Number(h.greenLat),
      greenLng: Number(h.greenLng),
      allottedTime: Number(h.allottedTime),
    }));
  }

  function toLandmarkPayload(): CourseLandmarkInput[] {
    return landmarks.map((l) => ({
      id: l.id,
      landmarkType: l.landmarkType,
      endpoint1Lat: Number(l.latitude),
      endpoint1Lng: Number(l.longitude),
      ...(l.landmarkType === "driving_range" && l.endLatitude && l.endLongitude
        ? { endpoint2Lat: Number(l.endLatitude), endpoint2Lng: Number(l.endLongitude) }
        : {}),
    }));
  }

  async function onSave() {
    setStatus("");
    setIsSaving(true);

    try {
      await saveCourseHoles({
        courseId: course.id,
        courseName,
        holes: toPayload(),
        landmarks: toLandmarkPayload(),
      });
      setStatus("✅ Saved changes.");
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Failed to save"}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete() {
    const confirmed = window.confirm(
      `Delete "${course.name}"? This will remove its holes and landmarks. This cannot be undone.`
    );

    if (!confirmed) return;

    setStatus("");
    setIsDeleting(true);

    try {
      await deleteCourse(course.id);
      router.push("/courses");
      router.refresh();
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Failed to delete course"}`);
    } finally {
      setIsDeleting(false);
    }
  }

  async function onCsvSelected(file: File) {
    setStatus("");

    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      setHoles(parsed);
      setStatus("✅ CSV imported into the form.");
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Failed to import CSV"}`);
    }
  }

  function onExportCsv() {
    try {
      const lines = [
        "hole,tee_lat,tee_lng,green_lat,green_lng,allotted_time",
        ...holes.map((h) =>
          [
            String(h.holeNumber),
            escapeCsvValue(h.teeLat),
            escapeCsvValue(h.teeLng),
            escapeCsvValue(h.greenLat),
            escapeCsvValue(h.greenLng),
            escapeCsvValue(h.allottedTime),
          ].join(",")
        ),
      ];

      const csv = lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const safeCourseName = (courseName.trim() || course.name || "course")
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();

      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeCourseName || "course"}_coordinates.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus("✅ CSV exported.");
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Failed to export CSV"}`);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="fixed left-16 top-24 z-10"><CourseSubnav /></div>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="courses" />

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Edit Course</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Update holes and course landmarks.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/courses"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              ← Back
            </Link>

            <Link
              href="/courses/new"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
            >
              + Add new course
            </Link>

            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label="Delete"
              title={isDeleting ? "Deleting" : "Delete"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 shadow-sm hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <label className="w-28 text-sm font-medium text-zinc-700">
              Course name
            </label>
            <input
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className={labelInput + " w-full max-w-sm shadow-sm"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50">
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void onCsvSelected(file);
                  }
                  e.currentTarget.value = "";
                }}
              />
            </label>

            <button
              type="button"
              onClick={onExportCsv}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              Export CSV
            </button>

            <button
              onClick={onSave}
              disabled={!canSave || isSaving}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save changes"}
            </button>

            <div className="text-xs font-mono text-zinc-700">{status}</div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-zinc-900">CSV format</div>
          <div className="mt-1 text-xs text-zinc-600">
            Required exact columns: hole, tee_lat, tee_lng, green_lat, green_lng, allotted_time
          </div>
          <div className="mt-2 text-xs font-mono text-zinc-700">
            hole,tee_lat,tee_lng,green_lat,green_lng,allotted_time
          </div>
        </div>

        <div className="space-y-4">
          {holes.map((h) => (
            <div
              key={h.holeNumber}
              className="rounded-xl border border-zinc-200 bg-white shadow-sm"
            >
              <div className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900">
                Hole {h.holeNumber}
              </div>

              <div className="grid gap-4 px-4 py-4 md:grid-cols-3">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                    Tee
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      inputMode="decimal"
                      value={h.teeLat}
                      onChange={(e) =>
                        updateHole(h.holeNumber, "teeLat", e.target.value)
                      }
                      placeholder="Tee lat"
                      className={numInput}
                    />
                    <input
                      inputMode="decimal"
                      value={h.teeLng}
                      onChange={(e) =>
                        updateHole(h.holeNumber, "teeLng", e.target.value)
                      }
                      placeholder="Tee lng"
                      className={numInput}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                    Green
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      inputMode="decimal"
                      value={h.greenLat}
                      onChange={(e) =>
                        updateHole(h.holeNumber, "greenLat", e.target.value)
                      }
                      placeholder="Green lat"
                      className={numInput}
                    />
                    <input
                      inputMode="decimal"
                      value={h.greenLng}
                      onChange={(e) =>
                        updateHole(h.holeNumber, "greenLng", e.target.value)
                      }
                      placeholder="Green lng"
                      className={numInput}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                    Allotted Time
                  </div>
                  <input
                    inputMode="numeric"
                    value={h.allottedTime}
                    onChange={(e) =>
                      updateHole(h.holeNumber, "allottedTime", e.target.value)
                    }
                    placeholder="Minutes"
                    className={numInput + " w-full"}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Course Landmarks</h2>
              <p className="mt-1 text-xs text-zinc-600">
                Add putting greens, clubhouse, driving range, or other landmarks.
              </p>
            </div>

            <button
              type="button"
              onClick={addLandmark}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              + Add landmark
            </button>
          </div>

          <div className="space-y-3">
            {landmarks.length === 0 ? (
              <div className="text-sm text-zinc-500">No landmarks yet.</div>
            ) : (
              landmarks.map((landmark, index) => (
                <div
                  key={landmark.id ?? index}
                  className={`grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 ${
                    landmark.landmarkType === "driving_range"
                      ? "md:grid-cols-[200px_1fr_auto]"
                      : "md:grid-cols-[200px_1fr_1fr_auto]"
                  }`}
                >
                  <select
                    value={landmark.landmarkType}
                    onChange={(e) =>
                      updateLandmark(index, "landmarkType", e.target.value)
                    }
                    className={labelInput}
                  >
                    <option value="putting_green">putting green</option>
                    <option value="clubhouse">clubhouse</option>
                    <option value="driving_range">driving range</option>
                    <option value="other">other</option>
                  </select>

                  {landmark.landmarkType === "driving_range" ? (
                    <div className="grid gap-2">
                      <div>
                        <div className="mb-1 text-xs font-medium text-zinc-500">Endpoint 1</div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            inputMode="decimal"
                            value={landmark.latitude}
                            onChange={(e) =>
                              updateLandmark(index, "latitude", e.target.value)
                            }
                            placeholder="Latitude"
                            className={numInput}
                          />
                          <input
                            inputMode="decimal"
                            value={landmark.longitude}
                            onChange={(e) =>
                              updateLandmark(index, "longitude", e.target.value)
                            }
                            placeholder="Longitude"
                            className={numInput}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-zinc-500">Endpoint 2</div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            inputMode="decimal"
                            value={landmark.endLatitude}
                            onChange={(e) =>
                              updateLandmark(index, "endLatitude", e.target.value)
                            }
                            placeholder="Latitude"
                            className={numInput}
                          />
                          <input
                            inputMode="decimal"
                            value={landmark.endLongitude}
                            onChange={(e) =>
                              updateLandmark(index, "endLongitude", e.target.value)
                            }
                            placeholder="Longitude"
                            className={numInput}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <input
                        inputMode="decimal"
                        value={landmark.latitude}
                        onChange={(e) =>
                          updateLandmark(index, "latitude", e.target.value)
                        }
                        placeholder="Latitude"
                        className={numInput}
                      />
                      <input
                        inputMode="decimal"
                        value={landmark.longitude}
                        onChange={(e) =>
                          updateLandmark(index, "longitude", e.target.value)
                        }
                        placeholder="Longitude"
                        className={numInput}
                      />
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => removeLandmark(index)}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-6 text-xs text-zinc-500">
          Course ID:{" "}
          <span className="font-mono text-zinc-700">{course.id}</span>
        </div>
      </div>
    </main>
  );
}
