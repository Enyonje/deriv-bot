import type { BotEngine, BotSnapshot, MarketRow, Phase, StrategyRow, TradeRecord } from "./engine";
import { parseQuote, isHouseMarginAcceptable } from "./quotes";
import { RiskManager } from "./risk";
import { MarketTracker, pickBest, pickBestEdge, winRateGuard, zOneSided, type Candidate } from "./scanner";
import type { BotSettings, ScanSettings } from "./settings";
import { ShadowBook, type ShadowState } from "./shadow";
import type { Side } from "./strategy";
import { ALL_STRATEGY_IDS, PoolTracker, STRATEGY_LABELS, type StrategyId } from "./strategies";

export interface ScanDeps {
    settings: BotSettings;
    scan: ScanSettings;
    /** Markets to watch, in display order. */
    symbols: string[];
    currency: string;
    send: (request: Record<string, unknown>) => boolean;
    onChange: (snapshot: BotSnapshot) => void;
    log: (message: string) => void;
    now?: () => number;
    /** Adaptive mode: previously saved paper-trading results for the same settings. */
    shadowState?: ShadowState | null;
    /** Adaptive mode: called now and then with the results to persist. */
    onShadowSave?: (state: ShadowState) => void;
    /** Optional telemetry hook for high-end SaaS observability */
    onTelemetry?: (event: string, meta: Record<string, any>) => void;
}

export const SCAN_TICK_REQ_BASE = 4_000_000;
const REQ_BASE = 5_000_000;

const QUOTE_TIMEOUT_MS = 8_000; // Tighter timeout for institutional high-frequency scanning
const BUY_TIMEOUT_MS = 12_000;
const MAX_CANDIDATES = 3;
const MAX_API_ERRORS = 3;
const EXCLUDE_AFTER_ERRORS = 2;
const STRICT_PRICE_TOLERANCE = 1.0005; // Institutional slippage guard
const MAX_TRADES_KEPT = 100;
const SHADOW_SAVE_EVERY = 10;
const EVIDENCE_NOTE_EVERY_MS = 60_000;
const MAX_STRATEGY_ROWS = 12;

interface SignalInfo {
    symbol: string;
    strategyId: StrategyId | "ema_rsi";
    side: Side;
    strength: number;
    reason: string;
    at: number;
}

interface EligibleSignal {
    info: SignalInfo;
    lower?: number;
    n?: number;
}

const keyOf = (symbol: string, id: string) => `${symbol}|${id}`;

/**
 * Institutional-Grade Multi-Market Scanning Engine.
 * Features Bonferroni-corrected adaptive strategy ensembles, house margin filtering,
 * and high-frequency execution safeguards.
 */
export class ScanEngine implements BotEngine {
    private phase: Phase = "warming_up";
    private enabled = true;
    private haltReason: string | null = null;
    private decision: string | null = null;

    private readonly adaptive: boolean;
    private readonly risk: RiskManager;
    private readonly trackers = new Map<string, MarketTracker>();
    private readonly pools = new Map<string, PoolTracker>();
    private readonly shadow: ShadowBook;
    private readonly z: number;
    private shadowResolved = 0;
    private lastEvidenceNote = -Infinity;

    private readonly tickReqs = new Map<number, string>();
    private readonly tickSubs = new Map<string, string>();
    private readonly excluded = new Map<string, string>();
    private readonly errorCounts = new Map<string, number>();
    private readonly symbolStats = new Map<string, { trades: number; wins: number }>();
    private ticksStopped = false;

    private signals = new Map<string, SignalInfo>();
    private collectStart = 0;
    private quoting: {
        startedAt: number;
        cands: Map<string, Candidate>;
        pending: Map<number, { symbol: string; side: Side }>;
    } | null = null;
    private pendingBuy: { reqId: number; tradeId: number; at: number } | null = null;

    private trades: TradeRecord[] = [];
    private nextTradeId = 1;
    private nextReq = REQ_BASE;
    private openContractId: number | null = null;
    private openTradeId: number | null = null;
    private subscriptionId: string | null = null;
    private cooldownUntil = 0;
    private apiErrors = 0;

