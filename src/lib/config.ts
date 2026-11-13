// src/lib/config.ts
export class ConfigError extends Error { }

const ACCOUNT_TYPES = ["demo", "real"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface DerivConfig {
    apiBase: string;
    appId: string;
    pat: string;
    accountId: string;
    accountType: AccountType;
    symbol: string;
}

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new ConfigError(`Missing required environment variable ${name}`);
    return value;
}

/** Checks if real account trading is explicitly enabled via environment variables. */
export function isRealAccountAllowed(): boolean {
    return process.env.DERIV_ALLOW_REAL === "true";
}

/** Returns the maximum session age in seconds. Defaults to 24 hours (86400s) if not specified. */
export function getSessionMaxAgeSeconds(): number {
    const val = process.env.SESSION_MAX_AGE || process.env.DERIV_SESSION_MAX_AGE;
    if (val) {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 86400; // Default: 24 hours
}

/** Reads and validates configuration at request time. */
export function getConfig(): DerivConfig {
    const apiBase = required("DERIV_API_BASE").replace(/\/+$/, "");
    let parsed: URL;
    try {
        parsed = new URL(apiBase);
    } catch {
        throw new ConfigError("DERIV_API_BASE must be a valid URL");
    }
    if (parsed.protocol !== "https:") throw new ConfigError("DERIV_API_BASE must use https");

    const accountType = required("DERIV_ACCOUNT_TYPE").toLowerCase() as AccountType;
    if (!ACCOUNT_TYPES.includes(accountType)) {
        throw new ConfigError("DERIV_ACCOUNT_TYPE must be 'demo' or 'real'");
    }
    if (accountType === "real" && !isRealAccountAllowed()) {
        throw new ConfigError("DERIV_ACCOUNT_TYPE=real requires DERIV_ALLOW_REAL=true");
    }

    const symbol = required("DERIV_SYMBOL");
    if (!/^[A-Za-z0-9_]+$/.test(symbol)) throw new ConfigError("DERIV_SYMBOL contains invalid characters");

    return {
        apiBase,
        appId: required("DERIV_APP_ID"),
        pat: required("DERIV_PAT"),
        accountId: required("DERIV_ACCOUNT_ID"),
        accountType,
        symbol,
    };
}

/** Convenience helper matching route imports */
export function getApiBase(): string {
    return getConfig().apiBase;
}