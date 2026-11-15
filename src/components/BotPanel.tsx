"use client";

import { useEffect, useState } from "react";
import { useActiveSymbols } from "../hooks/useActiveSymbols";
import type { useDerivWebSocket } from "../hooks/useDerivWebSocket";
import { useTradingBot, type AutoMode } from "../hooks/useTradingBot";
import type { Phase } from "../strategy/engine";
import { clearEvidence, evidenceKey } from "../lib/evidenceStore";
import { breakevenWinRatePct, wilsonLowerPct } from "../strategy/scanner";
import {
    DEFAULT_SCAN_SETTINGS,
    DEFAULT_SETTINGS,
    type BotSettings,
    type DurationUnit,
    type ScanSettings,
} from "../strategy/settings";

type Ws = ReturnType<typeof useDerivWebSocket>;

type ScanNumberKey = Exclude<
    keyof ScanSettings,
    "universeMarket" | "durationUnit" | "adaptive" | "requireEvidence"
>;

interface Field<K extends string> {
    key: K;
    label: string;
    step: string;
}

const GROUPS: {
    title: string;
    fields: Field<Exclude<keyof BotSettings, "useDynamicStaking">>[];
}[] = [
        {
            title: "Trade & Execution",
            fields: [
                { key: "stake", label: "Stake per trade", step: "0.01" },
                { key: "durationTicks", label: "Duration (ticks, single market)", step: "1" },
                { key: "maxSlippagePct", label: "Maximum slippage (%)", step: "0.01" },
            ],
        },
        {
            title: "Strategy: EMA crossover + RSI filter",
            fields: [
                { key: "fastPeriod", label: "Fast EMA", step: "1" },
                { key: "slowPeriod", label: "Slow EMA", step: "1" },
                { key: "rsiPeriod", label: "RSI period", step: "1" },
                { key: "rsiOverbought", label: "RSI overbought", step: "1" },
                { key: "rsiOversold", label: "RSI oversold", step: "1" },
            ],
        },
        {
            title: "Risk Limits",
            fields: [
                { key: "maxSessionLoss", label: "Max session loss", step: "0.01" },
                { key: "sessionTakeProfit", label: "Session take-profit", step: "0.01" },
                { key: "maxConsecutiveLosses", label: "Max consecutive losses", step: "1" },
                { key: "maxTrades", label: "Max trades", step: "1" },
                { key: "cooldownSeconds", label: "Cooldown (seconds)", step: "1" },
            ],
        },
    ];

const SCAN_FIELDS: Field<ScanNumberKey>[] = [
    { key: "maxSymbols", label: "Markets to watch", step: "1" },
    { key: "duration", label: "Contract duration", step: "1" },
    { key: "maxMarginPct", label: "Max Deriv margin (%)", step: "0.1" },
    { key: "collectSeconds", label: "Comparison window (s)", step: "1" },
    { key: "signalMaxAgeSeconds", label: "Signal max age (s)", step: "1" },
    { key: "targetWinRatePct", label: "Target win rate (%)", step: "1" },
    { key: "minSampleTrades", label: "Check target after (trades)", step: "1" },
];

const ADAPTIVE_FIELDS: Field<ScanNumberKey>[] = [
    { key: "minShadowTrades", label: "Paper trades needed", step: "1" },
    { key: "shadowWindow", label: "Paper-trade window", step: "1" },
    { key: "confidencePct", label: "Confidence (%)", step: "0.1" },
    { key: "breakevenPct", label: "Assumed break-even (%)", step: "0.1" },
];

const PHASE: Record<Phase, { label: string; className: string }> = {
    stopped: { label: "Stopped", className: "bg-slate-200 text-slate-700" },
    warming_up: { label: "Warming up", className: "bg-amber-100 text-amber-800" },
    idle: { label: "Watching for signals", className: "bg-emerald-100 text-emerald-800" },
    collecting: { label: "Comparing markets", className: "bg-blue-100 text-blue-800" },
    quoting: { label: "Getting prices", className: "bg-blue-100 text-blue-800" },
    proposing: { label: "Requesting price", className: "bg-blue-100 text-blue-800" },
    buying: { label: "Placing trade", className: "bg-blue-100 text-blue-800" },
    open: { label: "Trade open", className: "bg-blue-100 text-blue-800" },
    cooldown: { label: "Cooling down", className: "bg-amber-100 text-amber-800" },
    halted: { label: "Halted", className: "bg-red-100 text-red-800" },
};