    constructor(private readonly deps: ScanDeps) {
        this.adaptive = deps.scan.adaptive;
        this.risk = new RiskManager(deps.settings);
        deps.symbols.forEach((symbol, i) => {
            this.trackers.set(symbol, new MarketTracker(symbol, deps.settings));
            if (this.adaptive) this.pools.set(symbol, new PoolTracker(symbol, deps.settings));
            this.tickReqs.set(SCAN_TICK_REQ_BASE + i, symbol);
            this.symbolStats.set(symbol, { trades: 0, wins: 0 });
        });

        const comparisons = Math.max(1, deps.symbols.length * ALL_STRATEGY_IDS.length);
        const alpha = (1 - deps.scan.confidencePct / 100) / comparisons;
        this.z = zOneSided(alpha);
        this.shadow = new ShadowBook(
            { unit: deps.scan.durationUnit, duration: deps.scan.duration, window: deps.scan.shadowWindow },
            deps.shadowState,
        );
    }

    private now(): number {
        return (this.deps.now ?? Date.now)();
    }

    get isActive(): boolean {
        return this.phase !== "stopped" && this.phase !== "halted";
    }

    private notifyTelemetry(event: string, meta: Record<string, any>) {
        if (this.deps.onTelemetry) {
            this.deps.onTelemetry(event, meta);
        }
    }

    private get evidenceNote(): string {
        const s = this.deps.scan;
        return (
            `A strategy may trade a market only after ${s.minShadowTrades}+ paper trades there with a cautious win rate ` +
            `(z=${this.z.toFixed(2)}, ${s.confidencePct}% confidence corrected for ` +
            `${this.deps.symbols.length * ALL_STRATEGY_IDS.length} comparisons) above ${s.breakevenPct}%` +
            (s.requireEvidence ? "." : ". Evidence is NOT required in this run (explore mode).")
        );
    }

    private strategyRows(): StrategyRow[] {
        const s = this.deps.scan;
        const rows: StrategyRow[] = [];
        for (const symbol of this.deps.symbols) {
            if (this.excluded.has(symbol)) continue;
            for (const id of ALL_STRATEGY_IDS) {
                const st = this.shadow.stats(keyOf(symbol, id), this.z);
                const status: StrategyRow["status"] =
                    st.n < s.minShadowTrades ? "collecting" : (st.lowerPct ?? 0) > s.breakevenPct ? "qualified" : "below_breakeven";
                rows.push({ symbol, strategyId: id, label: STRATEGY_LABELS[id], n: st.n, wins: st.wins, winRatePct: st.winRatePct, lowerPct: st.lowerPct, status });
            }
        }
        const rank = (r: StrategyRow) => (r.status === "qualified" ? 2 : r.n > 0 ? 1 : 0);
        return rows.sort((a, b) => rank(b) - rank(a) || (b.lowerPct ?? -1) - (a.lowerPct ?? -1) || b.n - a.n).slice(0, MAX_STRATEGY_ROWS);
    }

    get snapshot(): BotSnapshot {
        const markets: MarketRow[] = this.deps.symbols.map((symbol) => ({
            symbol,
            lastPrice: this.pools.get(symbol)?.lastPrice ?? this.trackers.get(symbol)?.lastPrice ?? null,
            signal: this.currentSignal(symbol),
            trades: this.symbolStats.get(symbol)?.trades ?? 0,
            wins: this.symbolStats.get(symbol)?.wins ?? 0,
            excluded: this.excluded.get(symbol) ?? null,
        }));
        return {
            phase: this.phase,
            haltReason: this.haltReason,
            trades: this.trades.slice(-MAX_TRADES_KEPT),
            stats: this.risk.stats(),
            indicators: { fast: null, slow: null, rsi: null },
            markets,
            decision: this.decision,
            ...(this.adaptive ? { strategies: this.strategyRows(), evidenceNote: this.evidenceNote } : {}),
        };
    }

    private currentSignal(symbol: string): Side | null {
        for (const info of this.signals.values()) if (info.symbol === symbol) return info.side;
        return null;
    }

    private emit() {
        this.deps.onChange(this.snapshot);
    }

    private saveShadow() {
        if (this.adaptive) this.deps.onShadowSave?.(this.shadow.serialize());
        this.shadowResolved = 0;
    }

