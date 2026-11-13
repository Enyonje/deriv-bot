"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveSymbols } from "../hooks/useActiveSymbols";
import { useContractQuotes, type DurationUnit, type QuoteSide } from "../hooks/useContractQuotes";
import type { useDerivWebSocket } from "../hooks/useDerivWebSocket";
import { useManualTrade } from "../hooks/useManualTrade";
import { houseMarginPct, movedAgainstBuyer, quoteMetrics, type Quote } from "../strategy/quotes";
import { DEFAULT_SETTINGS } from "../strategy/settings";

type Ws = ReturnType<typeof useDerivWebSocket>;

/** A confirmed purchase is refused if the live price got worse than this since the user reviewed it. */
const MAX_ADVERSE_MOVE_PCT = 1;

const SIDES: {
    side: QuoteSide;
    title: string;
    arrow: string;
    rule: string;
    card: string;
    accent: string;
    button: string;
}[] = [
        {
            side: "CALL",
            title: "Higher",
            arrow: "▲",
            rule: "Wins if the final price is above the entry price.",
            card: "border-emerald-200 bg-emerald-50",
            accent: "text-emerald-700",
            button: "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500",
        },
        {
            side: "PUT",
            title: "Lower",
            arrow: "▼",
            rule: "Wins if the final price is below the entry price.",
            card: "border-red-200 bg-red-50",
            accent: "text-red-700",
            button: "bg-red-600 hover:bg-red-700 focus-visible:ring-red-500",
        },
    ];

const UNIT_LABEL: Record<DurationUnit, string> = { t: "ticks", s: "seconds", m: "minutes" };

const inputClass =
    "p-2 rounded-lg border border-slate-300 text-slate-900 text-sm disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between text-sm">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
        </div>
    );
}

