import {
    Ema,
    Rsi,
    Macd,
    Adx,
    Atr,
    BollingerBands,
    EfficiencyRatio,
    type Candle
} from "./indicators";

export type Side = "CALL" | "PUT";

export type MarketRegime =
    | "bullish"
    | "bearish"
    | "ranging"
    | "volatile"
    | "unknown";

export interface Signal {
    side: Side;
    reason: string;

    confidence?: number;
    regime?: MarketRegime;
    score?: number;
}

export interface StrategyParams {
    fastPeriod: number;
    slowPeriod: number;
    rsiPeriod: number;
    rsiOverbought: number;
    rsiOversold: number;

    minCrossoverThreshold?: number;

    minConfidence?: number;

    adxPeriod?: number;
    adxMinimum?: number;

    atrPeriod?: number;

    macdFast?: number;
    macdSlow?: number;
    macdSignal?: number;

    bollingerPeriod?: number;

    efficiencyPeriod?: number;

    volatilityMultiplier?: number;
}

export interface IndicatorView {
    fast: number | null;
    slow: number | null;
    rsi: number | null;

    momentum?: number | null;

    trendStrength?: "bullish" | "bearish" | "neutral";

    macd?: number | null;
    macdHistogram?: number | null;

    adx?: number | null;

    plusDI?: number | null;
    minusDI?: number | null;

    atr?: number | null;

    volatility?: "low" | "normal" | "high";

    efficiencyRatio?: number | null;

    regime?: MarketRegime;

    confidence?: number;
}

/**
 * AMTS Adaptive EMA RSI Strategy.
 *
 * Combines:
 * - EMA crossover
 * - RSI momentum
 * - MACD confirmation
 * - ADX trend strength
 * - ATR volatility
 * - Efficiency Ratio
 *
 * IMPORTANT:
 * EMA/RSI/MACD operate on streaming prices.
 * ADX and ATR require genuine OHLC candles.
 */

export class EmaRsiStrategy {

    private readonly fast: Ema;
    private readonly slow: Ema;
    private readonly rsi: Rsi;
    private readonly macd: Macd;

    private readonly adx: Adx;
    private readonly atr: Atr;

    private readonly bollinger: BollingerBands;
    private readonly efficiency: EfficiencyRatio;

    private prevDiff: number | null = null;

    private lastPrice: number | null = null;

    private lastCandle: Candle | null = null;

    private candleIndicatorsReady = false;

    private atrBaseline: number | null = null;

    private readonly atrHistory: number[] = [];

    private currentRegime: MarketRegime = "unknown";

    private lastSignalTick = 0;

    private ticks = 0;

    constructor(
        private readonly params: StrategyParams
    ) {

        this.validateParams();

        this.fast = new Ema(params.fastPeriod);
        this.slow = new Ema(params.slowPeriod);

        this.rsi = new Rsi(params.rsiPeriod);

        this.macd = new Macd(
            params.macdFast ?? 12,
            params.macdSlow ?? 26,
            params.macdSignal ?? 9
        );

        this.adx = new Adx(
            params.adxPeriod ?? 14
        );

        this.atr = new Atr(
            params.atrPeriod ?? 14
        );

        this.bollinger = new BollingerBands(
            params.bollingerPeriod ?? 20,
            2
        );

        this.efficiency = new EfficiencyRatio(
            params.efficiencyPeriod ?? 10
        );
    }

    private validateParams(): void {

        const p = this.params;

        if (p.fastPeriod >= p.slowPeriod) {
            throw new Error(
                "Fast EMA period must be smaller than slow EMA period"
            );
        }

        if (
            p.rsiOversold >= p.rsiOverbought ||
            p.rsiOversold < 0 ||
            p.rsiOverbought > 100
        ) {
            throw new Error("Invalid RSI thresholds");
        }

        if (
            p.minConfidence !== undefined &&
            (p.minConfidence < 0 || p.minConfidence > 100)
        ) {
            throw new Error("Invalid confidence threshold");
        }
    }