    start() {
        const s = this.deps.scan;
        this.decision = this.adaptive
            ? "No strategy has proven itself yet; collecting live observations and paper-trading evidence."
            : "Scanner is warming up and waiting for a qualifying signal.";
        this.deps.log(
            `🚀 Institutional ${this.adaptive ? "Adaptive" : "Auto-select"} Scanner Active on ${this.deps.symbols.length} market(s): ` +
            `Stake ${this.deps.settings.stake} ${this.deps.currency}, ${s.duration}${s.durationUnit}, margin cap ${s.maxMarginPct}%.`,
        );
        if (this.adaptive) this.deps.log(this.evidenceNote);
        this.notifyTelemetry("scanner_started", { symbolsCount: this.deps.symbols.length });
        this.subscribeTicks();
        this.emit();
    }

    stop() {
        this.enabled = false;
        this.forgetTicks();
        this.signals.clear();
        this.quoting = null;
        this.saveShadow();
        if (this.phase !== "halted" && !this.pendingBuy && this.openContractId === null) this.phase = "stopped";
        this.deps.log("🛑 Stop requested. Gracefully settling open scanning cycles.");
        this.notifyTelemetry("scanner_stop_requested", {});
        this.emit();
    }

    private halt(reason: string) {
        this.phase = "halted";
        this.haltReason = reason;
        this.enabled = false;
        this.quoting = null;
        this.signals.clear();
        this.forgetTicks();
        this.saveShadow();
        this.deps.log(`🚨 CRITICAL SCANNER HALT: ${reason}`);
        this.notifyTelemetry("scanner_halted", { reason });
        this.emit();
    }

    private finishCycle() {
        if (this.phase === "halted") return;
        if (!this.enabled) {
            this.phase = "stopped";
            return;
        }
        if (this.cooldownUntil > this.now()) this.phase = "cooldown";
        else this.phase = this.anyReady() ? "idle" : "warming_up";
    }

    private anyReady(): boolean {
        const source = this.adaptive ? this.pools : this.trackers;
        return [...source].some(([symbol, t]) => !this.excluded.has(symbol) && t.ready);
    }

    private subscribeTicks() {
        this.ticksStopped = false;
        this.tickSubs.clear();
        for (const [reqId, symbol] of this.tickReqs) {
            if (!this.excluded.has(symbol)) this.deps.send({ ticks: symbol, subscribe: 1, req_id: reqId });
        }
    }

    private forgetTicks() {
        this.ticksStopped = true;
        for (const id of this.tickSubs.values()) this.deps.send({ forget: id });
        this.tickSubs.clear();
    }

    private excludeSymbol(symbol: string, reason: string) {
        if (this.excluded.has(symbol)) return;
        this.excluded.set(symbol, reason);
        for (const [key, info] of this.signals) if (info.symbol === symbol) this.signals.delete(key);
        const sub = this.tickSubs.get(symbol);
        if (sub) this.deps.send({ forget: sub });
        this.tickSubs.delete(symbol);
        this.deps.log(`⚠️ Excluded ${symbol} from session scanner: ${reason}`);
        if (this.deps.symbols.every((s) => this.excluded.has(s))) this.halt("Fatal: All monitored markets excluded due to telemetry or pricing errors.");
    }

    private markFailure(symbol: string, message: string) {
        const n = (this.errorCounts.get(symbol) ?? 0) + 1;
        this.errorCounts.set(symbol, n);
        this.deps.log(`⚠️ Market Warning [${symbol}]: Pricing request failed (${message}).`);
        if (n >= EXCLUDE_AFTER_ERRORS) this.excludeSymbol(symbol, `repeated pricing errors (${message})`);
    }

    private recordApiError(message: string) {
        this.apiErrors++;
        this.deps.log(`⚠️ Scanner API Warning: ${message} (Error Streak: ${this.apiErrors}/${MAX_API_ERRORS})`);
        if (this.apiErrors >= MAX_API_ERRORS) this.halt(`Safety Circuit Tripped: Repeated scanner API failures. Last: ${message}`);
        else this.finishCycle();
    }

