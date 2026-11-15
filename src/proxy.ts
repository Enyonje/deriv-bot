import { NextResponse, type NextRequest } from "next/server";

// NOTE: on Next.js 16+ this file convention is renamed to `proxy.ts` (export `proxy`).

function safeEqual(a: string, b: string): boolean {
    // Constant-time comparison (Edge runtime has no crypto.timingSafeEqual).
    const len = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
}

function isAuthorized(req: NextRequest, user: string, pass: string): boolean {
    const header = req.headers.get("authorization");
    if (!header?.startsWith("Basic ")) return false;
    try {
        const decoded = atob(header.slice(6));
        const idx = decoded.indexOf(":");
        if (idx < 0) return false;
        const okUser = safeEqual(decoded.slice(0, idx), user);
        const okPass = safeEqual(decoded.slice(idx + 1), pass);
        return okUser && okPass;
    } catch {
        return false;
    }
}

function contentSecurityPolicy(): string {
    const isDev = process.env.NODE_ENV !== "production";
    let wsOrigin = "";
    try {
        wsOrigin = `wss://${new URL(process.env.DERIV_API_BASE ?? "").host}`;
    } catch {
        /* DERIV_API_BASE missing/invalid: the session route reports it; CSP stays strict */
    }
    return [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        `connect-src 'self' ${wsOrigin}${isDev ? " ws:" : ""}`.trim(),
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
    ].join("; ");
}

const PUBLIC_PATHS = new Set([
    "/", "/features", "/ai-trading", "/strategies", "/pricing", "/faq",
    "/about", "/contact", "/risk-disclosure", "/privacy", "/terms", "/robots.txt", "/sitemap.xml",
    "/og-derivbot.png",
]);

function isPublicPath(pathname: string): boolean {
    return PUBLIC_PATHS.has(pathname);
}

export function proxy(req: NextRequest) {
    const user = process.env.BASIC_AUTH_USER;
    const pass = process.env.BASIC_AUTH_PASSWORD;

    if (!isPublicPath(req.nextUrl.pathname) && (!user || !pass)) {
        // Fail closed in production: never expose a trading session without access control.
        if (process.env.NODE_ENV === "production") {
            return new NextResponse("Service not configured", { status: 503 });
        }
    } else if (!isPublicPath(req.nextUrl.pathname) && !isAuthorized(req, user!, pass!)) {
        return new NextResponse("Authentication required", {
            status: 401,
            headers: { "WWW-Authenticate": 'Basic realm="Deriv Bot", charset="UTF-8"', "Cache-Control": "no-store" },
        });
    }

    const res = NextResponse.next();
    res.headers.set("Content-Security-Policy", contentSecurityPolicy());
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return res;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};