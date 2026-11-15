import { Rsi } from "./indicators";
import {
    type Side,
    type Signal,
    type StrategyParams
} from "./strategy";

export type StrategyId =
    | "ema_rsi"
    | "rsi_reversion"
    | "bollinger_reversion"
    | "breakout";

export const ALL_STRATEGY_IDS: StrategyId[] = [
    "ema_rsi",
    "rsi_reversion",
    "bollinger_reversion",
    "breakout"
];

export const STRATEGY_LABELS: Record<StrategyId, string> = {
    ema_rsi: "Adaptive EMA + RSI Momentum",
    rsi_reversion: "Confirmed RSI Mean Reversion",
    bollinger_reversion: "Adaptive Bollinger Reversion",
    breakout: "Confirmed Momentum Breakout"
};

const MIN_SAMPLES_FOR_QUALIFICATION = 100;
const WILSON_Z = 1.96;

const MIN_SIGNAL_CONFIDENCE = 70;
const MAX_VOLATILITY_RATIO = 3.0;

type Zone = -1 | 0 | 1;

type MarketRegime =
    | "bullish"
    | "bearish"
    | "ranging"
    | "volatile"
    | "unknown";

export interface PoolSignal {
    strategyId: StrategyId;
    side: Side;
    reason: string;
    confidence: number;
    regime: MarketRegime;
}

export interface StrategyPerformanceMetrics {
    strategyId: StrategyId;
    label: string;
    trades: number;
    wins: number;
    winRatePct: number | null;
    lowerBoundPct: number | null;
    status: "collecting" | "qualified" | "below_breakeven";
}

interface PoolStrategy {
    readonly id: StrategyId;
    update(price: number, market: MarketContext): Signal | null;
}

interface MarketContext {
    regime: MarketRegime;
    emaFast: number;
    emaSlow: number;
    rsi: number | null;
    volatility: number;
    volatilityRatio: number;
    momentum: number;
    efficiency: number;
    prices: number[];
}

function calculateEMA(values: number[], period: number): number {
    if (values.length === 0) return 0;

    const k = 2 / (period + 1);

    let ema = values[0];

    for (let i = 1; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }

    return ema;
}

function calculateVolatility(values: number[]): number {
    if (values.length < 2) return 0;

    const returns: number[] = [];

    for (let i = 1; i < values.length; i++) {
        returns.push(values[i] - values[i - 1]);
    }

    const mean =
        returns.reduce((a, b) => a + b, 0) / returns.length;

    const variance =
        returns.reduce(
            (sum, value) => sum + Math.pow(value - mean, 2),
            0
        ) / returns.length;

    return Math.sqrt(variance);
}

function calculateEfficiency(values: number[]): number {
    if (values.length < 3) return 0;

    const netMovement = Math.abs(
        values[values.length - 1] - values[0]
    );

    let totalMovement = 0;

    for (let i = 1; i < values.length; i++) {
        totalMovement += Math.abs(values[i] - values[i - 1]);
    }

    if (totalMovement === 0) return 0;

    return netMovement / totalMovement;
}

function calculateMomentum(values: number[]): number {
    if (values.length < 6) return 0;

    const recent = values[values.length - 1];
    const previous = values[values.length - 6];

    return recent - previous;
}

function classifyMarket(
    fast: number,
    slow: number,
    volatility: number,
    averageVolatility: number,
    efficiency: number
): MarketRegime {

    if (
        averageVolatility > 0 &&
        volatility / averageVolatility > MAX_VOLATILITY_RATIO
    ) {
        return "volatile";
    }

    if (efficiency < 0.20) {
        return "ranging";
    }

    if (fast > slow && efficiency >= 0.25) {
        return "bullish";
    }

    if (fast < slow && efficiency >= 0.25) {
        return "bearish";
    }

    return "unknown";
}

function calculateConfidence(
    conditions: boolean[]
): number {
    if (conditions.length === 0) return 0;

    const passed = conditions.filter(Boolean).length;

    return Math.round((passed / conditions.length) * 100);
}

/**
 * Shared adaptive market analysis.
 */
class MarketAnalyzer {
    private readonly prices: number[] = [];