    handleMessage(msg: Record<string, any>) {
        const reqId: number | undefined = msg.req_id ?? msg.echo_req?.req_id;

        if (msg.msg_type === "tick") {
            const symbol = typeof reqId === "number" ? this.tickReqs.get(reqId) : undefined;
            if (!symbol) return;
            const subId = msg.subscription?.id;
            if (typeof subId === "string") {
                if (this.ticksStopped || this.excluded.has(symbol)) this.deps.send({ forget: subId });
                else this.tickSubs.set(symbol, subId);
            }
            const quote = Number(msg.tick?.quote);
            const epochRaw = Number(msg.tick?.epoch);
            const epoch = Number.isFinite(epochRaw) ? epochRaw : Math.floor(this.now() / 1000);
            if (Number.isFinite(quote) && !this.excluded.has(symbol) && !this.ticksStopped) this.onTick(symbol, quote, epoch);
            return;
        }

        if (msg.error) {
            this.onError(reqId, msg.error);
            return;
        }

        switch (msg.msg_type) {
            case "proposal":
                if (reqId !== undefined) this.onProposal(reqId, msg.proposal);
                break;
            case "buy":
                if (this.pendingBuy && reqId === this.pendingBuy.reqId) this.onBuy(msg.buy);
                break;
            case "proposal_open_contract":
                this.onContractUpdate(msg);
                break;
            default:
                break;
        }
    }

    onConnectionLost() {
        if (this.phase === "collecting" || this.phase === "quoting") {
            this.quoting = null;
            this.signals.clear();
            this.deps.log("Network dropped prior to order placement. Scanning cycle aborted safely.");
            this.finishCycle();
        } else if (this.phase === "buying") {
            const trade = this.trades.find((t) => t.id === this.pendingBuy?.tradeId);
            if (trade) trade.result = "unknown";
            this.pendingBuy = null;
            this.halt("FATAL: Network severed during scanner order execution. Verify open contract ledger on Deriv.");
            return;
        }
        this.emit();
    }

    onConnectionRestored() {
        if (this.enabled) this.subscribeTicks();
        if (this.openContractId !== null) {
            this.deps.log("Network restored. Re-establishing active contract tracking feed.");
            this.subscribeToContract(this.openContractId);
        }
    }

    private onError(reqId: number | undefined, error: Record<string, any>) {
        const message = String(error.message ?? "unknown error");
        if (reqId === undefined) return;

        const tickSymbol = this.tickReqs.get(reqId);
        if (tickSymbol) {
            this.excludeSymbol(tickSymbol, `live telemetry unavailable (${message})`);
            this.emit();
            return;
        }
        const pendingQuote = this.quoting?.pending.get(reqId);
        if (pendingQuote && this.quoting) {
            this.quoting.pending.delete(reqId);
            this.markFailure(pendingQuote.symbol, message);
            if (this.quoting && this.quoting.pending.size === 0) this.decide();
            else this.emit();
            return;
        }
        if (this.pendingBuy && reqId === this.pendingBuy.reqId) {
            this.trades = this.trades.filter((t) => t.id !== this.pendingBuy?.tradeId);
            this.pendingBuy = null;
            this.recordApiError(`Order proposal rejected by broker: ${message}`);
            this.emit();
        }
    }

    private onTick(symbol: string, price: number, epoch: number) {
        const t = this.now();
        const listening = this.enabled && ["idle", "collecting", "warming_up", "cooldown"].includes(this.phase);

        if (this.adaptive) {
            this.observeAdaptive(symbol, price, epoch, t, listening);
        } else {
            const signal = this.trackers.get(symbol)?.update(price) ?? null;
            if (signal && listening) {
                this.signals.set(symbol, { symbol, strategyId: "ema_rsi", side: signal.side, strength: signal.strength, reason: signal.reason, at: t });
            }
        }
        this.checkTimeouts(t);

        if (this.phase === "warming_up" && this.anyReady()) {
            this.phase = "idle";
            this.deps.log("Multi-market indicators fully calibrated. Scanning active asset pool.");
        }
        if (this.phase === "cooldown" && t >= this.cooldownUntil) this.phase = "idle";

        if (this.phase === "idle" && this.enabled) {
            const fresh = this.freshSignals(t);
            const usable = this.adaptive ? this.eligible(fresh) : fresh;
            if (usable.length > 0) {
                this.phase = "collecting";
                this.collectStart = t;
            } else if (this.adaptive && fresh.length > 0) {
                this.noteNoEvidence(t, fresh);
            }
        }
        if (this.phase === "collecting" && t - this.collectStart >= this.deps.scan.collectSeconds * 1000) this.startQuoting(t);
        this.emit();
    }

