"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_SNAPSHOT, TradingEngine, type BotEngine, type BotSnapshot } from "../strategy/engine";
import { evidenceKey, loadEvidence, saveEvidence } from "../lib/evidenceStore";
import { ScanEngine } from "../strategy/scanEngine";
import { validateScanSettings, validateSettings, type BotSettings, type ScanSettings } from "../strategy/settings";
import type { ShadowState } from "../strategy/shadow";
import type { ConnectionStatus } from "./useDerivWebSocket";

interface Params {
    status: ConnectionStatus;
    currency: string | null;
    symbol: string;
    send: (payload: Record<string, unknown>) => boolean;
    addMessageListener: (listener: (msg: Record<string, any>) => void) => () => void;
    log: (message: string) => void;
}

/** Turns on auto-select: the bot watches `symbols` and picks the cheapest market for each trade. */
export interface AutoMode {
    scan: ScanSettings;
    symbols: string[];
}

export function useTradingBot({ status, currency, symbol, send, addMessageListener, log }: Params) {
    const [snapshot, setSnapshot] = useState<BotSnapshot>(EMPTY_SNAPSHOT);
    const engineRef = useRef<BotEngine | null>(null);
    const prevStatus = useRef<ConnectionStatus>(status);

    // Feed every socket message to the engine.
    useEffect(() => addMessageListener((msg) => engineRef.current?.handleMessage(msg)), [addMessageListener]);

    // Tell the engine about connection drops and recoveries.
    useEffect(() => {
        const was = prevStatus.current;
        prevStatus.current = status;
        const engine = engineRef.current;
        if (!engine) return;
        if (was === "connected" && status !== "connected") engine.onConnectionLost();
        if (was !== "connected" && status === "connected") engine.onConnectionRestored();
    }, [status]);

    /** Returns a list of problems; empty means the bot started. */
    const start = useCallback(
        (settings: BotSettings, auto?: AutoMode): string[] => {
            const errors = [...validateSettings(settings), ...(auto ? validateScanSettings(auto.scan) : [])];
            if (auto && auto.symbols.length === 0) errors.push("No tradable markets were found in that category.");
            if (errors.length) return errors;
            if (status !== "connected") return ["Connect to Deriv first."];
            if (!currency) return ["Waiting for the account currency from Deriv. Try again in a moment."];
            if (engineRef.current?.isActive) return ["The bot is already running."];

            const base = { settings, currency, send, log, onChange: setSnapshot };
            let engine: BotEngine;
            if (auto) {
                // Adaptive mode keeps its paper-trading record in this browser, per strategy settings and duration.
                const key = evidenceKey(settings, auto.scan);
                engine = new ScanEngine({
                    ...base,
                    scan: auto.scan,
                    symbols: auto.symbols,
                    ...(auto.scan.adaptive
                        ? { shadowState: loadEvidence(key), onShadowSave: (state: ShadowState) => saveEvidence(key, state) }
                        : {}),
                });
            } else {
                engine = new TradingEngine({ ...base, symbol });
            }
            engineRef.current = engine;
            setSnapshot(EMPTY_SNAPSHOT);
            engine.start();
            return [];
        },
        [status, currency, symbol, send, log],
    );

    const stop = useCallback(() => engineRef.current?.stop(), []);

    return { snapshot, start, stop };
}