const inputClass =
    "w-full p-2 rounded-lg border border-slate-300 text-slate-900 text-sm disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

const toStrings = <T extends object>(o: T) =>
    Object.fromEntries(
        Object.entries(o).map(([k, v]) => [k, String(v)])
    ) as Record<keyof T, string>;

export default function BotPanel({
    ws,
    accountType,
    symbol,
    blocked = false,
    onRunningChange,
}: {
    ws: Ws;
    accountType: "demo" | "real";
    symbol: string;
    blocked?: boolean;
    onRunningChange?: (running: boolean) => void;
}) {
    const currency = ws.balance?.currency || null;

    const { snapshot, start, stop } = useTradingBot({
        status: ws.status,
        currency,
        symbol,
        send: ws.send,
        addMessageListener: ws.addMessageListener,
        log: ws.log,
    });

    const markets = useActiveSymbols({
        status: ws.status,
        currentSymbol: symbol,
        send: ws.send,
        addMessageListener: ws.addMessageListener,
    });

    const [values, setValues] = useState(() => toStrings(DEFAULT_SETTINGS));

    // Boolean settings must remain booleans, not strings or numbers.
    const [scanValues, setScanValues] = useState(() => toStrings(DEFAULT_SCAN_SETTINGS));
    const [auto, setAuto] = useState(false);
    const [unit, setUnit] = useState<DurationUnit>(DEFAULT_SCAN_SETTINGS.durationUnit);
    const [adaptiveOn, setAdaptiveOn] = useState(DEFAULT_SCAN_SETTINGS.adaptive);
    const [evidenceRequired, setEvidenceRequired] = useState(DEFAULT_SCAN_SETTINGS.requireEvidence);

    const [notice, setNotice] = useState<string | null>(null);
    const [universe, setUniverse] = useState<string | null>(null);
    const [errors, setErrors] = useState<string[]>([]);
    const [realConfirmed, setRealConfirmed] = useState(false);

    const universeGroups = markets.groups.filter((g) => g.market !== "current");

    const universeKey =
        universe ??
        universeGroups.find((g) => g.market === DEFAULT_SCAN_SETTINGS.universeMarket)?.market ??
        universeGroups[0]?.market ??
        "";

    const {
        phase,
        stats,
        indicators,
        trades,
        haltReason,
        markets: rows,
        decision,
        strategies,
        evidenceNote,
    } = snapshot;

    const running = phase !== "stopped" && phase !== "halted";
    const stopping = running && phase === "open";

    const canStart =
        ws.status === "connected" &&
        !!currency &&
        !running &&
        !blocked &&
        (accountType === "demo" || realConfirmed);

    useEffect(() => {
        onRunningChange?.(running);
    }, [running, onRunningChange]);

    // Parse numeric settings and preserve boolean settings.
    const parseSettings = (): BotSettings => ({
        ...Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
                key,
                value.trim() === "" ? Number.NaN : Number(value),
            ])
        ),

        useDynamicStaking: false,
    }) as BotSettings;

    const parseScan = (): ScanSettings => {
        const nums = Object.fromEntries(
            [...SCAN_FIELDS, ...ADAPTIVE_FIELDS].map((field) => [
                field.key,
                scanValues[field.key].trim() === ""
                    ? Number.NaN
                    : Number(scanValues[field.key]),
            ])
        ) as Record<ScanNumberKey, number>;

        return {
            ...nums,
            universeMarket: universeKey,
            durationUnit: unit,
            adaptive: adaptiveOn,
            requireEvidence: accountType === "real" ? true : evidenceRequired,
        };
    };

    function handleStart() {
        setNotice(null);
        setErrors([]);

        const parsed = parseSettings();

        let mode: AutoMode | undefined;

        if (auto) {
            const scan = parseScan();

            const group = universeGroups.find(
                (g) => g.market === universeKey
            );

            const symbols = (group?.items ?? [])
                .slice(
                    0,
                    Number.isFinite(scan.maxSymbols) ? scan.maxSymbols : 0
                )
                .map((s) => s.symbol);

            mode = {
                scan,
                symbols,
            };
        }

        setErrors(start(parsed, mode));
    }

    function handleResetEvidence() {
        if (!auto) {
            setNotice("Enable auto-select before resetting scanning evidence.");
            return;
        }

        const settings = parseSettings();
        const scan = parseScan();

        clearEvidence(evidenceKey(settings, scan));

        setNotice("Saved paper-trading evidence for these settings was cleared.");
    }

    const money = (n: number) =>
        `${n >= 0 ? "+" : ""}${n.toFixed(2)}${currency ? ` ${currency}` : ""}`;

    const num = (n: number | null, d = 3) =>
        n === null ? "—" : n.toFixed(d);

    const pct = (n: number | null) =>
        n === null ? "—" : `${n.toFixed(1)}%`;

    const breakeven = breakevenWinRatePct(trades);
    const targetPct = auto ? Number(scanValues.targetWinRatePct) : null;

    return (
        <div className="w-full max-w-3xl bg-white p-6 rounded-2xl shadow-lg border border-slate-200">

            <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-slate-800">
                    Strategy
                </h2>

                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PHASE[phase].className}`}>
                    {PHASE[phase].label}
                </span>
            </div>

            <p className="text-xs text-slate-500 mb-4">
                Demonstrates automated execution and risk controls.
                Markets are random or highly efficient, so no setting can
                promise a win rate. Results here say nothing about future profitability.
            </p>

            {haltReason && (
                <p role="alert" className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    Bot halted: {haltReason}
                </p>
            )}

            <div className="space-y-4">

                <fieldset disabled={running} className="rounded-lg border border-slate-200 p-3">

                    <legend className="px-1 text-xs font-semibold text-slate-600">
                        Market selection
                    </legend>

                    <label className="flex items-start gap-2 text-sm text-slate-800">

                        <input
                            type="checkbox"
                            checked={auto}
                            onChange={(e) => setAuto(e.target.checked)}
                            className="mt-1"
                        />

                        <span>
                            Auto-select: watch several markets and trade on the cheapest one each time.

                            <span className="block text-xs text-slate-500">
                                It compares Deriv's price on each market. It cannot predict which way a market will move.
                            </span>
                        </span>

                    </label>

                    {auto && (
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">

                            <div>
                                <label htmlFor="scan-universe" className="block text-xs font-medium text-slate-700 mb-1">
                                    Market category
                                </label>

                                <select
                                    id="scan-universe"
                                    value={universeKey}
                                    onChange={(e) => setUniverse(e.target.value)}
                                    className={inputClass}
                                >
                                    {universeGroups.length === 0 && (
                                        <option value="">Connect to load markets</option>
                                    )}

                                    {universeGroups.map((g) => (
                                        <option key={g.market} value={g.market}>
                                            {g.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label htmlFor="scan-unit" className="block text-xs font-medium text-slate-700 mb-1">
                                    Duration unit
                                </label>

                                <select
                                    id="scan-unit"
                                    value={unit}
                                    onChange={(e) => setUnit(e.target.value as DurationUnit)}
                                    className={inputClass}
                                >
                                    <option value="t">ticks</option>
                                    <option value="s">seconds</option>
                                    <option value="m">minutes</option>
                                </select>
                            </div>

                            {SCAN_FIELDS.map((f) => (
                                <div key={f.key}>
                                    <label htmlFor={`scan-${f.key}`} className="block text-xs font-medium text-slate-700 mb-1">
                                        {f.label}
                                    </label>

                                    <input
                                        id={`scan-${f.key}`}
                                        type="number"
                                        inputMode="decimal"
                                        step={f.step}
                                        value={scanValues[f.key]}
                                        onChange={(e) =>
                                            setScanValues((v) => ({
                                                ...v,
                                                [f.key]: e.target.value,
                                            }))
                                        }
                                        className={inputClass}
                                    />
                                </div>
                            ))}

                        </div>
                    )}

                    {auto && (
                        <div className="mt-4 border-t border-slate-200 pt-3">

                            <label className="flex items-start gap-2 text-sm text-slate-800">

                                <input
                                    type="checkbox"
                                    checked={adaptiveOn}
                                    onChange={(e) => setAdaptiveOn(e.target.checked)}
                                    className="mt-1"
                                />

                                <span>
                                    Adaptive: run several strategies on every market as paper trades, and only trade one that has proven itself.

                                    <span className="block text-xs text-slate-500">
                                        EMA crossover, RSI reversion, Bollinger reversion and range breakout are all tested at once.
                                        Paper trades cost nothing and are saved in this browser.
                                    </span>
                                </span>

                            </label>

                            {adaptiveOn && (
                                <>

                                    <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">

                                        <input
                                            type="checkbox"
                                            checked={accountType === "real" ? true : evidenceRequired}
                                            disabled={accountType === "real"}
                                            onChange={(e) => setEvidenceRequired(e.target.checked)}
                                            className="mt-1"
                                        />

                                        <span>
                                            Require statistical evidence before trading
                                            {accountType === "real" ? " (always on for real accounts)" : ""}.

                                            <span className="block text-xs text-slate-500">
                                                Untick on a demo account to let the bot trade the best-ranked strategy once it has enough paper trades, even without proof.
                                            </span>
                                        </span>

                                    </label>

                                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">

                                        {ADAPTIVE_FIELDS.map((f) => (
                                            <div key={f.key}>

                                                <label htmlFor={`scan-${f.key}`} className="block text-xs font-medium text-slate-700 mb-1">
                                                    {f.label}
                                                </label>

                                                <input
                                                    id={`scan-${f.key}`}
                                                    type="number"
                                                    inputMode="decimal"
                                                    step={f.step}
                                                    value={scanValues[f.key]}
                                                    onChange={(e) =>
                                                        setScanValues((v) => ({
                                                            ...v,
                                                            [f.key]: e.target.value,
                                                        }))
                                                    }
                                                    className={inputClass}
                                                />

                                            </div>
                                        ))}

                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleResetEvidence}
                                        className="mt-3 text-xs text-slate-600 underline"
                                    >
                                        Reset saved evidence for these settings
                                    </button>

                                </>
                            )}

                        </div>
                    )}

                </fieldset>

                {GROUPS.map((g) => (

                    <fieldset
                        key={g.title}
                        disabled={running}
                        className="rounded-lg border border-slate-200 p-3"
                    >

                        <legend className="px-1 text-xs font-semibold text-slate-600">
                            {g.title}
                        </legend>

                        {g.title === "Trade & Execution" && (
                            <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                                Fixed stake sizing is active. Dynamic Kelly sizing remains disabled until a payout-adjusted model is independently validated.
                            </p>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

                            {g.fields.map((f) => (

                                <div key={f.key}>

                                    <label
                                        htmlFor={`bot-${f.key}`}
                                        className="block text-xs font-medium text-slate-700 mb-1"
                                    >
                                        {f.label}
                                    </label>

                                    <input
                                        id={`bot-${f.key}`}
                                        type="number"
                                        inputMode="decimal"
                                        step={f.step}
                                        value={values[f.key]}
                                        onChange={(e) =>
                                            setValues((v) => ({
                                                ...v,
                                                [f.key]: e.target.value,
                                            }))
                                        }
                                        className={inputClass}
                                    />

                                </div>

                            ))}

                        </div>

                    </fieldset>

                ))}

            </div>

            {accountType === "real" && (

                <label className="mt-4 flex items-start gap-2 text-sm text-red-700">

                    <input
                        type="checkbox"
                        checked={realConfirmed}
                        onChange={(e) => setRealConfirmed(e.target.checked)}
                        className="mt-1"
                    />

                    <span>
                        I understand this account uses real money and the bot can lose it.
                        I have tested these settings on a demo account first.
                    </span>

                </label>

            )}

            {notice && (
                <p role="status" className="mt-4 text-xs text-slate-600">
                    {notice}
                </p>
            )}

            {errors.length > 0 && (

                <ul role="alert" className="mt-4 list-disc pl-5 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">

                    {errors.map((e) => (
                        <li key={e}>{e}</li>
                    ))}

                </ul>

            )}

            <div className="mt-4 flex gap-3">

                <button
                    type="button"
                    onClick={handleStart}
                    disabled={!canStart}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold p-3 rounded-lg transition-colors"
                >
                    {ws.status !== "connected"
                        ? "Connect to Deriv first"
                        : blocked
                            ? "Manual trade in progress"
                            : "Start bot"}
                </button>

                <button
                    type="button"
                    onClick={stop}
                    disabled={!running}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg transition-colors"
                >
                    {stopping ? "Stop after trade" : "Stop"}
                </button>

            </div>

            <p className="mt-2 text-xs text-slate-500">
                The bot runs in this browser tab. Keep it open while trading.
                A trade already placed always settles on Deriv.
                Single-market mode uses tick contracts, which some markets don't offer;
                it halts after repeated rejections.
            </p>

            <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">

                <div className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">Session P&amp;L</dt>
                    <dd className={`font-semibold tabular-nums ${stats.pnl < 0 ? "text-red-600" : "text-slate-900"}`}>
                        {money(stats.pnl)}
                    </dd>
                </div>

                <div className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">Trades (W / L)</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                        {stats.trades} ({stats.wins} / {stats.losses})
                    </dd>
                </div>

                <div className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">Win rate</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                        {stats.winRate === null
                            ? "—"
                            : `${(stats.winRate * 100).toFixed(0)}%`}
                    </dd>
                </div>

                <div className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">Loss streak</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                        {stats.consecutiveLosses}
                    </dd>
                </div>

            </dl>

            {stats.trades > 0 && (

                <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">

                    <p>
                        Break-even win rate: <strong>{pct(breakeven)}</strong>

                        {targetPct !== null && Number.isFinite(targetPct) && (
                            <>
                                {" · "}Your target: <strong>{targetPct}%</strong>
                            </>
                        )}

                        {" · "}Cautious estimate of true win rate:{" "}
                        <strong>{pct(wilsonLowerPct(stats.wins, stats.trades))}</strong>
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                        A win rate only makes money when it stays above break-even.
                        Small samples are unreliable: the cautious estimate is a 95% lower bound.
                    </p>

                </div>

            )}

            {rows && rows.length > 0 && (

                <section className="mt-6">

                    <h3 className="text-sm font-semibold text-slate-700 mb-2">
                        Markets being watched
                    </h3>

                    {decision && (
                        <p className="mb-2 text-xs text-slate-600">
                            Last decision: {decision}
                        </p>
                    )}

                    <div className="overflow-x-auto">

                        <table className="w-full text-sm text-left">

                            <thead className="text-xs text-slate-500">
                                <tr>
                                    <th className="py-1 pr-3">Market</th>
                                    <th className="py-1 pr-3">Price</th>
                                    <th className="py-1 pr-3">Signal</th>
                                    <th className="py-1 pr-3">Trades (W)</th>
                                    <th className="py-1">Status</th>
                                </tr>
                            </thead>

                            <tbody>

                                {rows.map((r) => (

                                    <tr key={r.symbol} className="border-t border-slate-100 text-slate-800">

                                        <td className="py-1 pr-3">
                                            {markets.nameOf(r.symbol)}
                                        </td>

                                        <td className="py-1 pr-3 tabular-nums">
                                            {r.lastPrice ?? "—"}
                                        </td>

                                        <td className="py-1 pr-3">
                                            {r.signal === "CALL"
                                                ? "Higher"
                                                : r.signal === "PUT"
                                                    ? "Lower"
                                                    : "—"}
                                        </td>

                                        <td className="py-1 pr-3 tabular-nums">
                                            {r.trades} ({r.wins})
                                        </td>

                                        <td className="py-1 text-xs text-slate-500">
                                            {r.excluded
                                                ? `Dropped: ${r.excluded}`
                                                : "Watching"}
                                        </td>

                                    </tr>

                                ))}

                            </tbody>

                        </table>

                    </div>

                </section>

            )}

            {strategies && strategies.length > 0 && (

                <section className="mt-6">

                    <h3 className="text-sm font-semibold text-slate-700 mb-1">
                        Strategy paper results
                    </h3>

                    {evidenceNote && (
                        <p className="mb-2 text-xs text-slate-600">
                            {evidenceNote}
                        </p>
                    )}

                    <div className="overflow-x-auto">

                        <table className="w-full text-sm text-left">

                            <thead className="text-xs text-slate-500">
                                <tr>
                                    <th className="py-1 pr-3">Market</th>
                                    <th className="py-1 pr-3">Strategy</th>
                                    <th className="py-1 pr-3">Paper trades</th>
                                    <th className="py-1 pr-3">Win rate</th>
                                    <th className="py-1 pr-3">Cautious</th>
                                    <th className="py-1">Status</th>
                                </tr>
                            </thead>

                            <tbody>

                                {strategies.map((r) => (

                                    <tr
                                        key={`${r.symbol}|${r.strategyId}`}
                                        className="border-t border-slate-100 text-slate-800"
                                    >

                                        <td className="py-1 pr-3">
                                            {markets.nameOf(r.symbol)}
                                        </td>

                                        <td className="py-1 pr-3">
                                            {r.label}
                                        </td>

                                        <td className="py-1 pr-3 tabular-nums">
                                            {r.n}
                                        </td>

                                        <td className="py-1 pr-3 tabular-nums">
                                            {pct(r.winRatePct)}
                                        </td>

                                        <td className="py-1 pr-3 tabular-nums">
                                            {pct(r.lowerPct)}
                                        </td>

                                        <td className={`py-1 text-xs ${r.status === "qualified"
                                            ? "text-emerald-700 font-semibold"
                                            : "text-slate-500"}`}
                                        >
                                            {r.status === "qualified"
                                                ? "Qualified"
                                                : r.status === "collecting"
                                                    ? `Collecting evidence (${r.n}/${scanValues.minShadowTrades})`
                                                    : "Below break-even"}
                                        </td>

                                    </tr>

                                ))}

                            </tbody>

                        </table>

                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                        Paper trades enter on the signal tick; real contracts start on the next tick,
                        so live results will differ a little.
                    </p>

                </section>

            )}

            {!rows && (

                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">

                    <div className="rounded-lg bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">Fast EMA</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                            {num(indicators.fast)}
                        </dd>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">Slow EMA</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                            {num(indicators.slow)}
                        </dd>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">RSI</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                            {num(indicators.rsi, 1)}
                        </dd>
                    </div>

                </dl>

            )}

            <section className="mt-6">

                <h3 className="text-sm font-semibold text-slate-700 mb-2">
                    Trades this session
                </h3>

                {trades.length === 0 ? (

                    <p className="text-sm text-slate-500">
                        No trades yet.
                    </p>

                ) : (

                    <div className="overflow-x-auto">

                        <table className="w-full text-sm text-left">

                            <thead className="text-xs text-slate-500">
                                <tr>
                                    <th className="py-1 pr-3">Time</th>
                                    <th className="py-1 pr-3">Market</th>
                                    <th className="py-1 pr-3">Side</th>
                                    <th className="py-1 pr-3">Stake</th>
                                    <th className="py-1 pr-3">Result</th>
                                    <th className="py-1 pr-3">Profit</th>
                                    <th className="py-1">Why</th>
                                </tr>
                            </thead>

                            <tbody>

                                {[...trades].reverse().map((t) => (

                                    <tr key={t.id} className="border-t border-slate-100 text-slate-800">

                                        <td className="py-1 pr-3 tabular-nums">
                                            {new Date(t.openedAt).toLocaleTimeString()}
                                        </td>

                                        <td className="py-1 pr-3">
                                            {markets.nameOf(t.symbol)}
                                        </td>

                                        <td className="py-1 pr-3">
                                            {t.side === "CALL" ? "Higher" : "Lower"}
                                        </td>

                                        <td className="py-1 pr-3 tabular-nums">
                                            {t.stake.toFixed(2)}
                                        </td>

                                        <td className="py-1 pr-3">
                                            {t.result}
                                        </td>

                                        <td className={`py-1 pr-3 tabular-nums ${t.profit !== null && t.profit < 0
                                            ? "text-red-600"
                                            : ""}`}
                                        >
                                            {t.profit === null ? "—" : money(t.profit)}
                                        </td>

                                        <td className="py-1 text-xs text-slate-500">
                                            {t.reason}
                                        </td>

                                    </tr>

                                ))}

                            </tbody>

                        </table>

                    </div>

                )}

            </section>

        </div>
    );
}