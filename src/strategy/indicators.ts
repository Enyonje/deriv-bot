/**
 * AMTS INDICATOR ENGINE v2
 *
 * Incremental indicators for real-time trading.
 *
 * Includes:
 * - EMA
 * - RSI (Wilder)
 * - MACD
 * - ATR (Wilder)
 * - ADX / DI+ / DI-
 * - Bollinger Bands
 * - Kaufman Efficiency Ratio
 *
 * Designed for streaming market data.
 */

function validatePeriod(period: number): void {
    if (!Number.isInteger(period) || period < 1) {
        throw new Error("Indicator period must be a positive integer");
    }
}

function validatePrice(price: number): void {
    if (!Number.isFinite(price) || price <= 0) {
        throw new Error("Price must be a positive finite number");
    }
}

/* =========================================================
   EMA
========================================================= */

export class Ema {
    private value: number | null = null;
    private count = 0;
    private sum = 0;

    private readonly k: number;

    constructor(readonly period: number) {
        validatePeriod(period);
        this.k = 2 / (period + 1);
    }

    update(price: number): number | null {
        validatePrice(price);

        this.count++;

        if (this.count <= this.period) {
            this.sum += price;

            if (this.count === this.period) {
                this.value = this.sum / this.period;
            }

            return this.value;
        }

        this.value =
            price * this.k +
            this.value! * (1 - this.k);

        return this.value;
    }

    get current(): number | null {
        return this.value;
    }

    get ready(): boolean {
        return this.value !== null;
    }

    reset(): void {
        this.value = null;
        this.count = 0;
        this.sum = 0;
    }
}

/* =========================================================
   RSI - WILDER
========================================================= */

export class Rsi {
    private prev: number | null = null;

    private avgGain = 0;
    private avgLoss = 0;

    private n = 0;

    private value: number | null = null;

    constructor(readonly period: number) {
        validatePeriod(period);
    }

    update(price: number): number | null {
        validatePrice(price);

        if (this.prev === null) {
            this.prev = price;
            return null;
        }

        const change = price - this.prev;

        this.prev = price;

        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);

        this.n++;

        if (this.n <= this.period) {
            this.avgGain += gain;
            this.avgLoss += loss;

            if (this.n === this.period) {
                this.avgGain /= this.period;
                this.avgLoss /= this.period;

                this.value = this.compute();
            }

            return this.value;
        }

        this.avgGain =
            (this.avgGain * (this.period - 1) + gain) /
            this.period;

        this.avgLoss =
            (this.avgLoss * (this.period - 1) + loss) /
            this.period;

        this.value = this.compute();

        return this.value;
    }

    private compute(): number {
        if (this.avgLoss === 0) {
            return this.avgGain === 0 ? 50 : 100;
        }

        if (this.avgGain === 0) {
            return 0;
        }

        const rs = this.avgGain / this.avgLoss;

        return 100 - 100 / (1 + rs);
    }

    get current(): number | null {
        return this.value;
    }

    get ready(): boolean {
        return this.value !== null;
    }

    reset(): void {
        this.prev = null;
        this.avgGain = 0;
        this.avgLoss = 0;
        this.n = 0;
        this.value = null;
    }
}

/* =========================================================
   MACD
========================================================= */

export interface MacdResult {
    macdLine: number;
    signalLine: number;
    histogram: number;
}

export class Macd {
    private readonly fastEma: Ema;
    private readonly slowEma: Ema;
    private readonly signalEma: Ema;

    private currentMacd: MacdResult | null = null;

    constructor(
        fastPeriod = 12,
        slowPeriod = 26,
        signalPeriod = 9
    ) {
        if (fastPeriod >= slowPeriod) {
            throw new Error(
                "MACD fast period must be smaller than slow period"
            );
        }

        this.fastEma = new Ema(fastPeriod);
        this.slowEma = new Ema(slowPeriod);
        this.signalEma = new Ema(signalPeriod);
    }

