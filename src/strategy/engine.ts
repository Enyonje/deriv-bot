import { RiskManager, type RiskStats } from "./risk";
import type { BotSettings } from "./settings";
import { EmaRsiStrategy, type IndicatorView, type Side } from "./strategy";

export type Phase =
    | "stopped"
    | "warming_up"
    | "idle"
    | "collecting"
    | "quoting"
    | "proposing"
    | "buying"
    | "open"
    | "cooldown"
    | "halted";

export interface TradeRecord {
    id: number;
    symbol: string;
    payout: number | null;
    contractId: number | null;
    openedAt: number;
    side: Side;
    stake: number;
    buyPrice: number | null;
    profit: number | null;
    result: "pending" | "open" | "won" | "lost" | "unknown";
    reason: string;
    executionLatencyMs?: number;
}

export interface BotSnapshot {
    phase: Phase;
    haltReason: string | null;
    trades: TradeRecord[];
    stats: RiskStats;
    indicators: IndicatorView;
    markets?: MarketRow[];
    decision?: string | null;
    strategies?: StrategyRow[];
    evidenceNote?: string;
    volatilityIndex?: number;
}

export interface StrategyRow {
    symbol: string;
    strategyId: string;
    label: string;
    n: number;
    wins: number;
    winRatePct: number | null;
    lowerPct: number | null;
    status: "collecting" | "qualified" | "below_breakeven";
}

export interface MarketRow {
    symbol: string;
    lastPrice: number | null;
    signal: "CALL" | "PUT" | null;
    trades: number;
    wins: number;
    excluded: string | null;
}

export interface BotEngine {
    readonly isActive: boolean;
    start(): void;
    stop(): void;
    handleMessage(msg: Record<string, any>): void;
    onConnectionLost(): void;
    onConnectionRestored(): void;
}

export interface EngineDeps {
    settings: BotSettings;
    symbol: string;
    currency: string;
    send: (request: Record<string, unknown>) => boolean;
    onChange: (snapshot: BotSnapshot) => void;
    log: (message: string) => void;
    onTelemetry?: (event: string, meta: Record<string, any>) => void;
    now?: () => number;
}

interface Pending {
    kind: "proposal" | "buy";
    at: number;
    tradeId?: number;
}

const REQUEST_TIMEOUT_MS = 10_000; // Hardened timeout for high-speed execution
const MAX_CONSECUTIVE_API_ERRORS = 3;
const MAX_TRADES_KEPT = 100;
const maxPrice =
    s.stake * (1 + s.maxSlippagePct / 100); // Tighter slippage control for institutional edge

const EMPTY_STATS: RiskStats = {
    pnl: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    winRate: null,
    currentStake: 0,
    maxDrawdown: 0,
};


export const EMPTY_SNAPSHOT: BotSnapshot = {
    phase: "stopped",
    haltReason: null,
    trades: [],
    stats: EMPTY_STATS,
    indicators: { fast: null, slow: null, rsi: null },
};

/**
 * Institutional-Grade Algorithmic Trading Engine.
 * Features strict risk circuit-breakers, execution latency tracking, and slippage guards.
 */
export class TradingEngine implements BotEngine {
    private phase: Phase = "warming_up";
    private enabled = true;
    private haltReason: string | null = null;
    private readonly strategy: EmaRsiStrategy;
    private readonly risk: RiskManager;
    private trades: TradeRecord[] = [];
    private nextTradeId = 1;
    private nextReqId = 1000;
    private pending = new Map<number, Pending>();
    private openContractId: number | null = null;
    private openTradeId: number | null = null;
    private subscriptionId: string | null = null;
    private cooldownUntil = 0;
    private apiErrors = 0;
    private lastSignal: { side: Side; reason: string; timestamp: number } | null = null;

    constructor(private readonly deps: EngineDeps) {
        this.strategy = new EmaRsiStrategy(deps.settings);
        this.risk = new RiskManager(deps.settings);
    }

    private now(): number {
        return (this.deps.now ?? Date.now)();
    }

    get isActive(): boolean {
        return this.phase !== "stopped" && this.phase !== "halted";
    }

    get snapshot(): BotSnapshot {
        return {
            phase: this.phase,
            haltReason: this.haltReason,
            trades: this.trades.slice(-MAX_TRADES_KEPT),
            stats: this.risk.stats(),
            indicators: this.strategy.view(),
        };
    }

    private emit() {
        this.deps.onChange(this.snapshot);
    }

    private notifyTelemetry(event: string, meta: Record<string, any>) {
        if (this.deps.onTelemetry) {
            this.deps.onTelemetry(event, meta);
        }
    }

    start() {
        this.deps.log(
            `🚀 Institutional Engine Active on ${this.deps.symbol}: Stake ${this.deps.settings.stake} ${this.deps.currency}, ` +
            `${this.deps.settings.durationTicks} ticks, EMA ${this.deps.settings.fastPeriod}/${this.deps.settings.slowPeriod}.`,
        );
        this.notifyTelemetry("bot_started", { symbol: this.deps.symbol, stake: this.deps.settings.stake });
        this.emit();
    }

