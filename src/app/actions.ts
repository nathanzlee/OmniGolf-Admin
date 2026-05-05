"use server";

import { supabaseServer } from "@/lib/supabase/server";
import type { TestCase } from "@/lib/testCases";

function assertUuid(id: string, label: string) {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(id)) throw new Error(`Invalid UUID for ${label}: "${id}"`);
}

function isUuid(id: string | null | undefined) {
  if (!id) return false;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuid.test(id);
}

function toIsoOrNow(value: string | null | undefined) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function getLocalTestCaseCourseId(tc: TestCase) {
  const locationData = tc.locationData as (TestCase["locationData"] & { course_id?: string }) | null;
  const maybeCourseId = tc.courseId || locationData?.courseId || locationData?.course_id;
  return isUuid(maybeCourseId) ? maybeCourseId : null;
}

/* =====================================================
   Course types
===================================================== */

export type CartPathInput = {
  label?: string;
  pathType?: string;
  points: { lat: number; lng: number }[];
};

export type HoleInput = {
  holeNumber: number;
  teeLat: number;
  teeLng: number;
  greenLat: number;
  greenLng: number;
  allottedTime: number;
  cartPaths?: CartPathInput[];
};

export type CourseLandmarkInput = {
  id?: string;
  landmarkType: "putting_green" | "clubhouse" | "driving_range" | "other";
  endpoint1Lat: number;
  endpoint1Lng: number;
  endpoint2Lat?: number;
  endpoint2Lng?: number;
};

/* =====================================================
   Courses
===================================================== */

