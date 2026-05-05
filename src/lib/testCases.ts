// Shared types and helpers for test cases (stored in localStorage)

export type PacingEventType = "hole" | "off course";
export type TestCaseEventType =
  | "behind pace"
  | "group split"
  | "group join"
  | "leave course"
  | "skip_hole"
  | "pass_group";

export type TestCaseLabel =
  | "Leave Course"
  | "Group Join"
  | "Group Split"
  | "Behind Pace"
  | "Skip Hole"
  | "Pass Group"
  | "Riders Only"
  | "Walkers Only"
  | "Walkers/Riders";

export const TEST_CASE_LABEL_OPTIONS: TestCaseLabel[] = [
  "Leave Course",
  "Group Join",
  "Group Split",
  "Behind Pace",
  "Skip Hole",
  "Pass Group",
  "Riders Only",
  "Walkers Only",
  "Walkers/Riders",
];

export type TestCaseGroup = {
  localId: string;
  label: string;
  teeTime: string;
  startHole?: number;
};

export type TestCasePacingRow = {
  id: string;
  groupId: string;
  eventType: PacingEventType;
  landmark: string;
  startTime: string;
  endTime: string;
};

export type TestCaseEventRow = {
  id: string;
  groupId: string;
  eventType: TestCaseEventType;
  landmark: string;
  time: string;
};

export type TestCaseHole = {
  holeNumber: number;
  teeLat: number;
  teeLng: number;
  greenLat: number;
  greenLng: number;
  allottedTime: number;
};

export type TestCaseLandmark = {
  id: string;
  landmarkType: string;
  endpoint1Lat: number;
  endpoint1Lng: number;
  endpoint2Lat?: number;
  endpoint2Lng?: number;
};

export type TestCaseCartPath = {
  holeNumber: number;
  label: string | null;
  pathType: string;
  coordinates: { lat: number; lng: number }[];
};

export type LocationDataPlayer = {
  localId: string;
  name: string;
  groupId: string | null;
  usingCarts?: boolean;
  locations: { lat: number; lng: number; timestamp: string }[];
};

export type LocationData = {
  courseId: string;
  courseName: string;
  holes: TestCaseHole[];
  landmarks: TestCaseLandmark[];
  cartPaths?: TestCaseCartPath[];
  groups: TestCaseGroup[];
  players: LocationDataPlayer[];
  mapCenter?: [number, number];
  mapZoom?: number;
};

export type TestCase = {
  id: string;
  name: string;
  description: string;
  courseId: string | null;
  courseName: string | null;
  holes: TestCaseHole[];
  landmarks: TestCaseLandmark[];
  groups: TestCaseGroup[];
  labels: TestCaseLabel[];
  pacingRows: TestCasePacingRow[];
  events: TestCaseEventRow[];
  sessionJson: string;
  locationData: LocationData | null;
  createdAt: string;
  updatedAt: string;
};

export type LandmarkOption = { value: string; label: string };

type JsonRecord = Record<string, unknown>;

const LS_KEY = "omnigolf-test-cases-v1";

function makeId() {
  return Math.random().toString(36).slice(2);
}

const LANDMARK_LABELS: Record<string, string> = {
  putting_green: "Putting Green",
  clubhouse: "Clubhouse",
  driving_range: "Driving Range",
  other: "Other",
};

