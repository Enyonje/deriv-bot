"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "./useDerivWebSocket";

export type ManualPhase = "idle" | "buying" | "open" | "unverified";

export interface ManualOpenTrade {
    contractId: number;
    side: "CALL" | "PUT";
    symbol: string;
    stake: number;
    buyPrice: number | null;
    profit: number | null;
    spot: number | null;
    openedAt: number;
}

export interface ManualTradeRecord {
    id: number;
    openedAt: number;
    symbol: string;
    side: "CALL" | "PUT";
    stake: number;
    profit: number;
    result: "won" | "lost";
}

export interface BuyRequest {
    proposalId: string;
    side: "CALL" | "PUT";
    symbol: string;
    stake: number;
}

interface Params {
    status: ConnectionStatus;
    send: (payload: Record<string, unknown>) => boolean;
    addMessageListener: (listener: (msg: Record<string, any>) => void) => () => void;
    log: (message: string) => void;
}

const REQ_BASE = 2_000_000;
const BUY_TIMEOUT_MS = 15_000;
const HISTORY_LIMIT = 20;

/** Places one manual trade at a time and follows it to settlement. */
export function useManualTrade({ status, send, addMessageListener, log }: Params) {
    const [phase, setPhaseState] = useState<ManualPhase>("idle");
    const [open, setOpen] = useState<ManualOpenTrade | null>(null);
    const [history, setHistory] = useState<ManualTradeRecord[]>([]);
    const [error, setError] = useState<string | null>(null);

    const phaseRef = useRef<ManualPhase>("idle");
    const nextReq = useRef(REQ_BASE);
    const nextRecordId = useRef(1);
    const pendingBuy = useRef<{ reqId: number; request: BuyRequest } | null>(null);
    const openRef = useRef<ManualOpenTrade | null>(null);
    const subRef = useRef<string | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevStatus = useRef<ConnectionStatus>(status);

    const setPhase = useCallback((p: ManualPhase) => {
        phaseRef.current = p;
        setPhaseState(p);
    }, []);

    const clearBuyTimeout = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
    }, []);

    const subscribe = useCallback(
        (contractId: number) => {
            send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1, req_id: nextReq.current++ });
        },
        [send],
    );

    useEffect(
        () =>
            addMessageListener((msg) => {
                // Reply to our purchase request.
                const pending = pendingBuy.current;
                if (pending && msg.req_id === pending.reqId) {
                    clearBuyTimeout();
                    pendingBuy.current = null;
                    if (msg.error) {
                        setError(msg.error.message ?? "The purchase was rejected.");
                        setPhase("idle");
                        return;
                    }
                    const contractId = Number(msg.buy?.contract_id);
                    if (!Number.isFinite(contractId)) {
                        setError("Unreadable purchase response. Check your Deriv account before trading again.");
                        setPhase("unverified");
                        return;
                    }
                    const trade: ManualOpenTrade = {
                        contractId,
                        side: pending.request.side,
                        symbol: pending.request.symbol,
                        stake: pending.request.stake,
                        buyPrice: Number.isFinite(Number(msg.buy?.buy_price)) ? Number(msg.buy.buy_price) : null,
                        profit: null,
                        spot: null,
                        openedAt: Date.now(),
                    };
                    openRef.current = trade;
                    setOpen(trade);
                    setPhase("open");
                    log(`🟢 Manual ${trade.side} bought on ${trade.symbol} (#${contractId}).`);
                    subscribe(contractId);
                    return;
                }

                // Updates for the open contract.
                const c = msg.proposal_open_contract;
                const current = openRef.current;
                if (!c || !current || Number(c.contract_id) !== current.contractId) return;
                if (typeof msg.subscription?.id === "string") subRef.current = msg.subscription.id;

                const profit = Number(c.profit);
                const spot = Number(c.current_spot);
                const sold = c.is_sold === 1 || c.is_sold === true;

                if (!sold) {
                    const next = {
                        ...current,
                        profit: Number.isFinite(profit) ? profit : current.profit,
                        spot: Number.isFinite(spot) ? spot : current.spot,
                    };
                    openRef.current = next;
                    setOpen(next);
                    return;
                }

                if (subRef.current) send({ forget: subRef.current });
                subRef.current = null;
                openRef.current = null;
                setOpen(null);

                if (!Number.isFinite(profit)) {
                    setError("A trade settled with an unreadable result. Check your Deriv account.");
                    setPhase("unverified");
                    return;
                }
                setHistory((h) =>
                    [
                        {
                            id: nextRecordId.current++,
                            openedAt: current.openedAt,
                            symbol: current.symbol,
                            side: current.side,
                            stake: current.stake,
                            profit,
                            result: (profit > 0 ? "won" : "lost") as "won" | "lost",
                        },
                        ...h,
                    ].slice(0, HISTORY_LIMIT),
                );
                log(`${profit > 0 ? "✅ Manual trade won" : "❌ Manual trade lost"}: ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}.`);
                setPhase("idle");
            }),
        [addMessageListener, send, subscribe, log, setPhase, clearBuyTimeout],
    );

    // Connection drops and recoveries.
    useEffect(() => {
        const was = prevStatus.current;
        prevStatus.current = status;
        if (was === "connected" && status !== "connected" && phaseRef.current === "buying") {
            clearBuyTimeout();
            pendingBuy.current = null;
            setError("Connection lost while buying. Check your Deriv account for an open contract before trading again.");
            setPhase("unverified");
        }
        if (was !== "connected" && status === "connected" && openRef.current) {
            log("Reconnected. Resuming tracking of your open trade.");
            subscribe(openRef.current.contractId);
        }
    }, [status, subscribe, log, setPhase, clearBuyTimeout]);

    useEffect(() => clearBuyTimeout, [clearBuyTimeout]);

    /** Returns true when the purchase request was sent. */
    const buy = useCallback(
        (request: BuyRequest): boolean => {
            if (phaseRef.current !== "idle") return false;
            setError(null);
            const reqId = nextReq.current++;
            // `price` is the most we will pay; with a stake-based proposal that is exactly the stake.
            if (!send({ buy: request.proposalId, price: request.stake, req_id: reqId })) {
                setError("Not connected to Deriv.");
                return false;
            }
            pendingBuy.current = { reqId, request };
            setPhase("buying");
            timeoutRef.current = setTimeout(() => {
                pendingBuy.current = null;
                setError("No purchase confirmation received. Check your Deriv account before trading again.");
                setPhase("unverified");
            }, BUY_TIMEOUT_MS);
            return true;
        },
        [send, setPhase],
    );

    /** Clears an error or an "unverified" lock once the user has checked their account. */
    const dismiss = useCallback(() => {
        setError(null);
        if (phaseRef.current === "unverified") setPhase("idle");
    }, [setPhase]);

    return { phase, open, history, error, buy, dismiss };
}