    constructor(
        private readonly fastPeriod: number,
        private readonly slowPeriod: number
    ) { }

    update(price: number): MarketContext {
        this.prices.push(price);

        const maxWindow = Math.max(
            this.slowPeriod * 3,
            100
        );

        if (this.prices.length > maxWindow) {
            this.prices.shift();
        }

        const fast = calculateEMA(
            this.prices,
            this.fastPeriod
        );

        const slow = calculateEMA(
            this.prices,
            this.slowPeriod
        );

        const volatility = calculateVolatility(
            this.prices.slice(-20)
        );

        const averageVolatility = calculateVolatility(
            this.prices.slice(-Math.min(80, this.prices.length))
        );

        const efficiency = calculateEfficiency(
            this.prices.slice(-20)
        );

        const momentum = calculateMomentum(
            this.prices
        );

        const volatilityRatio =
            averageVolatility > 0
                ? volatility / averageVolatility
                : 1;

        const regime = classifyMarket(
            fast,
            slow,
            volatility,
            averageVolatility,
            efficiency
        );

        return {
            regime,
            emaFast: fast,
            emaSlow: slow,
            rsi: null,
            volatility,
            volatilityRatio,
            momentum,
            efficiency,
            prices: [...this.prices]
        };
    }
}

/**
 * Strategy 1:
 * Adaptive EMA + RSI.
 *
 * Only accepts momentum signals aligned with
 * the broader market direction.
 */
class EmaRsiPool implements PoolStrategy {
    readonly id = "ema_rsi" as const;
    private readonly rsi: Rsi;
    private lastSignalSide: Side | null = null;

    constructor(private readonly params: StrategyParams) {
        this.rsi = new Rsi(params.rsiPeriod);
    }

    update(price: number, market: MarketContext): Signal | null {
        const rsi = this.rsi.update(price);
        if (rsi === null || market.volatilityRatio > 2) return null;

        if (market.regime === "bullish" && market.emaFast > market.emaSlow && market.momentum > 0 && rsi > 50 && rsi <= this.params.rsiOverbought) {
            if (this.lastSignalSide === "CALL") return null;
            this.lastSignalSide = "CALL";
            return { side: "CALL", reason: `Trend-confirmed EMA/RSI bullish alignment (RSI ${rsi.toFixed(1)})` };
        }
        if (market.regime === "bearish" && market.emaFast < market.emaSlow && market.momentum < 0 && rsi < 50 && rsi >= this.params.rsiOversold) {
            if (this.lastSignalSide === "PUT") return null;
            this.lastSignalSide = "PUT";
            return { side: "PUT", reason: `Trend-confirmed EMA/RSI bearish alignment (RSI ${rsi.toFixed(1)})` };
        }
        if (market.regime === "ranging" || market.regime === "unknown") this.lastSignalSide = null;
        return null;
    }
}

/**
 * Strategy 2:
 * Confirmed RSI mean reversion.
 *
 * Does not enter simply because RSI becomes oversold.
 * Waits for RSI to recover through the threshold.
 */
class RsiReversion implements PoolStrategy {
    readonly id = "rsi_reversion" as const;

    private readonly rsi: Rsi;

    private previousRsi: number | null = null;

    constructor(private readonly params: StrategyParams) {
        this.rsi = new Rsi(params.rsiPeriod);
    }

    update(
        price: number,
        market: MarketContext
    ): Signal | null {

        const r = this.rsi.update(price);

        if (r === null) return null;

        const previous = this.previousRsi;

        this.previousRsi = r;

        if (market.regime !== "ranging") return null;

        if (market.volatilityRatio > 1.8) return null;

        if (previous === null) return null;

        // Oversold recovery confirmation.
        if (
            previous < this.params.rsiOversold &&
            r >= this.params.rsiOversold
        ) {
            return {
                side: "CALL",
                reason: `RSI oversold recovery confirmed (${r.toFixed(1)})`
            };
        }

        // Overbought reversal confirmation.
        if (
            previous > this.params.rsiOverbought &&
            r <= this.params.rsiOverbought
        ) {
            return {
                side: "PUT",
                reason: `RSI overbought recovery confirmed (${r.toFixed(1)})`
            };
        }

        return null;
    }
}