function toIsoString(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function earliestLocationIso(players: LocationDataPlayer[], groupId?: string) {
  const timestamps = players
    .filter((p) => !groupId || p.groupId === groupId)
    .flatMap((p) => p.locations.map((loc) => new Date(loc.timestamp).getTime()))
    .filter((ts) => Number.isFinite(ts));

  if (timestamps.length === 0) return null;
  return new Date(Math.min(...timestamps)).toISOString();
}

function fallbackGroupTeeTimeIso(
  locationData: LocationData,
  groupId: string,
  createdAt: string
) {
  return (
    earliestLocationIso(locationData.players, groupId) ??
    earliestLocationIso(locationData.players) ??
    toIsoString(createdAt) ??
    new Date().toISOString()
  );
}

export function loadTestCases(): TestCase[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveTestCases(cases: TestCase[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(cases));
}

export function upsertTestCase(tc: TestCase): void {
  const cases = loadTestCases();
  const idx = cases.findIndex((c) => c.id === tc.id);
  if (idx >= 0) {
    cases[idx] = tc;
  } else {
    cases.push(tc);
  }
  saveTestCases(cases);
}

export function removeTestCase(id: string): void {
  saveTestCases(loadTestCases().filter((c) => c.id !== id));
}

export function setTestCaseLocationData(id: string, data: LocationData): void {
  const cases = loadTestCases();
  const idx = cases.findIndex((c) => c.id === id);
  if (idx >= 0) {
    cases[idx] = { ...cases[idx], locationData: data, updatedAt: new Date().toISOString() };
    saveTestCases(cases);
  }
}

export function buildLandmarkOptions(
  holes: TestCaseHole[],
  landmarks: TestCaseLandmark[]
): LandmarkOption[] {
  const options: LandmarkOption[] = holes.map((h) => ({
    value: `hole:${h.holeNumber}`,
    label: `Hole ${h.holeNumber}`,
  }));

  const typeCounts = new Map<string, number>();
  for (const l of landmarks) {
    typeCounts.set(l.landmarkType, (typeCounts.get(l.landmarkType) ?? 0) + 1);
  }

  const typeIndices = new Map<string, number>();
  for (const l of landmarks) {
    if (!l.id) continue;
    const idx = (typeIndices.get(l.landmarkType) ?? 0) + 1;
    typeIndices.set(l.landmarkType, idx);
    const base = LANDMARK_LABELS[l.landmarkType] ?? l.landmarkType;
    const count = typeCounts.get(l.landmarkType) ?? 1;
    options.push({
      value: `landmark:${l.id}`,
      label: count > 1 ? `${base} ${idx}` : base,
    });
  }

  return options;
}

export function testCaseToExportJson(tc: TestCase): object {
  // Use uploaded session JSON as the base, then overlay pacing/events
  let base: JsonRecord = {};
  try {
    if (tc.sessionJson) {
      const parsed = JSON.parse(tc.sessionJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as JsonRecord;
      }
    }
  } catch {
    /* ignore parse errors */
  }

  if (tc.locationData) {
    const locationData = tc.locationData;
    const cartPathsByHole = new Map<number, TestCaseCartPath[]>();
    for (const cp of locationData.cartPaths ?? []) {
      if (!cartPathsByHole.has(cp.holeNumber)) cartPathsByHole.set(cp.holeNumber, []);
      cartPathsByHole.get(cp.holeNumber)!.push(cp);
    }

    base = {
      version: 1,
      exported_at: new Date().toISOString(),
      session_id: tc.id,
      session_name: tc.name,
      course_id: locationData.courseId || "",
      course_name: locationData.courseName || "",
      holes: locationData.holes.map((h) => ({
        hole_number: h.holeNumber,
        tee_lat: h.teeLat,
        tee_lng: h.teeLng,
        green_lat: h.greenLat,
        green_lng: h.greenLng,
        allotted_time: h.allottedTime,
        cart_paths: (cartPathsByHole.get(h.holeNumber) ?? []).map((cp) => ({
          label: cp.label ?? null,
          path_type: cp.pathType,
          coordinates: cp.coordinates,
        })),
      })),
      course_landmarks: locationData.landmarks.map((l) => ({
        id: l.id,
        landmark_type: l.landmarkType,
        latitude: l.endpoint1Lat,
        longitude: l.endpoint1Lng,
        endpoint1_latitude: l.endpoint1Lat,
        endpoint1_longitude: l.endpoint1Lng,
        ...(l.endpoint2Lat != null
          ? {
              endpoint2_latitude: l.endpoint2Lat,
              endpoint2_longitude: l.endpoint2Lng,
            }
          : {}),
      })),
      groups: locationData.groups.map((g) => ({
        group_id: g.localId,
        label: g.label,
        tee_time: toIsoString(g.teeTime) ?? fallbackGroupTeeTimeIso(locationData, g.localId, tc.createdAt),
        start_hole: g.startHole ?? 1,
        players: locationData.players
          .filter((p) => p.groupId === g.localId)
          .map((p) => ({ user_id: p.localId, using_carts: p.usingCarts ?? false })),
      })),
      players: locationData.players.map((p) => ({
        user_id: p.localId,
        email: p.name || p.localId,
        using_carts: p.usingCarts ?? false,
        locations: p.locations.map((loc) => ({
          id: makeId(),
          recorded_at: new Date(loc.timestamp).toISOString(),
          latitude: loc.lat,
          longitude: loc.lng,
          horizontal_accuracy: null,
        })),
      })),
    };
  }

  // Group label map from the base JSON's groups
  const jsonGroups = Array.isArray(base.groups) ? base.groups : [];
  const groupLabelMap = new Map<string, string>(
    jsonGroups.map((g) => [
      String((g as JsonRecord).group_id ?? (g as JsonRecord).id ?? ""),
      String((g as JsonRecord).label ?? ""),
    ])
  );

  // Landmark label map from stored holes/landmarks (for pacing label lookup)
  const allOpts = buildLandmarkOptions(tc.holes, tc.landmarks);
  const labelMap = new Map(allOpts.map((o) => [o.value, o.label]));

  return {
    ...base,
    session_id: tc.id,
    session_name: tc.name,
    is_test_case: true,
    exported_at: new Date().toISOString(),
    group_pacing: tc.pacingRows.map((r) => ({
      group_id: r.groupId || null,
      group_label: r.groupId ? (groupLabelMap.get(r.groupId) ?? null) : null,
      event_type: r.eventType,
      landmark: r.landmark || null,
      landmark_label: r.landmark ? (labelMap.get(r.landmark) ?? r.landmark) : null,
      start_time: r.startTime || null,
      end_time: r.endTime || null,
    })),
    events: tc.events.map((ev) => ({
      group_id: ev.groupId || null,
      group_label: ev.groupId ? (groupLabelMap.get(ev.groupId) ?? null) : null,
      event_type: ev.eventType,
      landmark: ev.landmark || null,
      landmark_label: ev.landmark ? (labelMap.get(ev.landmark) ?? ev.landmark) : null,
      time: ev.time || null,
    })),
  };
}

export async function testCaseToExportJsonWithCourseData(tc: TestCase): Promise<object> {
  if (!tc.locationData?.courseId || (tc.locationData.cartPaths?.length ?? 0) > 0) {
    return testCaseToExportJson(tc);
  }

  try {
    const res = await fetch(`/api/courses/${tc.locationData.courseId}/data`);
    if (!res.ok) return testCaseToExportJson(tc);
    const data = await res.json() as { cartPaths?: TestCaseCartPath[] };
    if (!data.cartPaths?.length) return testCaseToExportJson(tc);

    return testCaseToExportJson({
      ...tc,
      locationData: {
        ...tc.locationData,
        cartPaths: data.cartPaths,
      },
    });
  } catch {
    return testCaseToExportJson(tc);
  }
}