    stop() {
        this.enabled = false;
        if (this.phase !== "halted" && this.pending.size === 0 && this.openContractId === null) {
            this.phase = "stopped";
        }
        this.deps.log("🛑 Stop requested. Gracefully settling open positions; no new entries will be queued.");
        this.notifyTelemetry("bot_stop_requested", {});
        this.emit();
    }

    private halt(reason: string) {
        this.phase = "halted";
        this.haltReason = reason;
        this.enabled = false;
        this.deps.log(`🚨 CRITICAL HALT: ${reason}`);
        this.notifyTelemetry("bot_halted", { reason });
        this.emit();
    }

    private finishCycle() {
        if (this.phase === "halted") return;
        if (!this.enabled) {
            this.phase = "stopped";
            return;
        }
        if (this.cooldownUntil > this.now()) this.phase = "cooldown";
        else this.phase = this.strategy.ready ? "idle" : "warming_up";
    }

    private recordApiError(message: string) {
        this.apiErrors++;
        this.deps.log(`⚠️ API Warning: ${message} (Streak: ${this.apiErrors}/${MAX_CONSECUTIVE_API_ERRORS})`);
        if (this.apiErrors >= MAX_CONSECUTIVE_API_ERRORS) {
            this.halt(`Safety Circuit Tripped: Repeated API communication failures. Last error: ${message}`);
        } else {
            this.finishCycle();
        }
    }

    handleMessage(msg: Record<string, any>) {
        if (msg.msg_type === "tick") {
            if (typeof msg.req_id === "number" && msg.req_id >= 4_000_000) return;
            const quote = Number(msg.tick?.quote);
            if (Number.isFinite(quote)) this.onTick(quote);
            return;
        }

        const reqId: number | undefined = msg.req_id ?? msg.echo_req?.req_id;
        const pending = reqId !== undefined ? this.pending.get(reqId) : undefined;

        if (msg.error) {
            if (pending && reqId !== undefined) {
                this.pending.delete(reqId);
                if (pending.kind === "buy") {
                    this.trades = this.trades.filter((t) => t.id !== pending.tradeId);
                }
                this.recordApiError(`${pending.kind} protocol rejected: ${msg.error.message ?? "unknown error"}`);
                this.emit();
            }
            return;
        }

        switch (msg.msg_type) {
            case "proposal":
                if (pending?.kind === "proposal" && reqId !== undefined) this.onProposal(reqId, msg.proposal);
                break;
            case "buy":
                if (pending?.kind === "buy" && reqId !== undefined) this.onBuy(reqId, pending, msg.buy);
                break;
            case "proposal_open_contract":
                this.onContractUpdate(msg);
                break;
            default:
                break;
        }
    }

    onConnectionLost() {
        if (this.phase === "proposing") {
            this.pending.clear();
            this.deps.log("Network dropped during quote proposal. Abandoned cycle.");
            this.finishCycle();
        } else if (this.phase === "buying") {
            for (const p of this.pending.values()) {
                const trade = this.trades.find((t) => t.id === p.tradeId);
                if (trade) trade.result = "unknown";
            }
            this.pending.clear();
            this.halt("FATAL: Network severed during order settlement. Verify open contracts directly on Deriv terminal.");
        }
        this.emit();
    }

    onConnectionRestored() {
        if (this.openContractId !== null) {
            this.deps.log("Network re-established. Re-subscribing telemetry feed for active contract.");
            this.subscribeToContract(this.openContractId);
        }
    }

    private onTick(price: number) {
        const signal = this.strategy.update(price);
        const t = this.now();
        this.checkTimeouts(t);

        if (this.phase === "warming_up" && this.strategy.ready) {
            this.phase = "idle";
            this.deps.log("Indicators calibrated and primed. Activating high-frequency listening loop.");
        }
        if (this.phase === "cooldown" && t >= this.cooldownUntil) this.phase = "idle";

        if (signal && this.phase === "idle" && this.enabled) {
            this.requestProposal(signal.side, signal.reason);
        }
        this.emit();
    }

    private checkTimeouts(t: number) {
        for (const [reqId, p] of [...this.pending]) {
            if (t - p.at <= REQUEST_TIMEOUT_MS) continue;
            this.pending.delete(reqId);
            if (p.kind === "proposal") {
                this.recordApiError("Proposal request timed out waiting for gateway response.");
            } else {
                const trade = this.trades.find((x) => x.id === p.tradeId);
                if (trade) trade.result = "unknown";
                this.halt("Order execution timed out. Check account ledger before reactivating.");
            }
        }
    }