    /**
     * Feed completed OHLC candles separately.
     *
     * Never pass individual ticks as candles.
     */
    updateCandle(candle: Candle): void {

        const atr = this.atr.update(candle);

        const adx = this.adx.update(candle);

        this.lastCandle = candle;

        if (atr !== null) {

            this.atrHistory.push(atr);

            if (this.atrHistory.length > 50) {
                this.atrHistory.shift();
            }

            if (this.atrHistory.length >= 20) {

                this.atrBaseline =
                    this.atrHistory.reduce(
                        (a, b) => a + b,
                        0
                    ) / this.atrHistory.length;
            }
        }

        this.candleIndicatorsReady =
            atr !== null && adx !== null;
    }

    /**
     * Main tick-level signal engine.
     */
    update(price: number): Signal | null {

        if (!Number.isFinite(price) || price <= 0) {
            return null;
        }

        this.ticks++;

        this.lastPrice = price;

        const fast = this.fast.update(price);

        const slow = this.slow.update(price);

        const rsi = this.rsi.update(price);

        const macd = this.macd.update(price);

        const bands = this.bollinger.update(price);

        const efficiency = this.efficiency.update(price);

        if (
            fast === null ||
            slow === null ||
            rsi === null ||
            macd === null ||
            bands === null ||
            efficiency === null
        ) {
            return null;
        }

        const diff = fast - slow;

        const previousDiff = this.prevDiff;

        this.prevDiff = diff;

        if (previousDiff === null) {
            return null;
        }

        const {
            minCrossoverThreshold = 0.0001,
            minConfidence = 75,
            adxMinimum = 20
        } = this.params;

        const crossoverMagnitude =
            Math.abs(diff / slow);

        if (
            crossoverMagnitude <
            minCrossoverThreshold
        ) {
            return null;
        }

        const atr = this.atr.current;

        const adx = this.adx.current;

        const volatilityRatio =
            atr !== null &&
                this.atrBaseline !== null &&
                this.atrBaseline > 0
                ? atr / this.atrBaseline
                : 1;

        if (
            volatilityRatio >
            (this.params.volatilityMultiplier ?? 2.5)
        ) {
            this.currentRegime = "volatile";
            return null;
        }

        const trending =
            adx !== null &&
            adx.adx >= adxMinimum;

        const bullishDI =
            adx !== null &&
            adx.plusDI > adx.minusDI;

        const bearishDI =
            adx !== null &&
            adx.minusDI > adx.plusDI;

        const bullishMomentum =
            macd.histogram > 0;

        const bearishMomentum =
            macd.histogram < 0;

        const bullishTrend =
            fast > slow;

        const bearishTrend =
            fast < slow;

        if (trending && bullishDI) {
            this.currentRegime = "bullish";
        } else if (trending && bearishDI) {
            this.currentRegime = "bearish";
        } else if (efficiency < 0.20) {
            this.currentRegime = "ranging";
        } else {
            this.currentRegime = "unknown";
        }

        /**
         * Bullish crossover.
         */
        if (
            previousDiff <= 0 &&
            diff > 0
        ) {

            if (
                !trending ||
                !bullishDI ||
                !bullishMomentum ||
                !bullishTrend
            ) {
                return null;
            }

            if (
                rsi <= 50 ||
                rsi >= this.params.rsiOverbought
            ) {
                return null;
            }

            const score = this.calculateScore([
                bullishTrend,
                bullishMomentum,
                bullishDI,
                trending,
                rsi > 50 && rsi < 70,
                efficiency >= 0.20,
                volatilityRatio <= 1.8,
                bands.percentB < 1
            ]);

            if (score < minConfidence) {
                return null;
            }

            this.lastSignalTick = this.ticks;

            return {
                side: "CALL",

                confidence: score,

                score,

                regime: "bullish",

                reason:
                    `AMTS Bullish Confirmation | ` +
                    `EMA ${fast.toFixed(5)} > ${slow.toFixed(5)} | ` +
                    `RSI ${rsi.toFixed(1)} | ` +
                    `MACD ${macd.histogram.toFixed(5)} | ` +
                    `ADX ${adx?.adx.toFixed(1)} | ` +
                    `Score ${score}/100`
            };
        }

        /**
         * Bearish crossover.
         */
        if (
            previousDiff >= 0 &&
            diff < 0
        ) {

            if (
                !trending ||
                !bearishDI ||
                !bearishMomentum ||
                !bearishTrend
            ) {
                return null;
            }

            if (
                rsi >= 50 ||
                rsi <= this.params.rsiOversold
            ) {
                return null;
            }

            const score = this.calculateScore([
                bearishTrend,
                bearishMomentum,
                bearishDI,
                trending,
                rsi < 50 && rsi > 30,
                efficiency >= 0.20,
                volatilityRatio <= 1.8,
                bands.percentB > 0
            ]);

            if (score < minConfidence) {
                return null;
            }

            this.lastSignalTick = this.ticks;

            return {
                side: "PUT",

                confidence: score,

                score,

                regime: "bearish",

                reason:
                    `AMTS Bearish Confirmation | ` +
                    `EMA ${fast.toFixed(5)} < ${slow.toFixed(5)} | ` +
                    `RSI ${rsi.toFixed(1)} | ` +
                    `MACD ${macd.histogram.toFixed(5)} | ` +
                    `ADX ${adx?.adx.toFixed(1)} | ` +
                    `Score ${score}/100`
            };
        }

        return null;
    }

