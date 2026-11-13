import { NextResponse } from "next/server";

/** CSRF defence for cookie-authenticated mutations: Origin must match the host we serve. */
export function isSameOrigin(req: Request): boolean {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || !host) return false;
    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

export function jsonError(status: number, error: string, retryable = false) {
    return NextResponse.json({ error, retryable }, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonOk(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}