    private observeAdaptive(symbol: string, price: number, epoch: number, t: number, listening: boolean) {
        const pool = this.pools.get(symbol);
        if (!pool) return;
        for (const id of pool.ids) {
            if (this.shadow.onTick(keyOf(symbol, id), price, epoch)) this.shadowResolved++;
        }
        for (const sig of pool.update(price)) {
            this.shadow.open(keyOf(symbol, sig.strategyId), sig.side, price, epoch);
            if (listening) {
                this.signals.set(keyOf(symbol, sig.strategyId), {
                    symbol,
                    strategyId: sig.strategyId,
                    side: sig.side,
                    strength: 0,
                    reason: `${STRATEGY_LABELS[sig.strategyId]}: ${sig.reason}`,
                    at: t,
                });
            }
        }
        if (this.shadowResolved >= SHADOW_SAVE_EVERY) this.saveShadow();
    }

    private freshSignals(t: number): [string, SignalInfo][] {
        const maxAge = this.deps.scan.signalMaxAgeSeconds * 1000;
        for (const [key, s] of this.signals) if (t - s.at > maxAge) this.signals.delete(key);
        return [...this.signals].sort((a, b) => b[1].strength - a[1].strength);
    }

    private eligible(fresh: [string, SignalInfo][]): EligibleSignal[] {
        const s = this.deps.scan;
        const best = new Map<string, EligibleSignal>();
        for (const [, info] of fresh) {
            const st = this.shadow.stats(keyOf(info.symbol, info.strategyId), this.z);
            if (st.n < s.minShadowTrades || st.lowerPct === null) continue;
            if (s.requireEvidence && st.lowerPct <= s.breakevenPct) continue;
            const cur = best.get(info.symbol);
            if (!cur || st.lowerPct > (cur.lower ?? -1)) best.set(info.symbol, { info, lower: st.lowerPct, n: st.n });
        }
        return [...best.values()].sort((a, b) => (b.lower ?? 0) - (a.lower ?? 0)).slice(0, MAX_CANDIDATES);
    }

    private noteNoEvidence(t: number, fresh: [string, SignalInfo][]) {
        if (t - this.lastEvidenceNote < EVIDENCE_NOTE_EVERY_MS) return;
        this.lastEvidenceNote = t;
        const s = this.deps.scan;
        let bestText = "no paper results yet";
        let bestLower = -1;
        for (const [, info] of fresh) {
            const st = this.shadow.stats(keyOf(info.symbol, info.strategyId), this.z);
            if (st.lowerPct !== null && st.lowerPct > bestLower) {
                bestLower = st.lowerPct;
                bestText = `best is ${STRATEGY_LABELS[info.strategyId as StrategyId] ?? info.strategyId} on ${info.symbol} at ${st.lowerPct.toFixed(1)}% over ${st.n} paper trades`;
            }
        }
        this.decision = `Signals detected, awaiting statistical confidence threshold (${bestText}; needs ${s.minShadowTrades}+ trades > ${s.breakevenPct}%). Holding.`;
        this.deps.log(`🔎 [Scanner] ${this.decision}`);
    }

    private checkTimeouts(t: number) {
        if (this.phase === "quoting" && this.quoting && t - this.quoting.startedAt > QUOTE_TIMEOUT_MS) {
            this.deps.log("Quote collection timeout reached. Executing selection with received pricing data.");
            this.decide();
        }
        if (this.pendingBuy && t - this.pendingBuy.at > BUY_TIMEOUT_MS) {
            const trade = this.trades.find((x) => x.id === this.pendingBuy?.tradeId);
            if (trade) trade.result = "unknown";
            this.pendingBuy = null;
            this.halt("FATAL: Order execution confirmation timed out. Verify portfolio state immediately.");
        }
    }

