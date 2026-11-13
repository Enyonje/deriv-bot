"use client";

import { useEffect, useMemo, useState } from "react";
import { groupByMarket, parseActiveSymbols, type MarketGroup, type MarketSymbol } from "../strategy/symbols";
import type { ConnectionStatus } from "./useDerivWebSocket";

interface Params {
    status: ConnectionStatus;
    /** Always kept selectable, even if the exchange is closed, so the dropdown never loses the current value. */
    currentSymbol: string | null;
    send: (payload: Record<string, unknown>) => boolean;
    addMessageListener: (listener: (msg: Record<string, any>) => void) => () => void;
}

const REQ_ID = 3_000_000;

/** Loads the list of tradable markets once per connection. */
export function useActiveSymbols({ status, currentSymbol, send, addMessageListener }: Params) {
    const [all, setAll] = useState<MarketSymbol[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(
        () =>
            addMessageListener((msg) => {
                if (msg.req_id !== REQ_ID) return;
                setLoading(false);
                if (msg.error) {
                    setError(msg.error.message ?? "Could not load markets");
                    return;
                }
                setError(null);
                setAll(parseActiveSymbols(msg.active_symbols));
            }),
        [addMessageListener],
    );

    useEffect(() => {
        if (status !== "connected") return;
        setLoading(true);
        if (!send({ active_symbols: "brief", req_id: REQ_ID })) setLoading(false);
    }, [status, send]);

    const groups: MarketGroup[] = useMemo(() => {
        const visible = all.filter((s) => s.tradable || s.symbol === currentSymbol);
        if (currentSymbol && !visible.some((s) => s.symbol === currentSymbol)) {
            visible.push({ symbol: currentSymbol, name: currentSymbol, market: "current", submarket: null, tradable: true });
        }
        return groupByMarket(visible);
    }, [all, currentSymbol]);

    const nameOf = (symbol: string | null): string =>
        (symbol && all.find((s) => s.symbol === symbol)?.name) || symbol || "";

    return { groups, loading, error, nameOf };
}