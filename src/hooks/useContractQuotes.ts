"use client";

import { useEffect, useRef, useState } from "react";
import { parseQuote, type Quote } from "../strategy/quotes";

export type QuoteSide = "CALL" | "PUT";
export type DurationUnit = "t" | "s" | "m";
type PerSide<T> = Record<QuoteSide, T>;

interface Params {
    enabled: boolean;
    symbol: string;
    currency: string | null;
    stake: number;
    duration: number;
    durationUnit: DurationUnit;
    send: (payload: Record<string, unknown>) => boolean;
    addMessageListener: (listener: (msg: Record<string, any>) => void) => () => void;
}

const SIDES: QuoteSide[] = ["CALL", "PUT"];
const REQ_BASE = 1_000_000; // clear of the ids used by the socket hook (1-20), engine (1000+)
const REQ_LIMIT = 2_000_000; // manual trades start at 2,000,000
const DEBOUNCE_MS = 400;

const emptyQuotes = (): PerSide<Quote | null> => ({ CALL: null, PUT: null });
const emptyErrors = (): PerSide<string | null> => ({ CALL: null, PUT: null });

/** Streams live Higher (CALL) and Lower (PUT) prices for the same market, stake and duration. */
export function useContractQuotes({ enabled, symbol, currency, stake, duration, durationUnit, send, addMessageListener }: Params) {
    const [quotes, setQuotes] = useState(emptyQuotes);
    const [errors, setErrors] = useState(emptyErrors);
    const nextReq = useRef(REQ_BASE);
    const active = useRef<{ ids: PerSide<number>; subs: PerSide<string | null> } | null>(null);

    useEffect(
        () =>
            addMessageListener((msg) => {
                const reqId: unknown = msg.req_id ?? msg.echo_req?.req_id;
                if (typeof reqId !== "number" || reqId < REQ_BASE || reqId >= REQ_LIMIT) return;

                const current = active.current;
                const side = current ? SIDES.find((s) => current.ids[s] === reqId) : undefined;

                if (!current || !side) {
                    // A late reply for a subscription we already replaced: release it so it stops streaming.
                    if (typeof msg.subscription?.id === "string") send({ forget: msg.subscription.id });
                    return;
                }

                if (msg.error) {
                    setErrors((e) => ({ ...e, [side]: msg.error.message ?? "Price unavailable" }));
                    setQuotes((q) => ({ ...q, [side]: null }));
                    return;
                }
                if (typeof msg.subscription?.id === "string") current.subs[side] = msg.subscription.id;

                const quote = parseQuote(msg.proposal);
                if (!quote) return;
                setErrors((e) => (e[side] ? { ...e, [side]: null } : e));
                setQuotes((q) => ({ ...q, [side]: quote }));
            }),
        [addMessageListener, send],
    );

    useEffect(() => {
        if (!enabled || !currency || !(stake > 0) || !Number.isInteger(duration) || duration < 1) return;

        // Debounce so typing a stake does not fire a subscription per keystroke.
        const timer = setTimeout(() => {
            const ids: PerSide<number> = { CALL: nextReq.current++, PUT: nextReq.current++ };
            active.current = { ids, subs: { CALL: null, PUT: null } };
            for (const side of SIDES) {
                send({
                    proposal: 1,
                    amount: stake,
                    basis: "stake",
                    contract_type: side,
                    currency,
                    duration,
                    duration_unit: durationUnit,
                    underlying_symbol: symbol,
                    subscribe: 1,
                    req_id: ids[side],
                });
            }
        }, DEBOUNCE_MS);

        return () => {
            clearTimeout(timer);
            const a = active.current;
            active.current = null;
            if (a) for (const side of SIDES) if (a.subs[side]) send({ forget: a.subs[side] });
            setQuotes(emptyQuotes());
            setErrors(emptyErrors());
        };
    }, [enabled, currency, stake, duration, durationUnit, symbol, send]);

    return { quotes, errors };
}