    private calculateScore(
        conditions: boolean[]
    ): number {

        if (conditions.length === 0) {
            return 0;
        }

        const passed =
            conditions.filter(Boolean).length;

        return Math.round(
            (passed / conditions.length) * 100
        );
    }

    get ready(): boolean {

        return (
            this.fast.ready &&
            this.slow.ready &&
            this.rsi.ready &&
            this.macd.ready
        );
    }

    view(): IndicatorView {

        const fast = this.fast.current;

        const slow = this.slow.current;

        const rsi = this.rsi.current;

        const macd = this.macd.current;

        const adx = this.adx.current;

        const atr = this.atr.current;

        const efficiency = this.lastPrice !== null
            ? null
            : null;

        let trendStrength:
            IndicatorView["trendStrength"] = "neutral";

        if (fast !== null && slow !== null) {

            if (fast > slow) {
                trendStrength = "bullish";
            } else if (fast < slow) {
                trendStrength = "bearish";
            }
        }

        let volatility:
            IndicatorView["volatility"] = "normal";

        if (this.atrBaseline !== null && atr !== null) {

            const ratio = atr / this.atrBaseline;

            if (ratio > 1.8) {
                volatility = "high";
            } else if (ratio < 0.6) {
                volatility = "low";
            }
        }

        return {

            fast,

            slow,

            rsi,

            momentum:
                fast !== null && slow !== null
                    ? fast - slow
                    : null,

            trendStrength,

            macd: macd?.macdLine ?? null,

            macdHistogram:
                macd?.histogram ?? null,

            adx: adx?.adx ?? null,

            plusDI: adx?.plusDI ?? null,

            minusDI: adx?.minusDI ?? null,

            atr,

            volatility,

            efficiencyRatio: efficiency,

            regime: this.currentRegime
        };
    }

    reset(): void {

        this.fast.reset();
        this.slow.reset();

        this.rsi.reset();
        this.macd.reset();

        this.adx.reset();
        this.atr.reset();

        this.bollinger.reset();
        this.efficiency.reset();

        this.prevDiff = null;

        this.lastPrice = null;
        this.lastCandle = null;

        this.candleIndicatorsReady = false;

        this.atrBaseline = null;
        this.atrHistory.length = 0;

        this.currentRegime = "unknown";

        this.lastSignalTick = 0;

        this.ticks = 0;
    }
}