export default function QuoteBoard({
    ws,
    accountType,
    symbol,
    botRunning,
    onManualBusyChange,
}: {
    ws: Ws;
    accountType: "demo" | "real";
    /** The market saved with the account; used until the socket reports the active one. */
    symbol: string;
    botRunning: boolean;
    onManualBusyChange?: (busy: boolean) => void;
}) {
    const currency = ws.balance?.currency ?? null;
    const activeSymbol = ws.symbol ?? symbol;
    const connected = ws.status === "connected";

    const [stakeText, setStakeText] = useState(String(DEFAULT_SETTINGS.stake));
    const [durationText, setDurationText] = useState(String(DEFAULT_SETTINGS.durationTicks));
    const [unit, setUnit] = useState<DurationUnit>("t");

    const stake = Number(stakeText);
    const duration = Number(durationText);
    const maxDuration = unit === "t" ? 10 : 1440;
    const valid =
        stakeText.trim() !== "" && stake > 0 && durationText.trim() !== "" && Number.isInteger(duration) && duration >= 1 && duration <= maxDuration;

    const markets = useActiveSymbols({
        status: ws.status,
        currentSymbol: activeSymbol,
        send: ws.send,
        addMessageListener: ws.addMessageListener,
    });

    const { quotes, errors } = useContractQuotes({
        enabled: connected && valid,
        symbol: activeSymbol,
        currency,
        stake: valid ? stake : 0,
        duration: valid ? duration : 0,
        durationUnit: unit,
        send: ws.send,
        addMessageListener: ws.addMessageListener,
    });

    const manual = useManualTrade({
        status: ws.status,
        send: ws.send,
        addMessageListener: ws.addMessageListener,
        log: ws.log,
    });

    useEffect(() => {
        onManualBusyChange?.(manual.phase !== "idle");
    }, [manual.phase, onManualBusyChange]);

    const quotesRef = useRef(quotes);
    useEffect(() => {
        quotesRef.current = quotes;
    }, [quotes]);

    // A confirmation is only valid for the exact market, stake and duration the user reviewed.
    const paramsKey = `${activeSymbol}|${stake}|${duration}|${unit}`;
    const [confirm, setConfirm] = useState<{ key: string; side: QuoteSide; seen: Quote; notice: string | null } | null>(null);
    const activeConfirm = confirm && confirm.key === paramsKey ? confirm : null;

    const manualLocked = botRunning || manual.phase !== "idle";
    const margin = houseMarginPct(quotes.CALL, quotes.PUT);
    const money = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}${currency ? ` ${currency}` : ""}`);
    const signed = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}${currency ? ` ${currency}` : ""}`);
    const marketName = markets.nameOf(activeSymbol);
    const sideTitle = (side: QuoteSide) => (side === "CALL" ? "Higher" : "Lower");

    function startConfirm(side: QuoteSide) {
        const seen = quotes[side];
        if (!seen?.id) return;
        manual.dismiss();
        setConfirm({ key: paramsKey, side, seen, notice: null });
    }

    function confirmBuy() {
        if (!activeConfirm) return;
        const { side, seen } = activeConfirm;
        const latest = quotesRef.current[side];
        if (!latest?.id) {
            setConfirm({ ...activeConfirm, notice: "The live price is unavailable right now. Try again in a moment." });
            return;
        }
        if (movedAgainstBuyer(seen, latest, MAX_ADVERSE_MOVE_PCT) || latest.askPrice > stake * 1.001) {
            setConfirm({
                ...activeConfirm,
                seen: latest,
                notice: "The price moved while you were reviewing. Check the new terms and confirm again.",
            });
            return;
        }
        if (manual.buy({ proposalId: latest.id, side, symbol: activeSymbol, stake })) setConfirm(null);
    }

    function body(side: QuoteSide, quote: Quote | null) {
        if (!connected) return <p className="text-sm text-slate-500">Connect to Deriv to see live prices.</p>;
        if (!valid) return <p className="text-sm text-slate-500">Enter a stake above 0 and a valid duration.</p>;
        if (errors[side]) return <p role="alert" className="text-sm text-red-700">{errors[side]}</p>;
        if (!quote) return <p className="text-sm text-slate-500" role="status">Loading live price…</p>;

        const m = quoteMetrics(quote);
        return (
            <dl className="space-y-1">
                <Row label="Payout if you win" value={money(quote.payout)} />
                <Row label="Profit if you win" value={m.profit === null ? "—" : `+${money(m.profit)}`} />
                <Row label="Return on stake" value={m.returnPct === null ? "—" : `${m.returnPct.toFixed(1)}%`} />
                <Row label="Cost to enter" value={money(quote.askPrice)} />
                <Row label="Price implies" value={m.impliedProbPct === null ? "—" : `${m.impliedProbPct.toFixed(1)}% chance`} />
            </dl>
        );
    }

    return (
        <div className="w-full max-w-3xl bg-white p-6 rounded-2xl shadow-lg border border-slate-200">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Trade</h2>
                    <p className="text-xs text-slate-500">
                        {marketName}
                        {ws.tick ? ` · now ${ws.tick.pipSize !== null ? ws.tick.quote.toFixed(ws.tick.pipSize) : ws.tick.quote}` : ""}
                    </p>
                </div>

                <div className="flex flex-wrap gap-3">
                    <div>
                        <label htmlFor="qb-market" className="block text-xs font-medium text-slate-700 mb-1">Market</label>
                        <select
                            id="qb-market"
                            value={activeSymbol}
                            disabled={!connected || manualLocked}
                            onChange={(e) => ws.changeSymbol(e.target.value)}
                            className={`${inputClass} max-w-[14rem]`}
                        >
                            {markets.groups.map((g) => (
                                <optgroup key={g.market} label={g.label}>
                                    {g.items.map((s) => (
                                        <option key={s.symbol} value={s.symbol}>
                                            {s.name}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="qb-stake" className="block text-xs font-medium text-slate-700 mb-1">Stake</label>
                        <input id="qb-stake" type="number" inputMode="decimal" step="0.01" min="0" value={stakeText} onChange={(e) => setStakeText(e.target.value)} className={`${inputClass} w-24`} />
                    </div>
                    <div>
                        <label htmlFor="qb-duration" className="block text-xs font-medium text-slate-700 mb-1">Duration</label>
                        <div className="flex gap-1">
                            <input id="qb-duration" type="number" inputMode="numeric" step="1" min="1" max={maxDuration} value={durationText} onChange={(e) => setDurationText(e.target.value)} className={`${inputClass} w-20`} />
                            <select aria-label="Duration unit" value={unit} onChange={(e) => setUnit(e.target.value as DurationUnit)} className={inputClass}>
                                {(Object.keys(UNIT_LABEL) as DurationUnit[]).map((u) => (
                                    <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {(botRunning || manual.phase !== "idle") && (
                <p className="mb-3 text-xs text-slate-600" role="status">
                    {botRunning
                        ? "Manual trading and market changes are paused while the bot is running."
                        : "Market changes are paused until your trade settles."}
                </p>
            )}
            {markets.error && <p className="mb-3 text-xs text-amber-700">Could not load the market list: {markets.error}</p>}
            <p className="mb-3 text-xs text-slate-500">
                Some markets, such as commodities, may not offer tick durations. If a price won&apos;t load, try seconds or minutes.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {SIDES.map((s) => {
                    const quote = quotes[s.side];
                    return (
                        <section key={s.side} aria-label={`${s.title} price`} className={`rounded-xl border p-4 ${s.card}`}>
                            <h3 className={`text-lg font-bold ${s.accent}`}>
                                <span aria-hidden="true">{s.arrow} </span>
                                {s.title}
                            </h3>
                            <p className="mb-3 text-xs text-slate-600">{s.rule}</p>
                            {body(s.side, quote)}
                            <button
                                type="button"
                                onClick={() => startConfirm(s.side)}
                                disabled={!connected || !valid || !quote?.id || manualLocked}
                                className={`mt-4 w-full rounded-lg p-2.5 text-sm font-semibold text-white transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${s.button}`}
                            >
                                Buy {s.title}
                            </button>
                        </section>
                    );
                })}
            </div>

            {activeConfirm && (
                <div role="alertdialog" aria-label="Confirm purchase" className="mt-4 rounded-xl border-2 border-slate-800 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                        Buy {sideTitle(activeConfirm.side)} on {marketName}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                        Stake {money(stake)} for {duration} {UNIT_LABEL[unit]}. Pays {money(activeConfirm.seen.payout)} if you win (profit{" "}
                        {signed(quoteMetrics(activeConfirm.seen).profit)}). You lose the stake if you don&apos;t.
                    </p>
                    {accountType === "real" && (
                        <p className="mt-1 text-sm font-semibold text-red-700">This is a REAL-MONEY account.</p>
                    )}
                    {activeConfirm.notice && (
                        <p role="alert" className="mt-2 text-sm text-amber-800">{activeConfirm.notice}</p>
                    )}
                    <div className="mt-3 flex gap-3">
                        <button
                            type="button"
                            onClick={confirmBuy}
                            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                        >
                            Confirm purchase
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirm(null)}
                            className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {manual.phase === "buying" && (
                <p className="mt-4 text-sm text-slate-700" role="status">Placing your trade…</p>
            )}

            {manual.open && (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4" role="status">
                    <p className="text-sm font-semibold text-blue-900">
                        Open trade: {sideTitle(manual.open.side)} on {markets.nameOf(manual.open.symbol)}
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
                        <div>
                            <dt className="text-xs text-slate-500">Stake</dt>
                            <dd className="font-semibold tabular-nums text-slate-900">{money(manual.open.stake)}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-slate-500">Current result</dt>
                            <dd className={`font-semibold tabular-nums ${manual.open.profit !== null && manual.open.profit < 0 ? "text-red-600" : "text-slate-900"}`}>
                                {signed(manual.open.profit)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-slate-500">Latest price</dt>
                            <dd className="font-semibold tabular-nums text-slate-900">{manual.open.spot ?? "—"}</dd>
                        </div>
                    </dl>
                    <p className="mt-2 text-xs text-slate-600">It settles automatically when the duration ends.</p>
                </div>
            )}

            {manual.error && (
                <div role="alert" className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <span>{manual.error}</span>
                    <button type="button" onClick={manual.dismiss} className="shrink-0 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded">
                        {manual.phase === "unverified" ? "I've checked" : "Dismiss"}
                    </button>
                </div>
            )}

            {manual.history.length > 0 && (
                <section className="mt-4" aria-labelledby="manual-history">
                    <h3 id="manual-history" className="text-sm font-semibold text-slate-700 mb-2">Your recent trades</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500">
                                <tr>
                                    <th className="py-1 pr-3">Time</th>
                                    <th className="py-1 pr-3">Market</th>
                                    <th className="py-1 pr-3">Side</th>
                                    <th className="py-1 pr-3">Stake</th>
                                    <th className="py-1">Result</th>
                                </tr>
                            </thead>
                            <tbody>
                                {manual.history.slice(0, 5).map((t) => (
                                    <tr key={t.id} className="border-t border-slate-100 text-slate-800">
                                        <td className="py-1 pr-3 tabular-nums">{new Date(t.openedAt).toLocaleTimeString()}</td>
                                        <td className="py-1 pr-3">{markets.nameOf(t.symbol)}</td>
                                        <td className="py-1 pr-3">{sideTitle(t.side)}</td>
                                        <td className="py-1 pr-3 tabular-nums">{t.stake.toFixed(2)}</td>
                                        <td className={`py-1 tabular-nums ${t.profit < 0 ? "text-red-600" : ""}`}>{signed(t.profit)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            <p className="mt-4 text-xs text-slate-500">
                {margin !== null
                    ? `Both sides together imply ${(100 + margin).toFixed(1)}%, so Deriv's built-in margin is about ${margin.toFixed(1)}%. You pay it whichever side you pick. `
                    : ""}
                Prices are live and not trading advice. Trading can lose your entire stake.
            </p>
        </div>
    );
}