/**
 * Strategy 3:
 * Adaptive Bollinger mean reversion.
 */
class BollingerReversion implements PoolStrategy {
    readonly id = "bollinger_reversion" as const;

    private readonly window: number[] = [];

    private readonly period: number;

    private readonly multiplier = 2.0;

    private previousZ = 0;

    constructor(period: number) {
        this.period = period;
    }

    update(
        price: number,
        market: MarketContext
    ): Signal | null {

        this.window.push(price);

        if (this.window.length > this.period) {
            this.window.shift();
        }

        if (this.window.length < this.period) {
            return null;
        }

        if (market.regime !== "ranging") {
            this.previousZ = 0;
            return null;
        }

        if (market.volatilityRatio > 1.8) {
            this.previousZ = 0;
            return null;
        }

        const mean =
            this.window.reduce((a, b) => a + b, 0) /
            this.period;

        const variance =
            this.window.reduce(
                (sum, value) =>
                    sum + Math.pow(value - mean, 2),
                0
            ) / this.period;

        const sd = Math.sqrt(variance);

        if (sd === 0) return null;

        const z = (price - mean) / sd;

        const previous = this.previousZ;

        this.previousZ = z;

        // Require price to re-enter the extreme zone.
        if (
            previous <= -this.multiplier &&
            z > -this.multiplier
        ) {
            return {
                side: "CALL",
                reason: `Bullish Bollinger re-entry (${z.toFixed(2)}σ)`
            };
        }

        if (
            previous >= this.multiplier &&
            z < this.multiplier
        ) {
            return {
                side: "PUT",
                reason: `Bearish Bollinger re-entry (${z.toFixed(2)}σ)`
            };
        }

        return null;
    }
}

/**
 * Strategy 4:
 * Confirmed breakout.
 *
 * Requires a breakout and momentum confirmation.
 */
class Breakout implements PoolStrategy {
    readonly id = "breakout" as const;

    private readonly window: number[] = [];

    private readonly period: number;

    private previousPrice: number | null = null;

    constructor(period: number) {
        this.period = period;
    }

    update(
        price: number,
        market: MarketContext
    ): Signal | null {

        if (this.window.length < this.period) {
            this.window.push(price);
            this.previousPrice = price;
            return null;
        }

        const high = Math.max(...this.window);
        const low = Math.min(...this.window);

        const previous = this.previousPrice;

        this.previousPrice = price;

        let signal: Signal | null = null;

        if (
            market.regime === "bullish" &&
            price > high &&
            previous !== null &&
            market.momentum > 0 &&
            market.volatilityRatio < 2
        ) {
            signal = {
                side: "CALL",
                reason: `Confirmed bullish ${this.period}-tick breakout`
            };
        }

        if (
            market.regime === "bearish" &&
            price < low &&
            previous !== null &&
            market.momentum < 0 &&
            market.volatilityRatio < 2
        ) {
            signal = {
                side: "PUT",
                reason: `Confirmed bearish ${this.period}-tick breakout`
            };
        }

        this.window.push(price);

        if (this.window.length > this.period) {
            this.window.shift();
        }

        return signal;
    }
}

/**
 * Adaptive Strategy Pool.
 *
 * Runs four independent strategies against
 * a shared market-analysis engine.
 */
export class PoolTracker {
    private readonly strategies: PoolStrategy[];

    private readonly analyzer: MarketAnalyzer;

    private ticks = 0;

    private last: number | null = null;

    private readonly warmup: number;

    private currentMarket: MarketContext | null = null;

    private readonly performanceLedger = new Map<
        StrategyId,
        { trades: number; wins: number }
    >();

    constructor(
        readonly symbol: string,
        params: StrategyParams
    ) {
        this.analyzer = new MarketAnalyzer(
            params.rsiPeriod,
            params.slowPeriod
        );

        this.strategies = [
            new EmaRsiPool(params),
            new RsiReversion(params),
            new BollingerReversion(params.slowPeriod),
            new Breakout(params.slowPeriod)
        ];

        this.warmup =
            Math.max(
                params.slowPeriod * 3,
                params.rsiPeriod * 2
            );

        for (const strategy of this.strategies) {
            this.performanceLedger.set(
                strategy.id,
                { trades: 0, wins: 0 }
            );
        }
    }

