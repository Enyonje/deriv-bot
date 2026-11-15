import { houseMarginPct, quoteMetrics, type Quote } from "./quotes";
import { Rsi } from "./indicators";
import type { Side, StrategyParams } from "./strategy";

export interface ScanSignal {
    side: Side;
    reason: string;
    /** Distance of price from the slow EMA, in units of the market's typical tick move. A tiebreaker only. */
    strength: number;
}

/** One market's indicator state. Feed it that market's ticks. */
export class MarketTracker {
    private readonly rsi: Rsi;
    private readonly prices: number[] = [];
    private fastEma: number | null = null;
    private slowEma: number | null = null;
    private ticks = 0;
    private vol: number | null = null;
    private last: number | null = null;
    private lastSignalSide: Side | null = null;

    constructor(readonly symbol: string, private readonly params: StrategyParams) {
        this.rsi = new Rsi(params.rsiPeriod);
    }

    update(price: number): ScanSignal | null {
        if (!Number.isFinite(price) || price <= 0) return null;
        if (this.last !== null) {
            const move = Math.abs(price - this.last);
            this.vol = this.vol === null ? move : this.vol + (2 / (this.params.slowPeriod + 1)) * (move - this.vol);
        }
        this.last = price;
        this.ticks++;
        this.prices.push(price);
        if (this.prices.length > 100) this.prices.shift();

        const fastAlpha = 2 / (this.params.fastPeriod + 1);
        const slowAlpha = 2 / (this.params.slowPeriod + 1);
        this.fastEma = this.fastEma === null ? price : fastAlpha * price + (1 - fastAlpha) * this.fastEma;
        this.slowEma = this.slowEma === null ? price : slowAlpha * price + (1 - slowAlpha) * this.slowEma;
        const rsi = this.rsi.update(price);
        if (!this.ready || rsi === null || this.fastEma === null || this.slowEma === null) return null;

        const momentum = price - this.prices[this.prices.length - 6];
        let side: Side | null = null;
        if (this.fastEma > this.slowEma && momentum > 0 && rsi > 50 && rsi < this.params.rsiOverbought) side = "CALL";
        if (this.fastEma < this.slowEma && momentum < 0 && rsi < 50 && rsi > this.params.rsiOversold) side = "PUT";
        if (!side || side === this.lastSignalSide) return null;
        this.lastSignalSide = side;
        const strength = this.slowEma > 0 && this.vol !== null && this.vol > 0 ? Math.abs(price - this.slowEma) / this.vol : 0;
        return { side, reason: `Tick-confirmed EMA/RSI alignment (${side}; RSI ${rsi.toFixed(1)})`, strength };
    }

    get ready(): boolean {
        return this.ticks >= this.params.slowPeriod && this.prices.length >= 6;
    }

    get lastPrice(): number | null {
        return this.last;
    }
}

export interface Candidate {
    symbol: string;
    side: Side;
    strength: number;
    reason: string;
    call: Quote | null;
    put: Quote | null;
    /** Adaptive mode: which strategy produced the signal and how much paper evidence backs it. */
    strategyLabel?: string;
    lowerPct?: number | null;
    sample?: number;
    expectedValue?: number | null;
}

export interface Pick {
    chosen: Candidate | null;
    marginPct: number | null;
    summary: string;
}

/**
 * Institutional Picker: Selects the optimal market based on lowest house margin,
 * positive mathematical Expected Value ($EV$), and signal strength tiebreakers.
 */
export function pickBest(candidates: Candidate[], maxMarginPct: number): Pick {
    const rows = candidates.map((c) => {
        const quote = c.side === "CALL" ? c.call : c.put;
        const margin = houseMarginPct(c.call, c.put);
        const metrics = quote ? quoteMetrics(quote, c.lowerPct ? c.lowerPct / 100 : undefined) : null;
        return { c, margin, expectedValue: metrics?.expectedValue ?? null };
    });

    const ok = rows
        .filter((r) => r.margin !== null && r.margin <= maxMarginPct && (r.expectedValue === null || r.expectedValue >= 0))
        .sort((a, b) => (a.margin as number) - (b.margin as number) || (b.expectedValue ?? 0) - (a.expectedValue ?? 0) || b.c.strength - a.c.strength);

    const describe = (r: { c: Candidate; margin: number | null }) =>
        r.margin === null ? `${r.c.symbol} no price` : `${r.c.symbol} ${r.margin.toFixed(1)}%`;

    const best = ok[0];
    if (best) {
        const others = rows.filter((r) => r !== best).map(describe);
        return {
            chosen: best.c,
            marginPct: best.margin,
            summary:
                `Chose ${best.c.symbol} ${best.c.side === "CALL" ? "Higher" : "Lower"} (margin ${(best.margin as number).toFixed(1)}%)` +
                (others.length ? `. Others: ${others.join(", ")}.` : "."),
        };
    }
    return {
        chosen: null,
        marginPct: null,
        summary: rows.length
            ? `No market qualified (cap ${maxMarginPct}% or negative EV): ${rows.map(describe).join(", ")}.`
            : "No market qualified: nothing to compare.",
    };
}

/** Win rate at which a trade breaks even: stake / payout, averaged over trades with a known payout. */
export function breakevenWinRatePct(trades: { stake: number; payout: number | null }[]): number | null {
    const usable = trades.filter((t) => t.payout !== null && t.payout > 0);
    if (usable.length === 0) return null;
    const mean = usable.reduce((sum, t) => sum + t.stake / (t.payout as number), 0) / usable.length;
    return mean * 100;
}

