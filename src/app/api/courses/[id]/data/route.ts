import { NextRequest, NextResponse } from "next/server";
import { getCourse, getCourseHoles, getCourseLandmarks, getCourseCartPaths } from "@/app/actions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [course, holes, landmarks, cartPaths] = await Promise.all([
      getCourse(id),
      getCourseHoles(id),
      getCourseLandmarks(id),
      getCourseCartPaths(id),
    ]);
    return NextResponse.json({ course, holes, landmarks, cartPaths });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to load course data" },
      { status: 400 }
    );
  }
}
