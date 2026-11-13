export type AccountType = "demo" | "real";

export interface DerivCredentials {
    appId: string;
    pat: string;
    accountId: string;
    symbol: string;
}

export class DerivError extends Error {
    constructor(message: string, readonly status: number, readonly retryable: boolean) {
        super(message);
    }
}

const REQUEST_TIMEOUT_MS = 10_000;

/** Validates user-supplied credentials. Returns an error message or null. */
export function validateCredentials(input: Partial<Record<keyof DerivCredentials, unknown>>): string | null {
    const { appId, pat, accountId, symbol } = input;
    if (typeof appId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(appId.trim())) {
        return "App ID is missing or contains invalid characters.";
    }
    if (typeof pat !== "string" || pat.trim().length < 8 || pat.length > 512 || /\s/.test(pat.trim())) {
        return "Personal access token is missing or malformed.";
    }
    if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{3,64}$/.test(accountId.trim())) {
        return "Account ID is missing or contains invalid characters.";
    }
    if (typeof symbol !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(symbol.trim())) {
        return "Market symbol is missing or invalid (letters, digits and underscores only).";
    }
    return null;
}

/**
 * Exchanges the PAT for a short-lived single-use authenticated WebSocket URL and
 * determines whether the account is demo or real from the URL Deriv issues.
 * The returned URL contains an OTP and must never be logged.
 */
export async function requestOtp(
    apiBase: string,
    creds: DerivCredentials,
): Promise<{ url: string; accountType: AccountType }> {
    let res: Response;
    try {
        res = await fetch(`${apiBase}/trading/v1/options/accounts/${encodeURIComponent(creds.accountId)}/otp`, {
            method: "POST",
            headers: { Authorization: `Bearer ${creds.pat}`, "Deriv-App-ID": creds.appId },
            cache: "no-store",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        console.error("[deriv] upstream unreachable:", err instanceof Error ? err.name : "unknown");
        throw new DerivError("Could not reach Deriv. Try again shortly.", 502, true);
    }

    if (!res.ok) {
        console.error("[deriv] OTP request rejected, status", res.status);
        if (res.status === 401 || res.status === 403) {
            throw new DerivError("Deriv rejected the App ID or token. Check both and the token's scopes.", 401, false);
        }
        if (res.status === 400 || res.status === 404) {
            throw new DerivError("Deriv does not recognise that account ID for this token.", 400, false);
        }
        throw new DerivError("Deriv returned an error. Try again shortly.", 502, true);
    }

    let wsUrl: URL;
    try {
        const body = (await res.json()) as { data?: { url?: unknown } };
        if (typeof body?.data?.url !== "string") throw new Error("missing url");
        wsUrl = new URL(body.data.url);
    } catch {
        console.error("[deriv] unexpected OTP response shape");
        throw new DerivError("Unexpected response from Deriv.", 502, true);
    }

    if (wsUrl.protocol !== "wss:" || wsUrl.host !== new URL(apiBase).host) {
        console.error("[deriv] OTP URL host/protocol mismatch");
        throw new DerivError("Unexpected response from Deriv.", 502, false);
    }
    const last = wsUrl.pathname.split("/").filter(Boolean).pop();
    if (last !== "demo" && last !== "real") {
        console.error("[deriv] cannot determine account type from OTP URL");
        throw new DerivError("Unexpected response from Deriv.", 502, false);
    }

    return { url: wsUrl.toString(), accountType: last };
}