export async function listCourses() {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("golf_courses")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listCourses failed: ${error.message}`);
  return data ?? [];
}

export async function listCoursesForSelect() {
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("golf_courses")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw new Error(`listCoursesForSelect failed: ${error.message}`);
  return data ?? [];
}

export async function getCourse(courseId: string) {
  assertUuid(courseId, "getCourse");

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("golf_courses")
    .select("id, name, created_at")
    .eq("id", courseId)
    .single();

  if (error) throw new Error(`getCourse failed: ${error.message}`);
  return data;
}

export async function getCourseHoles(courseId: string): Promise<HoleInput[]> {
  assertUuid(courseId, "getCourseHoles");

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("course_holes")
    .select("hole_number, tee_lat, tee_lng, green_lat, green_lng, allotted_time")
    .eq("course_id", courseId)
    .order("hole_number", { ascending: true });

  if (error) throw new Error(`getCourseHoles failed: ${error.message}`);

  return (data ?? []).map((h: any) => ({
    holeNumber: h.hole_number,
    teeLat: h.tee_lat,
    teeLng: h.tee_lng,
    greenLat: h.green_lat,
    greenLng: h.green_lng,
    allottedTime: h.allotted_time,
  }));
}

export async function getCourseLandmarks(
  courseId: string
): Promise<CourseLandmarkInput[]> {
  assertUuid(courseId, "getCourseLandmarks");

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("course_landmarks")
    .select("id, landmark_type, latitude, longitude, endpoint1_latitude, endpoint1_longitude, endpoint2_latitude, endpoint2_longitude")
    .eq("course_id", courseId)
    .order("id", { ascending: true });

  if (error) throw new Error(`getCourseLandmarks failed: ${error.message}`);

  return (data ?? []).map((row: any) => {
    const isDrivingRange = row.landmark_type === "driving_range";
    return {
      id: row.id,
      landmarkType: row.landmark_type,
      endpoint1Lat: isDrivingRange ? row.endpoint1_latitude : row.latitude,
      endpoint1Lng: isDrivingRange ? row.endpoint1_longitude : row.longitude,
      ...(isDrivingRange && row.endpoint2_latitude != null
        ? { endpoint2Lat: row.endpoint2_latitude, endpoint2Lng: row.endpoint2_longitude }
        : {}),
    };
  });
}

export type CourseCartPath = {
  id: string;
  holeNumber: number;
  label: string | null;
  pathType: string;
  coordinates: { lat: number; lng: number }[];
};

export async function getCourseCartPaths(courseId: string): Promise<CourseCartPath[]> {
  assertUuid(courseId, "getCourseCartPaths");

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("course_hole_cart_paths")
    .select(`
      id,
      label,
      path_type,
      course_holes!inner(hole_number),
      course_hole_cart_path_points(seq, latitude, longitude)
    `)
    .eq("course_id", courseId)
    .order("seq", { referencedTable: "course_hole_cart_path_points", ascending: true });

  if (error) throw new Error(`getCourseCartPaths failed: ${error.message}`);

  return (data ?? []).map((cp: any) => {
    const courseHoles = Array.isArray(cp.course_holes) ? cp.course_holes[0] : cp.course_holes;
    return {
      id: cp.id,
      holeNumber: courseHoles?.hole_number,
      label: cp.label ?? null,
      pathType: cp.path_type ?? "cart_path",
      coordinates: [...(cp.course_hole_cart_path_points ?? [])]
        .sort((a: any, b: any) => a.seq - b.seq)
        .map((p: any) => ({ lat: p.latitude, lng: p.longitude })),
    };
  });
}

export async function saveCourseHoles(params: {
  courseId?: string;
  courseName: string;
  holes: HoleInput[];
  landmarks?: CourseLandmarkInput[];
}) {
  const { courseId, courseName, holes, landmarks = [] } = params;

  if (!courseName.trim()) throw new Error("Course name is required.");
  if (holes.length !== 18) throw new Error("Expected 18 holes.");

  for (const h of holes) {
    if (
      !Number.isFinite(h.teeLat) ||
      !Number.isFinite(h.teeLng) ||
      !Number.isFinite(h.greenLat) ||
      !Number.isFinite(h.greenLng)
    ) {
      throw new Error(`Hole ${h.holeNumber}: all coordinates must be valid numbers.`);
    }

    if (!Number.isInteger(h.allottedTime) || h.allottedTime <= 0) {
      throw new Error(`Hole ${h.holeNumber}: allotted time must be a positive integer.`);
    }
  }

  const validLandmarkTypes = new Set([
    "putting_green",
    "clubhouse",
    "driving_range",
    "other",
  ]);

  for (const landmark of landmarks) {
    if (!validLandmarkTypes.has(landmark.landmarkType)) {
      throw new Error(`Invalid landmark type: ${landmark.landmarkType}`);
    }

    if (
      !Number.isFinite(landmark.endpoint1Lat) ||
      !Number.isFinite(landmark.endpoint1Lng)
    ) {
      throw new Error("Landmark coordinates must be valid numbers.");
    }
  }

  const supabase = supabaseServer();

  let finalCourseId = courseId;

  if (finalCourseId) {
    assertUuid(finalCourseId, "saveCourseHoles.courseId");

    const { error } = await supabase
      .from("golf_courses")
      .update({ name: courseName.trim() })
      .eq("id", finalCourseId);

    if (error) throw new Error(`update course failed: ${error.message}`);
  } else {
    const { data: course, error } = await supabase
      .from("golf_courses")
      .insert({ name: courseName.trim() })
      .select("id")
      .single();

    if (error) throw new Error(`insert course failed: ${error.message}`);
    finalCourseId = course.id;
  }

  const holeRows = holes.map((h) => ({
    course_id: finalCourseId,
    hole_number: h.holeNumber,
    tee_lat: h.teeLat,
    tee_lng: h.teeLng,
    green_lat: h.greenLat,
    green_lng: h.greenLng,
    allotted_time: h.allottedTime,
  }));

  const { error: holesErr } = await supabase
    .from("course_holes")
    .upsert(holeRows, { onConflict: "course_id,hole_number" });

  if (holesErr) throw new Error(`save holes failed: ${holesErr.message}`);

  // ── Cart paths ──────────────────────────────────────────────────────────────
  // Fetch hole IDs so we can key cart paths by hole_id
  const { data: holeRecords, error: holeIdsErr } = await supabase
    .from("course_holes")
    .select("id, hole_number")
    .eq("course_id", finalCourseId);

  if (holeIdsErr) throw new Error(`fetch hole IDs failed: ${holeIdsErr.message}`);

  const holeIdByNumber: Record<number, string> = {};
  for (const h of holeRecords ?? []) {
    holeIdByNumber[(h as any).hole_number] = (h as any).id;
  }

  // Delete all existing cart paths for this course (cascades to points via FK)
  const { error: deleteCartPathsErr } = await supabase
    .from("course_hole_cart_paths")
    .delete()
    .eq("course_id", finalCourseId);

  if (deleteCartPathsErr) throw new Error(`delete cart paths failed: ${deleteCartPathsErr.message}`);

  // Insert new cart paths and their points
  for (const h of holes) {
    const holeCartPaths = h.cartPaths ?? [];
    const holeId = holeIdByNumber[h.holeNumber];
    if (!holeId) continue;

    for (const cp of holeCartPaths) {
      if (cp.points.length === 0) continue;

      const { data: cpRecord, error: insertCpErr } = await supabase
        .from("course_hole_cart_paths")
        .insert({
          course_id: finalCourseId,
          hole_id: holeId,
          label: cp.label ?? null,
          path_type: cp.pathType ?? "cart_path",
        })
        .select("id")
        .single();

      if (insertCpErr) throw new Error(`insert cart path failed: ${insertCpErr.message}`);

      const pointRows = cp.points.map((pt, seq) => ({
        cart_path_id: cpRecord.id,
        seq,
        latitude: pt.lat,
        longitude: pt.lng,
      }));

      const { error: insertPointsErr } = await supabase
        .from("course_hole_cart_path_points")
        .insert(pointRows);

      if (insertPointsErr) throw new Error(`insert cart path points failed: ${insertPointsErr.message}`);
    }
  }

  // ── Landmarks ───────────────────────────────────────────────────────────────
  const { error: deleteLandmarksErr } = await supabase
    .from("course_landmarks")
    .delete()
    .eq("course_id", finalCourseId);

  if (deleteLandmarksErr) {
    throw new Error(`delete landmarks failed: ${deleteLandmarksErr.message}`);
  }

  if (landmarks.length > 0) {
    const landmarkRows = landmarks.map((l) => {
      if (l.landmarkType === "driving_range") {
        return {
          course_id: finalCourseId,
          landmark_type: l.landmarkType,
          latitude: l.endpoint1Lat,
          longitude: l.endpoint1Lng,
          endpoint1_latitude: l.endpoint1Lat,
          endpoint1_longitude: l.endpoint1Lng,
          ...(l.endpoint2Lat != null && l.endpoint2Lng != null
            ? { endpoint2_latitude: l.endpoint2Lat, endpoint2_longitude: l.endpoint2Lng }
            : {}),
        };
      }
      return {
        course_id: finalCourseId,
        landmark_type: l.landmarkType,
        latitude: l.endpoint1Lat,
        longitude: l.endpoint1Lng,
      };
    });

    const { error: insertLandmarksErr } = await supabase
      .from("course_landmarks")
      .insert(landmarkRows);

    if (insertLandmarksErr) {
      throw new Error(`insert landmarks failed: ${insertLandmarksErr.message}`);
    }
  }

  return { ok: true, courseId: finalCourseId };
}

export async function deleteCourse(courseId: string) {
  assertUuid(courseId, "deleteCourse.courseId");

  const supabase = supabaseServer();

  const { error } = await supabase
    .from("golf_courses")
    .delete()
    .eq("id", courseId);

  if (error) {
    throw new Error(`deleteCourse failed: ${error.message}`);
  }

  return { ok: true };
}

/* =====================================================
   Session types
===================================================== */

export type UserSelectOption = {
  id: string;
  label: string;
  email: string | null;
};

export type SessionStatus = "planned" | "active" | "completed" | "cancelled";

export type SessionDetail = {
  id: string;
  name: string;
  course_id: string;
  session_date: string | null;
  status: SessionStatus;
  created_at: string;
};

export type SessionGroupInput = {
  id?: string;
  label?: string;
  teeTime?: string;
  startHole?: number;
  players: { userId: string; usingCarts: boolean }[];
};

export type SessionGroupRecord = {
  id: string;
  label: string | null;
  tee_time: string | null;
  start_hole: number | null;
};

export type SessionGroupPlayerRecord = {
  group_id: string;
  user_id: string;
  using_carts: boolean;
};

/* =====================================================
   User dropdown options from auth.users view
===================================================== */

export async function listUsersForSelect(): Promise<UserSelectOption[]> {
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("auth_user_options")
    .select("id, display_name, email")
    .order("display_name", { ascending: true });

  if (error) throw new Error(`listUsersForSelect failed: ${error.message}`);

  return (data ?? []).map((u: any) => ({
    id: u.id,
    label: u.display_name || u.email || u.id,
    email: u.email ?? null,
  }));
}

/* =====================================================
   Sessions
===================================================== */

export async function listSessions() {
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("course_sessions")
    .select(`
      id,
      name,
      session_date,
      status,
      created_at,
      golf_courses (
        id,
        name
      )
    `)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listSessions failed: ${error.message}`);
  return data ?? [];
}