    get ids(): StrategyId[] {
        return this.strategies.map(strategy => strategy.id);
    }

    get ready(): boolean {
        return this.ticks >= this.warmup;
    }

    get lastPrice(): number | null {
        return this.last;
    }

    get regime(): MarketRegime {
        return this.currentMarket?.regime ?? "unknown";
    }

    recordOutcome(
        strategyId: StrategyId,
        won: boolean
    ): void {

        const stats = this.performanceLedger.get(strategyId);

        if (!stats) return;

        stats.trades++;

        if (won) {
            stats.wins++;
        }
    }

    private calculateWilsonLowerBound(
        wins: number,
        trades: number
    ): number {

        if (trades === 0) return 0;

        const p = wins / trades;

        const z = WILSON_Z;

        const z2 = z * z;

        const denominator = 1 + z2 / trades;

        const center =
            p + z2 / (2 * trades);

        const adjustment =
            z *
            Math.sqrt(
                (
                    p * (1 - p) +
                    z2 / (4 * trades)
                ) / trades
            );

        return Math.max(
            0,
            (center - adjustment) / denominator
        );
    }

    getMetrics(): StrategyPerformanceMetrics[] {

        const metrics: StrategyPerformanceMetrics[] = [];

        for (const [id, stats] of this.performanceLedger) {

            const winRate =
                stats.trades > 0
                    ? stats.wins / stats.trades
                    : null;

            const lowerBound =
                stats.trades >= MIN_SAMPLES_FOR_QUALIFICATION
                    ? this.calculateWilsonLowerBound(
                        stats.wins,
                        stats.trades
                    )
                    : null;

            let status: StrategyPerformanceMetrics["status"] =
                "collecting";

            if (stats.trades >= MIN_SAMPLES_FOR_QUALIFICATION) {

                status =
                    winRate !== null &&
                        winRate >= 0.60 &&
                        lowerBound !== null &&
                        lowerBound >= 0.50
                        ? "qualified"
                        : "below_breakeven";
            }

            metrics.push({
                strategyId: id,
                label: STRATEGY_LABELS[id],
                trades: stats.trades,
                wins: stats.wins,

                winRatePct:
                    winRate !== null
                        ? Math.round(winRate * 1000) / 10
                        : null,

                lowerBoundPct:
                    lowerBound !== null
                        ? Math.round(lowerBound * 1000) / 10
                        : null,

                status
            });
        }

        return metrics.sort((a, b) => {
            return (
                (b.lowerBoundPct ?? 0) -
                (a.lowerBoundPct ?? 0)
            );
        });
    }

    update(price: number): PoolSignal[] {

        if (!Number.isFinite(price) || price <= 0) {
            return [];
        }

        this.ticks++;

        this.last = price;

        const market = this.analyzer.update(price);

        this.currentMarket = market;

        const output: PoolSignal[] = [];
        const marketIsVolatile = market.regime === "volatile";

        // Keep each strategy's indicator state warm from the first tick.
        // Suppress emitted signals until the shared market analyzer is ready.
        for (const strategy of this.strategies) {
            const signal = strategy.update(price, market);
            if (!signal || !this.ready || marketIsVolatile) continue;

            const meanReversion = strategy.id === "rsi_reversion" || strategy.id === "bollinger_reversion";
            const regimeConfirmed = meanReversion
                ? market.regime === "ranging"
                : market.efficiency >= 0.20;
            const confidence = calculateConfidence([
                market.volatilityRatio < 2,
                regimeConfirmed,
                signal.side === "CALL"
                    ? market.momentum > 0
                    : market.momentum < 0
            ]);

            if (confidence < MIN_SIGNAL_CONFIDENCE) {
                continue;
            }

            output.push({
                strategyId: strategy.id,
                side: signal.side,
                reason: signal.reason,
                confidence,
                regime: market.regime
            });
        }

        return output;
    }
}