/** Halts once the sample is large enough and the realised win rate is below the user's target. */
export function winRateGuard(
    wins: number,
    trades: number,
    targetPct: number,
    minSample: number,
): { halt: boolean; reason: string | null } {
    if (trades < minSample) return { halt: false, reason: null };
    const rate = (wins / trades) * 100;
    if (rate >= targetPct) return { halt: false, reason: null };
    return {
        halt: true,
        reason: `Win rate ${rate.toFixed(1)}% after ${trades} trades is below your ${targetPct}% target.`,
    };
}

/** Lower end of the Wilson interval (default 95% two-sided), in percent: a cautious estimate of the true win rate. */
export function wilsonLowerPct(
    wins: number,
    n: number,
    z = 1.96,
): number | null {
    if (
        !Number.isSafeInteger(wins) ||
        !Number.isSafeInteger(n) ||
        n <= 0 ||
        wins < 0 ||
        wins > n ||
        !Number.isFinite(z) ||
        z <= 0
    ) {
        return null;
    }

    const p = wins / n;
    const z2 = z * z;
    const denominator = 1 + z2 / n;

    const centre = p + z2 / (2 * n);
    const margin =
        z *
        Math.sqrt(
            (p * (1 - p)) / n +
            z2 / (4 * n * n),
        );

    return Math.max(
        0,
        ((centre - margin) / denominator) * 100,
    );
}

/**
 * z-score for a one-sided tail probability `alpha` (0 < alpha < 0.5), by the Abramowitz-Stegun 26.2.23
 * approximation (error below 0.0005). For example alpha 0.05 gives about 1.645.
 */
export function zOneSided(alpha: number): number {
    const a = Math.min(Math.max(alpha, 1e-12), 0.4999);
    const t = Math.sqrt(-2 * Math.log(a));
    return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
}

/**
 * Institutional Adaptive Picker. Each candidate carries a cautious win-rate estimate from paper trading (`lowerPct`).
 * Evaluates edge, house margin, and mathematical Expected Value ($EV$) before selecting the optimal contract.
 */
export function pickBestEdge(candidates: Candidate[], maxMarginPct: number, requireEvidence: boolean): Pick {
    const rows = candidates.map((c) => {
        const quote = c.side === "CALL" ? c.call : c.put;
        const margin = houseMarginPct(c.call, c.put);
        const breakeven = quote && quote.payout !== null && quote.payout > 0 ? (quote.askPrice / quote.payout) * 100 : null;
        const edge = c.lowerPct != null && breakeven !== null ? c.lowerPct - breakeven : null;

        // Calculate Expected Value based on Wilson lower bound win probability
        const winProb = c.lowerPct != null ? c.lowerPct / 100 : undefined;
        const metrics = quote ? quoteMetrics(quote, winProb) : null;

        return { c, margin, breakeven, edge, expectedValue: metrics?.expectedValue ?? null };
    });

    const qualifies = (r: (typeof rows)[number]) =>
        r.margin !== null &&
        Number.isFinite(r.margin) &&
        r.margin <= maxMarginPct &&
        r.edge !== null &&
        Number.isFinite(r.edge) &&
        r.expectedValue !== null &&
        Number.isFinite(r.expectedValue) &&
        (requireEvidence ? r.edge > 0 : r.edge >= 0) &&
        r.expectedValue >= 0; // Strict non-negative Expected Value gate

    const ok = rows
        .filter(qualifies)
        .sort(
            (a, b) =>
                (b.expectedValue as number) - (a.expectedValue as number) ||
                (a.margin as number) - (b.margin as number) ||
                b.c.strength - a.c.strength
        );
    const best = ok[0];

    if (best) {
        const label = best.c.strategyLabel ? ` via ${best.c.strategyLabel}` : "";
        const evText = best.expectedValue !== null ? ` (EV: ${best.expectedValue >= 0 ? "+" : ""}${best.expectedValue.toFixed(2)})` : "";
        return {
            chosen: best.c,
            marginPct: best.margin,
            summary:
                `Chose ${best.c.symbol} ${best.c.side === "CALL" ? "Higher" : "Lower"}${label}: cautious win rate ` +
                `${(best.c.lowerPct as number).toFixed(1)}% vs break-even ${(best.breakeven as number).toFixed(1)}% ` +
                `(edge ${(best.edge as number) >= 0 ? "+" : ""}${(best.edge as number).toFixed(1)}, margin ${(best.margin as number).toFixed(1)}%)${evText}.`,
        };
    }

    const why = rows.map((r) => {
        if (r.margin === null || r.breakeven === null) return `${r.c.symbol} no price`;
        if (r.margin > maxMarginPct) return `${r.c.symbol} margin ${r.margin.toFixed(1)}% above cap`;
        if (r.expectedValue !== null && r.expectedValue < 0) return `${r.c.symbol} negative EV (${r.expectedValue.toFixed(2)})`;
        return `${r.c.symbol} edge ${r.edge === null ? "n/a" : r.edge.toFixed(1)}`;
    });

    return {
        chosen: null,
        marginPct: null,
        summary: `No trade: ${why.join(", ") || "nothing to compare"}.`,
    };
}