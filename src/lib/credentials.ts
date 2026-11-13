import { cookies } from "next/headers";
import { getSessionMaxAgeSeconds } from "./config";
import { seal, unseal } from "./crypto";
import type { AccountType, DerivCredentials } from "./deriv";

const COOKIE_NAME = "deriv_session";
const COOKIE_PATH = "/"; // Expanded to root so all API endpoints can securely read session context

export interface StoredAccount extends DerivCredentials {
    accountType: AccountType;
}

interface Payload extends StoredAccount {
    exp: number; // epoch seconds
}

export async function saveAccount(account: StoredAccount): Promise<void> {
    const maxAge = getSessionMaxAgeSeconds();
    const payload: Payload = { ...account, exp: Math.floor(Date.now() / 1000) + maxAge };

    const sealedData = seal(payload);
    if (!sealedData) {
        throw new Error("Failed to secure session credentials during encryption.");
    }

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, sealedData, {
        httpOnly: true, // not readable by page JavaScript
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: COOKIE_PATH,
        maxAge,
    });
}

export async function readAccount(): Promise<StoredAccount | null> {
    try {
        const cookieStore = await cookies();
        const raw = cookieStore.get(COOKIE_NAME)?.value;
        if (!raw) return null;

        const payload = unseal<Payload>(raw);
        if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) {
            return null;
        }

        const { exp: _exp, ...account } = payload;
        return account;
    } catch (err) {
        console.warn("[credentials] Failed to read or unseal session cookie:", err instanceof Error ? err.message : err);
        return null;
    }
}

export async function clearAccount(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: COOKIE_PATH,
        maxAge: 0
    });
}

/** The only fields the browser is ever allowed to see. Never includes the token. */
export function toPublicAccount(a: StoredAccount) {
    return {
        appId: a.appId,
        accountId: a.accountId,
        accountType: a.accountType,
        symbol: a.symbol
    };
}