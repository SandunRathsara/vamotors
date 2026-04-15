import { NextResponse } from "next/server";
import { resetAll } from "@/lib/mock-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }
  resetAll();
  return NextResponse.json({ ok: true });
}
