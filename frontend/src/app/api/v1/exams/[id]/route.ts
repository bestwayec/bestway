import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const target = `${API_URL}/exams/${encodeURIComponent(id)}`;
    const res = await fetch(target, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: { code: "FETCH_FAILED", message: `Backend returned HTTP ${res.status}` } },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to fetch exam" } },
      { status: 500 }
    );
  }
}
