import { NextResponse } from "next/server";

//export const dynamic = "force-dynamic";

/** Liveness probe for Docker / orchestrators. Intentionally dependency-free. */
export function GET() {
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}