    private startQuoting(t: number) {
        const check = this.risk.check();
        if (!check.ok) {
            this.halt(check.reason);
            return;
        }
        const fresh = this.freshSignals(t);
        const picks: EligibleSignal[] = this.adaptive
            ? this.eligible(fresh)
            : fresh.slice(0, MAX_CANDIDATES).map(([, info]) => ({ info }));

        if (picks.length === 0) {
            this.cooldownUntil = t + this.deps.settings.cooldownSeconds * 1000;
            this.finishCycle();
            return;
        }

        const { settings, scan, currency } = this.deps;
        const cands = new Map<string, Candidate>();
        const pending = new Map<number, { symbol: string; side: Side }>();

        for (const { info, lower, n } of picks) {
            cands.set(info.symbol, {
                symbol: info.symbol,
                side: info.side,
                strength: info.strength,
                reason: info.reason,
                call: null,
                put: null,
                ...(this.adaptive
                    ? { strategyLabel: STRATEGY_LABELS[info.strategyId as StrategyId], lowerPct: lower ?? null, sample: n ?? 0 }
                    : {}),
            });
            for (const side of ["CALL", "PUT"] as const) {
                const reqId = this.nextReq++;
                const sent = this.deps.send({
                    proposal: 1,
                    amount: settings.stake,
                    basis: "stake",
                    contract_type: side,
                    currency,
                    duration: scan.duration,
                    duration_unit: scan.durationUnit,
                    underlying_symbol: info.symbol,
                    req_id: reqId,
                });
                if (!sent) {
                    this.deps.log("Order broadcast aborted: WebSocket pipe offline.");
                    this.finishCycle();
                    return;
                }
                pending.set(reqId, { symbol: info.symbol, side });
            }
        }
        this.quoting = { startedAt: t, cands, pending };
        this.phase = "quoting";
        this.deps.log(`⚡ Signals verified across [${picks.map((p) => p.info.symbol).join(", ")}]. Requesting institutional quotes…`);
    }

    private onProposal(reqId: number, proposal: Record<string, any> | undefined) {
        const q = this.quoting;
        const p = q?.pending.get(reqId);
        if (!q || !p) return;
        q.pending.delete(reqId);

        const quote = parseQuote(proposal);
        const cand = q.cands.get(p.symbol);

        if (quote && cand) {
            if (p.side === "CALL") cand.call = quote;
            else cand.put = quote;
        } else {
            this.markFailure(p.symbol, "unreadable pricing payload");
        }

        if (this.quoting && this.quoting.pending.size === 0) this.decide();
        else this.emit();
    }

    private decide() {
        const q = this.quoting;
        if (!q) return;
        this.quoting = null;
        this.signals.clear();

        const cands = [...q.cands.values()];

        // Filter candidates against institutional house margin limits
        const validCandidates = cands.filter(c => isHouseMarginAcceptable(c.call, c.put, this.deps.scan.maxMarginPct));

        const pick = this.adaptive
            ? pickBestEdge(validCandidates, this.deps.scan.maxMarginPct, this.deps.scan.requireEvidence)
            : pickBest(validCandidates, this.deps.scan.maxMarginPct);

        this.decision = pick.summary;
        this.deps.log(`🔎 [Decision] ${pick.summary}`);
        this.notifyTelemetry("scanner_decision_made", { summary: pick.summary, chosenSymbol: pick.chosen?.symbol });

        const chosen = pick.chosen;
        if (!chosen || !this.enabled) {
            this.cooldownUntil = this.now() + this.deps.settings.cooldownSeconds * 1000;
            this.finishCycle();
            this.emit();
            return;
        }

        const riskCheck = this.risk.check();
        if (!riskCheck.ok) {
            this.halt(riskCheck.reason);
            return;
        }

        const stake = this.deps.settings.stake;
        const quote = chosen.side === "CALL" ? chosen.call : chosen.put;

        const maxSlippagePct = this.deps.settings.maxSlippagePct;

        if (
            !quote?.id ||
            !Number.isFinite(quote.askPrice) ||
            quote.askPrice <= 0 ||
            !Number.isFinite(stake) ||
            stake <= 0 ||
            !Number.isFinite(maxSlippagePct) ||
            maxSlippagePct < 0 ||
            quote.askPrice > stake * (1 + maxSlippagePct / 100)
        ) {
            this.deps.log(
                `Price guard rejected trade: ask=${quote?.askPrice ?? "unavailable"}, stake=${stake}.`,
            );
            this.finishCycle();
            this.emit();
            return;
        }

        const trade: TradeRecord = {
            id: this.nextTradeId++,
            symbol: chosen.symbol,
            payout: quote.payout,
            contractId: null,
            openedAt: this.now(),
            side: chosen.side,
            stake,
            buyPrice: null,
            profit: null,
            result: "pending",
            reason: `${chosen.reason}. ${pick.summary}`,
        };

        const reqId = this.nextReq++;
        if (!this.deps.send({ buy: quote.id, price: stake, req_id: reqId })) {
            this.deps.log("Order execution failed: Socket pipe closed.");
            this.finishCycle();
            this.emit();
            return;
        }

        this.trades.push(trade);
        this.pendingBuy = { reqId, tradeId: trade.id, at: this.now() };
        this.phase = "buying";
        this.emit();
    }

