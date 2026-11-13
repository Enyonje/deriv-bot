"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

interface SessionResponse {
    url: string;
    accountType: "demo" | "real";
    symbol: string;
}

export interface UseDerivWebSocketOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    pingIntervalMs?: number;
    maxLogLines?: number;
    autoConnect?: boolean; // Added autoConnect option
}

interface Balance {
    amount: number;
    currency: string;
}

interface Tick {
    quote: number;
    pipSize: number | null;
}

const DEFAULTS: Required<UseDerivWebSocketOptions> = {
    maxRetries: 5,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    pingIntervalMs: 30_000,
    maxLogLines: 200,
    autoConnect: true, // Default to auto-connecting on mount
};

class SessionError extends Error {
    constructor(message: string, readonly retryable: boolean) {
        super(message);
    }
}

async function requestSession(): Promise<SessionResponse> {
    let res: Response;
    try {
        res = await fetch("/api/deriv/session", { method: "POST", cache: "no-store" });
    } catch {
        throw new SessionError("Network error while requesting a session", true);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        throw new SessionError(body?.error ?? `Session request failed (${res.status})`, body?.retryable ?? res.status >= 500);
    }
    if (typeof body?.url !== "string" || typeof body?.symbol !== "string") {
        throw new SessionError("Malformed session response", false);
    }
    return body as SessionResponse;
}

