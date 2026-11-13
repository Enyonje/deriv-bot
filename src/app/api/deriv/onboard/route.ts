// src/app/api/deriv/onboard/route.ts
import { ConfigError, getConfig, getApiBase, isRealAccountAllowed } from "@/lib/config";
import { clearAccount, readAccount, saveAccount, toPublicAccount } from "@/lib/credentials";
import { DerivError, requestOtp, validateCredentials, type DerivCredentials } from "@/lib/deriv";
import { isSameOrigin, jsonError, jsonOk } from "@/lib/http";

/** Current onboarding state. Never returns the token. */
export async function GET() {
    try {
        const account = await readAccount();
        return jsonOk({ account: account ? toPublicAccount(account) : null });
    } catch (err) {
        console.error("[onboard] GET failed:", err instanceof Error ? err.message : err);
        return jsonError(500, "Server is not configured. Contact the administrator.");
    }
}

/** 
 * Verifies credentials against Deriv. 
 * Automatically falls back to server environment defaults (DERIV_APP_ID) 
 * so normal traders don't need a developer account.
 */
export async function POST(req: Request) {
    if (!isSameOrigin(req)) return jsonError(403, "Cross-origin request blocked.");

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return jsonError(400, "Invalid request body.");

    // Pull server-side configuration defaults as fallback for non-developer traders
    let serverConfig;
    try {
        serverConfig = getConfig();
    } catch {
        // If server config isn't fully set up yet, we handle validation gracefully below
    }

    // Fallback to server environment defaults if client didn't supply developer fields
    const appId = String(body.appId || serverConfig?.appId || "").trim();
    const pat = String(body.pat || serverConfig?.pat || "").trim();
    const accountId = String(body.accountId || "").trim();
    const symbol = String(body.symbol || serverConfig?.symbol || "R_100").trim();

    const creds: DerivCredentials = { appId, pat, accountId, symbol };

    const validationError = validateCredentials(creds);
    if (validationError) return jsonError(400, validationError);

    try {
        const { accountType } = await requestOtp(getApiBase(), creds); // proves the credentials work
        if (accountType === "real" && !isRealAccountAllowed()) {
            return jsonError(403, "Real-money accounts are disabled on this deployment. Use a demo account.");
        }
        const account = { ...creds, accountType };
        await saveAccount(account);
        return jsonOk({ account: toPublicAccount(account) });
    } catch (err) {
        if (err instanceof DerivError) return jsonError(err.status, err.message, err.retryable);
        if (err instanceof ConfigError) {
            console.error("[onboard] configuration error:", err.message);
            return jsonError(500, "Server is not configured. Contact the administrator.");
        }
        console.error("[onboard] unexpected error:", err instanceof Error ? err.name : "unknown");
        return jsonError(500, "Something went wrong. Try again.");
    }
}

/** Removes the stored credentials. */
export async function DELETE(req: Request) {
    if (!isSameOrigin(req)) return jsonError(403, "Cross-origin request blocked.");
    await clearAccount();
    return jsonOk({ account: null });
}