export async function createSession(params: {
  courseId: string;
  name: string;
  sessionDate?: string;
  status?: SessionStatus;
  groups: SessionGroupInput[];
}) {
  const { courseId, name, sessionDate, status = "planned", groups } = params;

  assertUuid(courseId, "createSession.courseId");

  if (!name.trim()) throw new Error("Session name is required.");

  const seenUsers = new Set<string>();
  for (const group of groups) {
    if (group.startHole != null && (!Number.isInteger(group.startHole) || group.startHole < 1 || group.startHole > 18)) {
      throw new Error("Start hole must be between 1 and 18.");
    }

    for (const { userId } of group.players) {
      assertUuid(userId, "createSession.group.playerUserId");
      if (seenUsers.has(userId)) {
        throw new Error("A player cannot be assigned to more than one group.");
      }
      seenUsers.add(userId);
    }
  }

  const supabase = supabaseServer();

  const { data: session, error: sessionErr } = await supabase
    .from("course_sessions")
    .insert({
      course_id: courseId,
      name: name.trim(),
      session_date: sessionDate || null,
      status,
    })
    .select("id")
    .single();

  if (sessionErr) throw new Error(`createSession failed: ${sessionErr.message}`);

  for (const group of groups) {
    const { data: createdGroup, error: createGroupErr } = await supabase
      .from("session_groups")
      .insert({
        session_id: session.id,
        label: group.label?.trim() || null,
        tee_time: group.teeTime || null,
        start_hole: group.startHole ?? 1,
      })
      .select("id")
      .single();

    if (createGroupErr) {
      throw new Error(`createSession create group failed: ${createGroupErr.message}`);
    }

    if (group.players.length > 0) {
      const rows = group.players.map(({ userId, usingCarts }) => ({
        group_id: createdGroup.id,
        user_id: userId,
        using_carts: usingCarts,
      }));

      const { error: insertPlayersErr } = await supabase
        .from("group_players")
        .insert(rows);

      if (insertPlayersErr) {
        throw new Error(`createSession insert group players failed: ${insertPlayersErr.message}`);
      }
    }
  }

  return { ok: true, sessionId: session.id };
}