    update(price: number): MacdResult | null {
        const fast = this.fastEma.update(price);
        const slow = this.slowEma.update(price);

        if (fast === null || slow === null) {
            return null;
        }

        const macdLine = fast - slow;

        const signalLine =
            this.signalEma.update(macdLine);

        if (signalLine === null) {
            return null;
        }

        const histogram = macdLine - signalLine;

        this.currentMacd = {
            macdLine,
            signalLine,
            histogram
        };

        return this.currentMacd;
    }

    get current(): MacdResult | null {
        return this.currentMacd;
    }

    get ready(): boolean {
        return this.currentMacd !== null;
    }

    reset(): void {
        this.fastEma.reset();
        this.slowEma.reset();
        this.signalEma.reset();

        this.currentMacd = null;
    }
}

/* =========================================================
   ATR - AVERAGE TRUE RANGE
========================================================= */

export interface Candle {
    high: number;
    low: number;
    close: number;
}

export class Atr {
    private previousClose: number | null = null;

    private count = 0;
    private sum = 0;

    private value: number | null = null;

    constructor(readonly period = 14) {
        validatePeriod(period);
    }

    update(candle: Candle): number | null {
        const { high, low, close } = candle;

        validatePrice(high);
        validatePrice(low);
        validatePrice(close);

        if (
            low > high ||
            close < low ||
            close > high
        ) {
            throw new Error("Invalid OHLC candle");
        }

        let trueRange: number;

        if (this.previousClose === null) {
            trueRange = high - low;
        } else {
            trueRange = Math.max(
                high - low,
                Math.abs(high - this.previousClose),
                Math.abs(low - this.previousClose)
            );
        }

        this.previousClose = close;

        this.count++;

        if (this.count <= this.period) {
            this.sum += trueRange;

            if (this.count === this.period) {
                this.value = this.sum / this.period;
            }

            return this.value;
        }

        this.value =
            (
                this.value! * (this.period - 1) +
                trueRange
            ) / this.period;

        return this.value;
    }

    get current(): number | null {
        return this.value;
    }

    get ready(): boolean {
        return this.value !== null;
    }

    reset(): void {
        this.previousClose = null;
        this.count = 0;
        this.sum = 0;
        this.value = null;
    }
}

/* =========================================================
   ADX - AVERAGE DIRECTIONAL INDEX
========================================================= */

export interface AdxResult {
    adx: number;
    plusDI: number;
    minusDI: number;
}

export class Adx {
    private previous: Candle | null = null;

    private count = 0;

    private trSum = 0;
    private plusSum = 0;
    private minusSum = 0;

    private smoothedTR = 0;
    private smoothedPlus = 0;
    private smoothedMinus = 0;

    private dxValues: number[] = [];

    private adxValue: number | null = null;

    private result: AdxResult | null = null;

    constructor(readonly period = 14) {
        validatePeriod(period);
    }

    update(candle: Candle): AdxResult | null {
        const { high, low, close } = candle;

        validatePrice(high);
        validatePrice(low);
        validatePrice(close);

        if (
            low > high ||
            close < low ||
            close > high
        ) {
            throw new Error("Invalid OHLC candle");
        }

        if (this.previous === null) {
            this.previous = candle;
            return null;
        }

        const prev = this.previous;

        const upMove = high - prev.high;
        const downMove = prev.low - low;

        const plusDM =
            upMove > downMove && upMove > 0
                ? upMove
                : 0;

        const minusDM =
            downMove > upMove && downMove > 0
                ? downMove
                : 0;

        const tr = Math.max(
            high - low,
            Math.abs(high - prev.close),
            Math.abs(low - prev.close)
        );

        this.previous = candle;

        this.count++;

        if (this.count <= this.period) {
            this.trSum += tr;
            this.plusSum += plusDM;
            this.minusSum += minusDM;

            if (this.count === this.period) {
                this.smoothedTR = this.trSum;
                this.smoothedPlus = this.plusSum;
                this.smoothedMinus = this.minusSum;
            }
        } else {
            this.smoothedTR =
                this.smoothedTR -
                this.smoothedTR / this.period +
                tr;

            this.smoothedPlus =
                this.smoothedPlus -
                this.smoothedPlus / this.period +
                plusDM;

            this.smoothedMinus =
                this.smoothedMinus -
                this.smoothedMinus / this.period +
                minusDM;
        }

        if (this.count < this.period) {
            return null;
        }

        const plusDI =
            this.smoothedTR === 0
                ? 0
                : 100 * this.smoothedPlus / this.smoothedTR;

        const minusDI =
            this.smoothedTR === 0
                ? 0
                : 100 * this.smoothedMinus / this.smoothedTR;

        const denominator = plusDI + minusDI;

        const dx =
            denominator === 0
                ? 0
                : 100 * Math.abs(plusDI - minusDI) / denominator;

        if (this.adxValue === null) {
            this.dxValues.push(dx);

            if (this.dxValues.length === this.period) {
                this.adxValue =
                    this.dxValues.reduce((a, b) => a + b, 0) /
                    this.period;
            }
        } else {
            this.adxValue =
                (
                    this.adxValue * (this.period - 1) +
                    dx
                ) / this.period;
        }

        if (this.adxValue === null) {
            return null;
        }

        this.result = {
            adx: this.adxValue,
            plusDI,
            minusDI
        };

        return this.result;
    }

