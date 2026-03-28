"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  saveCourseHoles,
  HoleInput,
  CourseLandmarkInput,
} from "../../actions";
import AdminNav from "@/components/AdminNav";

type HoleRow = {
  holeNumber: number;
  teeLat: string;
  teeLng: string;
  greenLat: string;
  greenLng: string;
  allottedTime: string;
};

type LandmarkRow = {
  landmarkType: "putting_green" | "clubhouse" | "driving_range" | "other";
  latitude: string;
  longitude: string;
};

const numInput =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

const labelInput =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

function makeInitialRows(): HoleRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    teeLat: "",
    teeLng: "",
    greenLat: "",
    greenLng: "",
    allottedTime: "",
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

export default function NewCoursePage() {
  const [courseName, setCourseName] = useState("");
  const [holes, setHoles] = useState<HoleRow[]>(() => makeInitialRows());
  const [landmarks, setLandmarks] = useState<LandmarkRow[]>([]);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const canSubmit = useMemo(() => {
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

    const landmarksValid = landmarks.every(
      (l) =>
        l.latitude &&
        l.longitude &&
        Number.isFinite(Number(l.latitude)) &&
        Number.isFinite(Number(l.longitude))
    );

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
      },
    ]);
  }

  function updateLandmark(
    index: number,
    field: "landmarkType" | "latitude" | "longitude",
    value: string
  ) {
    setLandmarks((prev) =>
      prev.map((l, i) => (i === index ? { ...l, [field]: value } : l))
    );
  }

  function removeLandmark(index: number) {
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
      landmarkType: l.landmarkType,
      latitude: Number(l.latitude),
      longitude: Number(l.longitude),
    }));
  }

  async function onSave() {
    setStatus("");
    setIsSaving(true);

    try {
      const res = await saveCourseHoles({
        courseName,
        holes: toPayload(),
        landmarks: toLandmarkPayload(),
      });
      setStatus(`✅ Saved. course_id=${res.courseId}`);
    } catch (e: any) {
      setStatus(`❌ ${e?.message ?? "Failed to save"}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function onCsvSelected(file: File) {
    setStatus("");

    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      setHoles(parsed);
      setStatus("✅ CSV imported into the form.");
    } catch (e: any) {
      setStatus(`❌ ${e?.message ?? "Failed to import CSV"}`);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <AdminNav current="courses" />

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Add a Course</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Add holes and course landmarks.
            </p>
          </div>

          <Link
            href="/courses"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            ← Back to courses
          </Link>
        </div>

        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <label className="w-28 text-sm font-medium text-zinc-700">
              Course name
            </label>
            <input
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="e.g., Harding Park"
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
              onClick={onSave}
              disabled={!canSubmit || isSaving}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save to Supabase"}
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
                  key={index}
                  className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-[200px_1fr_1fr_auto]"
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
          Each hole requires tee coordinates, green coordinates, and allotted time.
        </div>
      </div>
    </main>
  );
}