import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const supabase = supabaseServer();

    const { data: session, error: sessionError } = await supabase
      .from("course_sessions")
      .select(`
        id,
        name,
        course_id,
        golf_courses (
          id,
          name
        )
      `)
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return new NextResponse(
        sessionError?.message ?? "Session not found",
        { status: 404 }
      );
    }

    const golfCourses = session.golf_courses as any;
    const courseName = Array.isArray(golfCourses)
      ? golfCourses[0]?.name ?? null
      : golfCourses?.name ?? null;

    const { data: holes, error: holesError } = await supabase
      .from("course_holes")
      .select(
        "hole_number, tee_lat, tee_lng, green_lat, green_lng, allotted_time"
      )
      .eq("course_id", session.course_id)
      .order("hole_number", { ascending: true });

    if (holesError) {
      return new NextResponse(holesError.message, { status: 500 });
    }

    const { data: landmarks, error: landmarksError } = await supabase
      .from("course_landmarks")
      .select("id, landmark_type, latitude, longitude, endpoint1_latitude, endpoint1_longitude, endpoint2_latitude, endpoint2_longitude")
      .eq("course_id", session.course_id)
      .order("id", { ascending: true });

    if (landmarksError) {
      return new NextResponse(landmarksError.message, { status: 500 });
    }

    const { data: groups, error: groupsError } = await supabase
      .from("session_groups")
      .select("id, label, tee_time")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (groupsError) {
      return new NextResponse(groupsError.message, { status: 500 });
    }

    const groupIds = (groups ?? []).map((g) => g.id);

    const { data: groupPlayers, error: groupPlayersError } =
      groupIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("group_players")
            .select("group_id, user_id")
            .in("group_id", groupIds);

    if (groupPlayersError) {
      return new NextResponse(groupPlayersError.message, { status: 500 });
    }

    const userIds = Array.from(
      new Set((groupPlayers ?? []).map((gp) => gp.user_id))
    );

    const { data: users, error: usersError } =
      userIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("auth_user_options")
            .select("id, email")
            .in("id", userIds);

    if (usersError) {
      return new NextResponse(usersError.message, { status: 500 });
    }

    const usersById = new Map(
      (users ?? []).map((u: any) => [u.id, u.email])
    );

    const { data: locations, error: locationsError } = await supabase
      .from("session_locations")
      .select(
        "id, session_id, user_id, recorded_at, latitude, longitude, horizontal_accuracy"
      )
      .eq("session_id", sessionId)
      .order("recorded_at", { ascending: true });

    if (locationsError) {
      return new NextResponse(locationsError.message, { status: 500 });
    }

    const groupsJson = (groups ?? []).map((group: any) => ({
      group_id: group.id,
      label: group.label,
      tee_time: group.tee_time,
      player_user_ids: (groupPlayers ?? [])
        .filter((gp: any) => gp.group_id === group.id)
        .map((gp: any) => gp.user_id),
    }));

    const playerIds = Array.from(
      new Set((locations ?? []).map((row: any) => row.user_id).filter(Boolean))
    );

    const playersJson = playerIds.map((userId) => ({
      user_id: userId,
      email: usersById.get(userId) ?? null,
      locations: (locations ?? [])
        .filter((row: any) => row.user_id === userId)
        .map((row: any) => ({
          id: row.id,
          recorded_at: row.recorded_at,
          latitude: row.latitude,
          longitude: row.longitude,
          horizontal_accuracy: row.horizontal_accuracy,
        })),
    }));

    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      session_id: session.id,
      session_name: session.name,
      course_id: session.course_id,
      course_name: courseName,
      holes: (holes ?? []).map((h: any) => ({
        hole_number: h.hole_number,
        tee_lat: h.tee_lat,
        tee_lng: h.tee_lng,
        green_lat: h.green_lat,
        green_lng: h.green_lng,
        allotted_time: h.allotted_time,
      })),
      course_landmarks: (landmarks ?? []).map((l: any) => ({
        id: l.id,
        landmark_type: l.landmark_type,
        ...(l.landmark_type === "driving_range"
          ? {
              endpoint1_latitude: l.endpoint1_latitude,
              endpoint1_longitude: l.endpoint1_longitude,
              ...(l.endpoint2_latitude != null
                ? { endpoint2_latitude: l.endpoint2_latitude, endpoint2_longitude: l.endpoint2_longitude }
                : {}),
            }
          : {
              latitude: l.latitude,
              longitude: l.longitude,
            }),
      })),
      groups: groupsJson,
      players: playersJson,
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="session_${sessionId}_export.json"`,
      },
    });
  } catch (error: any) {
    return new NextResponse(
      error?.message ?? "Failed to export session JSON",
      { status: 500 }
    );
  }
}