    get current(): AdxResult | null {
        return this.result;
    }

    get ready(): boolean {
        return this.result !== null;
    }

    reset(): void {
        this.previous = null;

        this.count = 0;

        this.trSum = 0;
        this.plusSum = 0;
        this.minusSum = 0;

        this.smoothedTR = 0;
        this.smoothedPlus = 0;
        this.smoothedMinus = 0;

        this.dxValues = [];

        this.adxValue = null;
        this.result = null;
    }
}

/* =========================================================
   BOLLINGER BANDS
========================================================= */

export interface BollingerResult {
    upper: number;
    middle: number;
    lower: number;

    standardDeviation: number;

    percentB: number;
    bandwidth: number;

    zScore: number;
}

export class BollingerBands {
    private readonly prices: number[] = [];

    private result: BollingerResult | null = null;

    constructor(
        readonly period = 20,
        readonly multiplier = 2
    ) {
        validatePeriod(period);

        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            throw new Error("Multiplier must be positive");
        }
    }

    update(price: number): BollingerResult | null {
        validatePrice(price);

        this.prices.push(price);

        if (this.prices.length > this.period) {
            this.prices.shift();
        }

        if (this.prices.length < this.period) {
            return null;
        }

        const mean =
            this.prices.reduce((a, b) => a + b, 0) /
            this.period;

        const variance =
            this.prices.reduce(
                (sum, value) =>
                    sum + Math.pow(value - mean, 2),
                0
            ) / this.period;

        const sd = Math.sqrt(variance);

        const upper = mean + this.multiplier * sd;
        const lower = mean - this.multiplier * sd;

        const width = upper - lower;

        this.result = {
            upper,
            middle: mean,
            lower,

            standardDeviation: sd,

            percentB:
                width === 0
                    ? 0.5
                    : (price - lower) / width,

            bandwidth:
                mean === 0
                    ? 0
                    : width / Math.abs(mean),

            zScore:
                sd === 0
                    ? 0
                    : (price - mean) / sd
        };

        return this.result;
    }

    get current(): BollingerResult | null {
        return this.result;
    }

    get ready(): boolean {
        return this.result !== null;
    }

    reset(): void {
        this.prices.length = 0;
        this.result = null;
    }
}

/* =========================================================
   KAUFMAN EFFICIENCY RATIO
========================================================= */

export class EfficiencyRatio {
    private readonly prices: number[] = [];

    constructor(readonly period = 10) {
        validatePeriod(period);
    }

    update(price: number): number | null {
        validatePrice(price);

        this.prices.push(price);

        if (this.prices.length > this.period + 1) {
            this.prices.shift();
        }

        if (this.prices.length < this.period + 1) {
            return null;
        }

        const first = this.prices[0];

        const last =
            this.prices[this.prices.length - 1];

        const netMovement = Math.abs(last - first);

        let totalMovement = 0;

        for (let i = 1; i < this.prices.length; i++) {
            totalMovement += Math.abs(
                this.prices[i] - this.prices[i - 1]
            );
        }

        if (totalMovement === 0) {
            return 0;
        }

        return netMovement / totalMovement;
    }

    reset(): void {
        this.prices.length = 0;
    }
}