    private onBuy(buy: Record<string, any> | undefined) {
        const pending = this.pendingBuy;
        if (!pending) return;

        this.pendingBuy = null;

        const trade = this.trades.find(
            (t) => t.id === pending.tradeId,
        );

        const contractId = Number(buy?.contract_id);
        const buyPrice = Number(buy?.buy_price);

        if (
            !trade ||
            !Number.isSafeInteger(contractId) ||
            contractId <= 0 ||
            !Number.isFinite(buyPrice) ||
            buyPrice <= 0
        ) {
            this.halt(
                "Invalid execution confirmation. Verify Deriv portfolio and account ledger manually.",
            );
            return;
        }

        const maxSlippagePct = this.deps.settings.maxSlippagePct;
        const maximumBuyPrice =
            trade.stake * (1 + maxSlippagePct / 100);

        if (buyPrice > maximumBuyPrice) {
            trade.contractId = contractId;
            trade.buyPrice = buyPrice;
            trade.result = "unknown";

            this.halt(
                `Execution price exceeded configured limit. Contract ${contractId} requires manual verification.`,
            );
            return;
        }

        trade.contractId = contractId;
        trade.buyPrice = buyPrice;
        trade.result = "open";

        this.openContractId = contractId;
        this.openTradeId = trade.id;

        this.apiErrors = 0;
        this.phase = "open";

        this.deps.log(
            `Position executed [${trade.symbol}]: ${trade.side} contract #${contractId} @ ${buyPrice}.`,
        );

        this.notifyTelemetry("scanner_trade_opened", {
            symbol: trade.symbol,
            contractId,
            side: trade.side,
            stake: trade.stake,
            buyPrice,
        });

        this.subscribeToContract(contractId);
        this.emit();
    }

    private subscribeToContract(contractId: number) {
        this.deps.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1, req_id: this.nextReq++ });
    }

    private onContractUpdate(msg: Record<string, any>) {
        const c = msg.proposal_open_contract;
        if (!c || this.openContractId === null || Number(c.contract_id) !== this.openContractId) return;
        if (typeof msg.subscription?.id === "string") this.subscriptionId = msg.subscription.id;
        if (!(c.is_sold === 1 || c.is_sold === true)) return;

        const profit = Number(c.profit);

        if (!Number.isFinite(profit)) {
            this.halt(
                "Contract settlement payload unreadable. Check portfolio balance.",
            );
            return;
        }
        const trade = this.trades.find((t) => t.id === this.openTradeId);
        if (this.subscriptionId) this.deps.send({ forget: this.subscriptionId });

        this.subscriptionId = null;
        this.openContractId = null;
        this.openTradeId = null;

        if (!Number.isFinite(profit) || !trade) {
            this.halt("Contract settlement payload unreadable. Check portfolio balance.");
            return;
        }

        trade.profit = profit;
        trade.result =
            profit > 0 ? "won" :
                profit < 0 ? "lost" :
                    "breakeven";
        this.risk.recordResult(profit);

        const stat = this.symbolStats.get(trade.symbol);
        if (stat) {
            stat.trades++;
            if (profit > 0) stat.wins++;
        }

        const outcomeText = profit > 0 ? "✅ WON" : "❌ LOST";
        this.deps.log(`${outcomeText} [${trade.symbol}] #${trade.contractId} | PnL: ${profit >= 0 ? "+" : ""}${profit.toFixed(2)} ${this.deps.currency}`);
        this.notifyTelemetry("scanner_trade_settled", { symbol: trade.symbol, contractId: trade.contractId, profit, result: trade.result });

        this.cooldownUntil = this.now() + this.deps.settings.cooldownSeconds * 1000;
        const riskCheck = this.risk.check();
        if (!riskCheck.ok) {
            this.halt(`Circuit Breaker: ${riskCheck.reason}`);
            return;
        }

        const stats = this.risk.stats();
        const guard = winRateGuard(stats.wins, stats.trades, this.deps.scan.targetWinRatePct, this.deps.scan.minSampleTrades);
        if (guard.halt) {
            this.halt(guard.reason as string);
            return;
        }

        this.finishCycle();
        this.emit();
    }
}