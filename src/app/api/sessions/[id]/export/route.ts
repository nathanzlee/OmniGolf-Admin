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

    // Fetch cart paths through the parent course_hole_cart_paths table
    const { data: cartPathData, error: cartPathsError } = await supabase
      .from("course_hole_cart_paths")
      .select(`
        id,
        label,
        path_type,
        course_holes!inner(hole_number),
        course_hole_cart_path_points(seq, latitude, longitude)
      `)
      .eq("course_id", session.course_id)
      .order("seq", { referencedTable: "course_hole_cart_path_points", ascending: true });

    if (cartPathsError) {
      return new NextResponse(cartPathsError.message, { status: 500 });
    }

    // Build a map: holeNumber -> [{label, path_type, coordinates}]
    const cartPathsByHole = new Map<number, { label: string | null; path_type: string; coordinates: { lat: number; lng: number }[] }[]>();
    for (const cp of cartPathData ?? []) {
      const courseHoles = Array.isArray((cp as any).course_holes)
        ? (cp as any).course_holes[0]
        : (cp as any).course_holes;
      const holeNumber = courseHoles?.hole_number as number;
      if (!holeNumber) continue;

      const coordinates = [...((cp as any).course_hole_cart_path_points ?? [])]
        .sort((a: any, b: any) => a.seq - b.seq)
        .map((p: any) => ({ lat: p.latitude as number, lng: p.longitude as number }));

      if (!cartPathsByHole.has(holeNumber)) cartPathsByHole.set(holeNumber, []);
      cartPathsByHole.get(holeNumber)!.push({
        label: (cp as any).label ?? null,
        path_type: (cp as any).path_type ?? "cart_path",
        coordinates,
      });
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
      .select("id, label, tee_time, start_hole")
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
            .select("group_id, user_id, using_carts")
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

    const usingCartsByUserId = new Map<string, boolean>(
      (groupPlayers ?? []).map((gp: any) => [gp.user_id, gp.using_carts ?? false])
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
      start_hole: group.start_hole ?? 1,
      players: (groupPlayers ?? [])
        .filter((gp: any) => gp.group_id === group.id)
        .map((gp: any) => ({ user_id: gp.user_id, using_carts: gp.using_carts ?? false })),
    }));

    const playerIds = Array.from(
      new Set((locations ?? []).map((row: any) => row.user_id).filter(Boolean))
    );

    const playersJson = playerIds.map((userId) => ({
      user_id: userId,
      email: usersById.get(userId) ?? null,
      using_carts: usingCartsByUserId.get(userId) ?? false,
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
        cart_paths: cartPathsByHole.get(h.hole_number) ?? [],
      })),
      course_landmarks: (landmarks ?? []).map((l: any) => {
        if (l.landmark_type === "driving_range") {
          const lat1 = l.endpoint1_latitude as number | null;
          const lng1 = l.endpoint1_longitude as number | null;
          const lat2 = l.endpoint2_latitude as number | null;
          const lng2 = l.endpoint2_longitude as number | null;
          const midLat = lat1 != null && lat2 != null ? (lat1 + lat2) / 2 : lat1;
          const midLng = lng1 != null && lng2 != null ? (lng1 + lng2) / 2 : lng1;
          return {
            id: l.id,
            landmark_type: l.landmark_type,
            latitude: midLat,
            longitude: midLng,
            endpoint1_latitude: lat1,
            endpoint1_longitude: lng1,
            ...(lat2 != null ? { endpoint2_latitude: lat2, endpoint2_longitude: lng2 } : {}),
          };
        }
        return {
          id: l.id,
          landmark_type: l.landmark_type,
          latitude: l.latitude,
          longitude: l.longitude,
        };
      }),
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