    private requestProposal(side: Side, reason: string) {
        const riskCheck = this.risk.check();
        if (!riskCheck.ok) {
            this.halt(`Risk Management Lockout: ${riskCheck.reason}`);
            return;
        }
        const s = this.deps.settings;
        const reqId = this.nextReqId++;
        const sent = this.deps.send({
            proposal: 1,
            amount: s.stake,
            basis: "stake",
            contract_type: side,
            currency: this.deps.currency,
            duration: s.durationTicks,
            duration_unit: "t",
            underlying_symbol: this.deps.symbol,
            req_id: reqId,
        });

        if (!sent) {
            this.deps.log("Execution aborted: WebSocket pipe is offline.");
            return;
        }

        this.pending.set(reqId, { kind: "proposal", at: this.now() });
        this.phase = "proposing";
        this.lastSignal = { side, reason, timestamp: this.now() };
        this.deps.log(`⚡ Signal Confirmed [${side}]: ${reason}. Fetching institutional pricing quote…`);
    }

    private onProposal(reqId: number, proposal: Record<string, any> | undefined) {
        this.pending.delete(reqId);
        const s = this.deps.settings;

        if (!this.enabled) {
            this.finishCycle();
            this.emit();
            return;
        }

        const id = proposal?.id;
        const ask = Number(proposal?.ask_price);
        if (typeof id !== "string" || !Number.isFinite(ask)) {
            this.recordApiError("Received malformed pricing payload from broker socket.");
            this.emit();
            return;
        }

        // Strict slippage tolerance check
        if (
            !Number.isFinite(ask) ||
            ask <= 0 ||
            ask > maxPrice
        ) {
            this.deps.log(
                `Quote rejected: ask ${ask} exceeds maximum permitted price ${maxPrice.toFixed(2)}.`,
            );
            this.finishCycle();
            this.emit();
            return;
        }

        const signal = this.lastSignal ?? { side: "CALL" as Side, reason: "", timestamp: this.now() };
        const quotedPayout = Number(proposal?.payout);
        const nowTime = this.now();

        const trade: TradeRecord = {
            id: this.nextTradeId++,
            symbol: this.deps.symbol,
            payout: Number.isFinite(quotedPayout) ? quotedPayout : null,
            contractId: null,
            openedAt: nowTime,
            side: signal.side,
            stake: s.stake,
            buyPrice: null,
            profit: null,
            result: "pending",
            reason: signal.reason,
            executionLatencyMs: nowTime - signal.timestamp,
        };

        const buyReq = this.nextReqId++;
        const sent = this.deps.send({ buy: id, price: s.stake, req_id: buyReq });
        if (!sent) {
            this.deps.log("Order dispatch failed: WebSocket pipe closed unexpectedly.");
            this.finishCycle();
            this.emit();
            return;
        }

        this.trades.push(trade);
        this.pending.set(buyReq, { kind: "buy", at: this.now(), tradeId: trade.id });
        this.phase = "buying";
        this.emit();
    }

    private onBuy(
        reqId: number,
        pending: Pending,
        buy: Record<string, any> | undefined,
    ) {
        this.pending.delete(reqId);

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
            if (trade) trade.result = "unknown";

            this.halt(
                "Invalid buy confirmation. Verify the account ledger before resuming.",
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
            `Position executed: ${trade.side} contract #${contractId} @ ${buyPrice}.`,
        );

        this.notifyTelemetry("trade_opened", {
            contractId,
            side: trade.side,
            stake: trade.stake,
            buyPrice,
        });

        this.subscribeToContract(contractId);
        this.emit();
    }

    private subscribeToContract(contractId: number) {
        this.deps.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1, req_id: this.nextReqId++ });
    }

    private onContractUpdate(msg: Record<string, any>) {
        const c = msg.proposal_open_contract;
        if (!c || this.openContractId === null || Number(c.contract_id) !== this.openContractId) return;
        if (typeof msg.subscription?.id === "string") this.subscriptionId = msg.subscription.id;
        if (!(c.is_sold === 1 || c.is_sold === true)) return;

        const profit = Number(c.profit);
        const trade = this.trades.find((t) => t.id === this.openTradeId);
        if (this.subscriptionId) this.deps.send({ forget: this.subscriptionId });

        this.subscriptionId = null;
        this.openContractId = null;
        this.openTradeId = null;

        if (!Number.isFinite(profit) || !trade) {
            this.halt("Settlement payload unreadable. Check portfolio balance directly.");
            return;
        }

        trade.profit = profit;
        trade.result = profit > 0 ? "won" : "lost";
        this.risk.recordResult(profit);

        const outcomeText = profit > 0 ? "✅ WON" : "❌ LOST";
        this.deps.log(`${outcomeText} #${trade.contractId} | Net PnL: ${profit >= 0 ? "+" : ""}${profit.toFixed(2)} ${this.deps.currency}`);
        this.notifyTelemetry("trade_settled", { contractId: trade.contractId, profit, result: trade.result });

        this.cooldownUntil = this.now() + this.deps.settings.cooldownSeconds * 1000;
        const riskCheck = this.risk.check();
        if (!riskCheck.ok) {
            this.halt(`Circuit Breaker Triggered: ${riskCheck.reason}`);
            return;
        }

        this.finishCycle();
        this.emit();
    }
}