// src/app/api/deriv/session/route.ts
import { ConfigError, getApiBase } from "@/lib/config";
import { readAccount } from "@/lib/credentials";
import { DerivError, requestOtp } from "@/lib/deriv";
import { isSameOrigin, jsonError, jsonOk } from "@/lib/http";

//export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Issues a fresh single-use WebSocket URL for the account stored in the caller's cookie.
 * The PAT stays on the server; the URL contains an OTP and is never logged.
 */
export async function POST(req: Request) {
    if (!isSameOrigin(req)) return jsonError(403, "Cross-origin request blocked.");

    try {
        const account = await readAccount();
        if (!account) return jsonError(401, "No Deriv account connected. Add your account details first.");

        const { url, accountType } = await requestOtp(getApiBase(), account);
        if (accountType !== account.accountType) {
            return jsonError(409, "Account type changed at Deriv. Remove the account and add it again.");
        }
        return jsonOk({ url, accountType, symbol: account.symbol });
    } catch (err) {
        if (err instanceof DerivError) return jsonError(err.status, err.message, err.retryable);
        if (err instanceof ConfigError) {
            console.error("[session] configuration error:", err.message);
            return jsonError(500, "Server is not configured. Contact the administrator.");
        }
        console.error("[session] unexpected error:", err instanceof Error ? err.name : "unknown");
        return jsonError(500, "Something went wrong. Try again.", true);
    }
}