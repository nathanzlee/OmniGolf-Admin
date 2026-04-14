"use server";

import { supabaseServer } from "@/lib/supabase/server";

function assertUuid(id: string, label: string) {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(id)) throw new Error(`Invalid UUID for ${label}: "${id}"`);
}

/* =====================================================
   Course types
===================================================== */

export type HoleInput = {
  holeNumber: number;
  teeLat: number;
  teeLng: number;
  greenLat: number;
  greenLng: number;
  allottedTime: number;
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
  playerUserIds: string[];
};

export type SessionGroupRecord = {
  id: string;
  label: string | null;
  tee_time: string | null;
};

export type SessionGroupPlayerRecord = {
  group_id: string;
  user_id: string;
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
    for (const userId of group.playerUserIds) {
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
      })
      .select("id")
      .single();

    if (createGroupErr) {
      throw new Error(`createSession create group failed: ${createGroupErr.message}`);
    }

    if (group.playerUserIds.length > 0) {
      const rows = group.playerUserIds.map((userId) => ({
        group_id: createdGroup.id,
        user_id: userId,
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
    .select("id, label, tee_time")
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
      session_groups!inner (
        session_id
      )
    `)
    .eq("session_groups.session_id", sessionId);

  if (error) throw new Error(`getSessionGroupPlayers failed: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    group_id: row.group_id,
    user_id: row.user_id,
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

    for (const userId of group.playerUserIds) {
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

  const existingGroupIds = (existingGroups ?? []).map((g) => g.id);

  if (existingGroupIds.length > 0) {
    const { error: deleteGroupPlayersErr } = await supabase
      .from("group_players")
      .delete()
      .in("group_id", existingGroupIds);

    if (deleteGroupPlayersErr) {
      throw new Error(`updateSession delete group players failed: ${deleteGroupPlayersErr.message}`);
    }

    const { error: deleteGroupsErr } = await supabase
      .from("session_groups")
      .delete()
      .eq("session_id", sessionId);

    if (deleteGroupsErr) {
      throw new Error(`updateSession delete groups failed: ${deleteGroupsErr.message}`);
    }
  }

  for (const group of groups) {
    const { data: createdGroup, error: createGroupErr } = await supabase
      .from("session_groups")
      .insert({
        session_id: sessionId,
        label: group.label?.trim() || null,
        tee_time: group.teeTime || null,
      })
      .select("id")
      .single();

    if (createGroupErr) {
      throw new Error(`updateSession create group failed: ${createGroupErr.message}`);
    }

    if (group.playerUserIds.length > 0) {
      const rows = group.playerUserIds.map((userId) => ({
        group_id: createdGroup.id,
        user_id: userId,
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