export async function getSession(sessionId: string): Promise<SessionDetail> {
  assertUuid(sessionId, "getSession.sessionId");

  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("course_sessions")
    .select("id, name, course_id, session_date, status, created_at")
    .eq("id", sessionId)
    .single();

  if (error) throw new Error(`getSession failed: ${error.message}`);
  return data;
}

export async function getSessionGroups(
  sessionId: string
): Promise<SessionGroupRecord[]> {
  assertUuid(sessionId, "getSessionGroups.sessionId");

  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("session_groups")
    .select("id, label, tee_time, start_hole")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`getSessionGroups failed: ${error.message}`);
  return data ?? [];
}

export async function getSessionGroupPlayers(
  sessionId: string
): Promise<SessionGroupPlayerRecord[]> {
  assertUuid(sessionId, "getSessionGroupPlayers.sessionId");

  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("group_players")
    .select(`
      group_id,
      user_id,
      using_carts,
      session_groups!inner (
        session_id
      )
    `)
    .eq("session_groups.session_id", sessionId);

  if (error) throw new Error(`getSessionGroupPlayers failed: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    group_id: row.group_id,
    user_id: row.user_id,
    using_carts: row.using_carts ?? false,
  }));
}

export async function updateSession(params: {
  sessionId: string;
  courseId: string;
  name: string;
  sessionDate?: string;
  status: SessionStatus;
  groups: SessionGroupInput[];
}) {
  const { sessionId, courseId, name, sessionDate, status, groups } = params;

  assertUuid(sessionId, "updateSession.sessionId");
  assertUuid(courseId, "updateSession.courseId");

  if (!name.trim()) throw new Error("Session name is required.");

  const seenUsers = new Set<string>();

  for (const group of groups) {
    if (group.id) assertUuid(group.id, "updateSession.group.id");
    if (group.startHole != null && (!Number.isInteger(group.startHole) || group.startHole < 1 || group.startHole > 18)) {
      throw new Error("Start hole must be between 1 and 18.");
    }

    for (const { userId } of group.players) {
      assertUuid(userId, "updateSession.group.playerUserId");
      if (seenUsers.has(userId)) {
        throw new Error("A player cannot be assigned to more than one group.");
      }
      seenUsers.add(userId);
    }
  }

  const supabase = supabaseServer();

  const { error: sessionErr } = await supabase
    .from("course_sessions")
    .update({
      course_id: courseId,
      name: name.trim(),
      session_date: sessionDate || null,
      status,
    })
    .eq("id", sessionId);

  if (sessionErr) throw new Error(`updateSession failed: ${sessionErr.message}`);

  const { data: existingGroups, error: existingGroupsErr } = await supabase
    .from("session_groups")
    .select("id")
    .eq("session_id", sessionId);

  if (existingGroupsErr) {
    throw new Error(`updateSession load groups failed: ${existingGroupsErr.message}`);
  }

  const existingGroupIdSet = new Set((existingGroups ?? []).map((g: any) => g.id as string));
  const incomingGroupIdSet = new Set(
    groups.filter((g) => g.id && existingGroupIdSet.has(g.id)).map((g) => g.id!)
  );

  // Delete groups that were removed
  const groupIdsToDelete = [...existingGroupIdSet].filter((id) => !incomingGroupIdSet.has(id));
  if (groupIdsToDelete.length > 0) {
    const { error: deletePlayersErr } = await supabase
      .from("group_players")
      .delete()
      .in("group_id", groupIdsToDelete);

    if (deletePlayersErr) {
      throw new Error(`updateSession delete group players failed: ${deletePlayersErr.message}`);
    }

    const { error: deleteGroupsErr } = await supabase
      .from("session_groups")
      .delete()
      .in("id", groupIdsToDelete);

    if (deleteGroupsErr) {
      throw new Error(`updateSession delete groups failed: ${deleteGroupsErr.message}`);
    }
  }

  // Upsert each group, preserving IDs for existing ones
  for (const group of groups) {
    let groupId: string;

    if (group.id && existingGroupIdSet.has(group.id)) {
      const { error: updateGroupErr } = await supabase
        .from("session_groups")
        .update({
          label: group.label?.trim() || null,
          tee_time: group.teeTime || null,
          start_hole: group.startHole ?? 1,
        })
        .eq("id", group.id);

      if (updateGroupErr) {
        throw new Error(`updateSession update group failed: ${updateGroupErr.message}`);
      }

      groupId = group.id;
    } else {
      const { data: createdGroup, error: createGroupErr } = await supabase
        .from("session_groups")
        .insert({
          session_id: sessionId,
          label: group.label?.trim() || null,
          tee_time: group.teeTime || null,
          start_hole: group.startHole ?? 1,
        })
        .select("id")
        .single();

      if (createGroupErr) {
        throw new Error(`updateSession create group failed: ${createGroupErr.message}`);
      }

      groupId = createdGroup.id;
    }

    // Replace players for this group
    const { error: deletePlayersErr } = await supabase
      .from("group_players")
      .delete()
      .eq("group_id", groupId);

    if (deletePlayersErr) {
      throw new Error(`updateSession delete group players failed: ${deletePlayersErr.message}`);
    }

    if (group.players.length > 0) {
      const rows = group.players.map(({ userId, usingCarts }) => ({
        group_id: groupId,
        user_id: userId,
        using_carts: usingCarts,
      }));

      const { error: insertPlayersErr } = await supabase
        .from("group_players")
        .insert(rows);

      if (insertPlayersErr) {
        throw new Error(`updateSession insert group players failed: ${insertPlayersErr.message}`);
      }
    }
  }

  return { ok: true };
}

export async function deleteSession(sessionId: string) {
  assertUuid(sessionId, "deleteSession.sessionId");

  const supabase = supabaseServer();

  const { error } = await supabase
    .from("course_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    throw new Error(`deleteSession failed: ${error.message}`);
  }

  return { ok: true };
}

/* =====================================================
   Test case migration
===================================================== */

type TestCaseRow = {
  id: string;
  name: string | null;
  description: string | null;
  course_id: string | null;
  groups: TestCase["groups"] | null;
  labels: TestCase["labels"] | null;
  pacing_rows: TestCase["pacingRows"] | null;
  events: TestCase["events"] | null;
  location_data: TestCase["locationData"] | null;
  created_at: string | null;
  updated_at: string | null;
};

function rowToTestCase(row: TestCaseRow): TestCase {
  const locationData = row.location_data ?? null;

  return {
    id: row.id,
    name: row.name?.trim() || "Untitled Test Case",
    description: row.description ?? "",
    courseId: row.course_id ?? locationData?.courseId ?? null,
    courseName: locationData?.courseName ?? null,
    holes: locationData?.holes ?? [],
    landmarks: locationData?.landmarks ?? [],
    groups: row.groups ?? locationData?.groups ?? [],
    labels: row.labels ?? [],
    pacingRows: row.pacing_rows ?? [],
    events: row.events ?? [],
    sessionJson: "",
    locationData,
    createdAt: toIsoOrNow(row.created_at),
    updatedAt: toIsoOrNow(row.updated_at),
  };
}

function testCaseToRow(tc: TestCase) {
  if (!isUuid(tc.id)) {
    throw new Error(`Invalid test case id: "${tc.id}"`);
  }

  const courseId = getLocalTestCaseCourseId(tc);
  const now = new Date().toISOString();

  return {
    id: tc.id,
    name: tc.name?.trim() || "Untitled Test Case",
    description: tc.description ?? "",
    course_id: courseId,
    groups: tc.groups ?? tc.locationData?.groups ?? [],
    labels: tc.labels ?? [],
    pacing_rows: tc.pacingRows ?? [],
    events: tc.events ?? [],
    location_data: tc.locationData ?? null,
    created_at: toIsoOrNow(tc.createdAt),
    updated_at: tc.updatedAt ? toIsoOrNow(tc.updatedAt) : now,
  };
}

export async function listTestCases(): Promise<TestCase[]> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("test_cases")
    .select("id, name, description, course_id, groups, labels, pacing_rows, events, location_data, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listTestCases failed: ${error.message}`);

  const latestById = new Map<string, TestCase>();
  for (const row of (data ?? []) as TestCaseRow[]) {
    const testCase = rowToTestCase(row);
    const existing = latestById.get(testCase.id);
    if (!existing || testCase.updatedAt > existing.updatedAt) {
      latestById.set(testCase.id, testCase);
    }
  }

  return [...latestById.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTestCase(testCaseId: string): Promise<TestCase | null> {
  assertUuid(testCaseId, "getTestCase.testCaseId");

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("test_cases")
    .select("id, name, description, course_id, groups, labels, pacing_rows, events, location_data, created_at, updated_at")
    .eq("id", testCaseId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getTestCase failed: ${error.message}`);
  return data ? rowToTestCase(data as TestCaseRow) : null;
}

export async function upsertTestCaseRecord(tc: TestCase) {
  const supabase = supabaseServer();
  const row = testCaseToRow(tc);
  const { error } = await supabase
    .from("test_cases")
    .upsert(row, { onConflict: "id" });

  if (error) throw new Error(`upsertTestCaseRecord failed: ${error.message}`);
  return { ok: true, testCaseId: row.id };
}

export async function deleteTestCaseRecord(testCaseId: string) {
  assertUuid(testCaseId, "deleteTestCaseRecord.testCaseId");

  const supabase = supabaseServer();
  const { error } = await supabase
    .from("test_cases")
    .delete()
    .eq("id", testCaseId);

  if (error) throw new Error(`deleteTestCaseRecord failed: ${error.message}`);
  return { ok: true };
}

export async function migrateLocalTestCasesBatch(cases: TestCase[]) {
  if (!Array.isArray(cases)) throw new Error("Expected an array of test cases.");
  if (cases.length === 0) return { ok: true, count: 0 };

  const rows = cases.map(testCaseToRow);

  const supabase = supabaseServer();
  const { error } = await supabase
    .from("test_cases")
    .upsert(rows, { onConflict: "id" });

  if (error) throw new Error(`migrateLocalTestCasesBatch failed: ${error.message}`);
  return { ok: true, count: rows.length };
}