export function useDerivWebSocket(options: UseDerivWebSocketOptions = {}) {
    const { maxRetries, baseDelayMs, maxDelayMs, pingIntervalMs, maxLogLines, autoConnect } = { ...DEFAULTS, ...options };

    const [status, setStatus] = useState<ConnectionStatus>("disconnected");
    const [balance, setBalance] = useState<Balance | null>(null);
    const [tick, setTick] = useState<Tick | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [accountType, setAccountType] = useState<SessionResponse["accountType"] | null>(null);
    const [symbol, setSymbol] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const runRef = useRef(0);
    const attemptRef = useRef(0);
    const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const openRef = useRef<(isRetry: boolean) => Promise<void>>(async () => { });
    const listenersRef = useRef(new Set<(msg: Record<string, any>) => void>());
    const symbolRef = useRef<string | null>(null);
    const tickReqRef = useRef(0);
    const tickSubRef = useRef<string | null>(null);
    const reqCounterRef = useRef(10);

    const log = useCallback(
        (message: string) => {
            const line = `[${new Date().toLocaleTimeString()}] ${message}`;
            setLogs((prev) => [...prev.slice(-(maxLogLines - 1)), line]);
        },
        [maxLogLines],
    );

    const send = useCallback((payload: Record<string, unknown>): boolean => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(payload));
        return true;
    }, []);

    const addMessageListener = useCallback((listener: (msg: Record<string, any>) => void) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);

    const changeSymbol = useCallback(
        (next: string): boolean => {
            if (!/^[A-Za-z0-9_]{1,32}$/.test(next)) return false;
            if (symbolRef.current === next) return true;
            symbolRef.current = next;
            setSymbol(next);
            setTick(null);

            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return true;
            if (tickSubRef.current) ws.send(JSON.stringify({ forget: tickSubRef.current }));
            tickSubRef.current = null;
            const reqId = ++reqCounterRef.current;
            tickReqRef.current = reqId;
            ws.send(JSON.stringify({ ticks: next, subscribe: 1, req_id: reqId }));
            log(`Switched market to ${next}.`);
            return true;
        },
        [log],
    );

    const clearTimers = useCallback(() => {
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        pingTimerRef.current = null;
        retryTimerRef.current = null;
    }, []);

    const teardownSocket = useCallback(() => {
        const ws = wsRef.current;
        wsRef.current = null;
        if (!ws) return;
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000);
    }, []);

    const scheduleRetry = useCallback(
        (reason: string) => {
            if (attemptRef.current >= maxRetries) {
                setStatus("error");
                log(`Giving up after ${maxRetries} reconnect attempts (${reason}).`);
                return;
            }
            const attempt = ++attemptRef.current;
            const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
            const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5));
            setStatus("reconnecting");
            log(`${reason}. Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${attempt}/${maxRetries}).`);
            retryTimerRef.current = setTimeout(() => void openRef.current(true), delay);
        },
        [baseDelayMs, maxDelayMs, maxRetries, log],
    );

    const open = useCallback(
        async (isRetry: boolean) => {
            const runId = ++runRef.current;
            clearTimers();
            teardownSocket();
            setStatus(isRetry ? "reconnecting" : "connecting");
            if (!isRetry) log("Requesting a secure session…");

            let session: SessionResponse;
            try {
                session = await requestSession();
            } catch (err) {
                if (runId !== runRef.current) return;
                const message = err instanceof Error ? err.message : "Session request failed";
                if (err instanceof SessionError && !err.retryable) {
                    setStatus("error");
                    log(`Error: ${message}`);
                } else {
                    scheduleRetry(message);
                }
                return;
            }
            if (runId !== runRef.current) return;

            setAccountType(session.accountType);
            const activeSymbol = symbolRef.current ?? session.symbol;
            symbolRef.current = activeSymbol;
            setSymbol(activeSymbol);

            const ws = new WebSocket(session.url);
            wsRef.current = ws;
            const isCurrent = () => wsRef.current === ws && runId === runRef.current;

            ws.onopen = () => {
                if (!isCurrent()) return;
                attemptRef.current = 0;
                setStatus("connected");
                log(`Connected to Deriv (${session.accountType}).`);
                ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: 1 }));
                const tickReq = ++reqCounterRef.current;
                tickReqRef.current = tickReq;
                tickSubRef.current = null;
                ws.send(JSON.stringify({ ticks: activeSymbol, subscribe: 1, req_id: tickReq }));
                pingTimerRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: 1 }));
                }, pingIntervalMs);
            };

            ws.onmessage = (event) => {
                if (!isCurrent()) return;
                let msg: Record<string, any>;
                try {
                    msg = JSON.parse(String(event.data));
                } catch {
                    log("Ignored a malformed message from the server.");
                    return;
                }

                if (msg.msg_type === "tick") {
                    const subId = typeof msg.subscription?.id === "string" ? msg.subscription.id : null;
                    const isScannerTick = typeof msg.req_id === "number" && msg.req_id >= 4_000_000 && msg.req_id < 5_000_000;
                    if (!isScannerTick && msg.req_id !== undefined && msg.req_id !== tickReqRef.current) {
                        if (subId) ws.send(JSON.stringify({ forget: subId }));
                        return;
                    }
                    if (!isScannerTick && subId) tickSubRef.current = subId;
                }

                listenersRef.current.forEach((listener) => {
                    try {
                        listener(msg);
                    } catch {
                        log("A message listener failed.");
                    }
                });

                if (msg.error) {
                    log(`API error${msg.error.code ? ` (${msg.error.code})` : ""}: ${msg.error.message ?? "unknown error"}`);
                    return;
                }

                switch (msg.msg_type) {
                    case "balance": {
                        const amount = Number(msg.balance?.balance);
                        if (Number.isFinite(amount)) {
                            setBalance({ amount, currency: String(msg.balance?.currency ?? "") });
                        }
                        break;
                    }
                    case "tick": {
                        if (msg.req_id !== undefined && msg.req_id !== tickReqRef.current) break;
                        const quote = Number(msg.tick?.quote);
                        if (Number.isFinite(quote)) {
                            const pip = Number(msg.tick?.pip_size);
                            setTick({ quote, pipSize: Number.isInteger(pip) && pip >= 0 ? pip : null });
                        }
                        break;
                    }
                    default:
                        break;
                }
            };

            ws.onerror = () => {
                if (isCurrent()) log("WebSocket error.");
            };

            ws.onclose = (event) => {
                if (!isCurrent()) return;
                clearTimers();
                wsRef.current = null;
                scheduleRetry(`Connection closed (code ${event.code})`);
            };
        },
        [clearTimers, teardownSocket, scheduleRetry, log, pingIntervalMs],
    );

    useEffect(() => {
        openRef.current = open;
    }, [open]);

    const connect = useCallback(() => {
        attemptRef.current = 0;
        void open(false);
    }, [open]);

    const disconnect = useCallback(() => {
        runRef.current++;
        clearTimers();
        teardownSocket();
        attemptRef.current = 0;
        setStatus("disconnected");
        setBalance(null);
        setTick(null);
        log("Disconnected.");
    }, [clearTimers, teardownSocket, log]);

    // Automatically connect on mount if autoConnect is true
    useEffect(() => {
        if (autoConnect) {
            connect();
        }
        return () => {
            runRef.current++;
            clearTimers();
            teardownSocket();
        };
    }, [autoConnect, connect, clearTimers, teardownSocket]);

    return { status, balance, tick, logs, accountType, symbol, connect, disconnect, send, addMessageListener, log, changeSymbol };
}