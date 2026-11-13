"use client";

import { useCallback, useEffect, useState } from "react";

export interface AccountSummary {
    appId: string;
    accountId: string;
    accountType: "demo" | "real";
    symbol: string;
}

export interface AccountForm {
    appId: string;
    pat: string;
    accountId: string;
    symbol: string;
}

async function call(method: "GET" | "POST" | "DELETE", body?: AccountForm) {
    const res = await fetch("/api/deriv/onboard", {
        method,
        cache: "no-store",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
    return (json?.account ?? null) as AccountSummary | null;
}

export function useDerivAccount() {
    const [account, setAccount] = useState<AccountSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        call("GET")
            .then((a) => !cancelled && setAccount(a))
            .catch((e: Error) => !cancelled && setError(e.message))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, []);

    /** Returns true on success. The token is sent once and never kept in this hook's state. */
    const save = useCallback(async (values: AccountForm): Promise<boolean> => {
        setSaving(true);
        setError(null);
        try {
            setAccount(await call("POST", values));
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save account");
            return false;
        } finally {
            setSaving(false);
        }
    }, []);

    const remove = useCallback(async (): Promise<boolean> => {
        setError(null);
        try {
            await call("DELETE");
            setAccount(null);
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not remove account");
            return false;
        }
    }, []);

    return { account, loading, saving, error, save, remove };
}