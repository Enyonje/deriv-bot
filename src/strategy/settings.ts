export interface BotSettings {
    // Trade
    stake: number;
    durationTicks: number;
    // Strategy
    fastPeriod: number;
    slowPeriod: number;
    rsiPeriod: number;
    rsiOverbought: number;
    rsiOversold: number;
    // Risk & Institutional Capital Management
    maxSessionLoss: number;
    sessionTakeProfit: number;
    maxConsecutiveLosses: number;
    maxTrades: number;
    cooldownSeconds: number;
    /** Reserved for a future validated sizing model; dynamic staking is currently disabled. */
    useDynamicStaking: boolean;
    /** Minimum allowed stake floor when dynamic scaling triggers */
    minStake: number;
    /** Maximum allowed stake ceiling for dynamic sizing */
    maxStake: number;
    /** Maximum allowed slippage percentage tolerance */
    maxSlippagePct: number;
}

/** Starting values for institutional trading. Fully editable before bot activation. */
export const DEFAULT_SETTINGS: BotSettings = {
    stake: 1,
    durationTicks: 5,
    fastPeriod: 9,
    slowPeriod: 21,
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
    maxSessionLoss: 20,
    sessionTakeProfit: 50,
    maxConsecutiveLosses: 3,
    maxTrades: 50,
    cooldownSeconds: 5,
    useDynamicStaking: false,
    minStake: 0.5,
    maxStake: 5.0,
    maxSlippagePct: 0.05, // 0.05% strict institutional limit
};

const isInt = (n: number) => Number.isInteger(n);

/** Validates bot settings and ensures strict institutional risk boundaries. */
export function validateSettings(s: BotSettings): string[] {
    const errors: string[] = [];
    const all = Object.values(s);
    if (all.some((v) => typeof v !== "number" && typeof v !== "boolean" || (typeof v === "number" && !Number.isFinite(v)))) {
        return ["Every setting must be a valid number or boolean flag."];
    }
    if (s.stake <= 0) errors.push("Stake must be greater than 0.");
    if (!isInt(s.durationTicks) || s.durationTicks < 1 || s.durationTicks > 10) {
        errors.push("Duration must be a whole number of ticks between 1 and 10.");
    }
    if (!isInt(s.fastPeriod) || s.fastPeriod < 2) errors.push("Fast EMA period must be a whole number of at least 2.");
    if (!isInt(s.slowPeriod) || s.slowPeriod <= s.fastPeriod) errors.push("Slow EMA period must be a whole number greater than the fast period.");
    if (!isInt(s.rsiPeriod) || s.rsiPeriod < 2) errors.push("RSI period must be a whole number of at least 2.");
    if (s.rsiOverbought <= 50 || s.rsiOverbought >= 100) errors.push("RSI overbought level must be between 50 and 100.");
    if (s.rsiOversold <= 0 || s.rsiOversold >= 50) errors.push("RSI oversold level must be between 0 and 50.");
    if (s.maxSessionLoss <= 0) errors.push("Max session loss must be greater than 0.");
    if (s.stake > s.maxSessionLoss) errors.push("Initial stake cannot exceed the maximum session loss limit.");
    if (s.sessionTakeProfit <= 0) errors.push("Session take-profit target must be greater than 0.");
    if (!isInt(s.maxConsecutiveLosses) || s.maxConsecutiveLosses < 1) errors.push("Max consecutive losses must be a whole number of at least 1.");
    if (!isInt(s.maxTrades) || s.maxTrades < 1) errors.push("Max trades quota must be a whole number of at least 1.");
    if (s.cooldownSeconds < 0) errors.push("Cooldown duration cannot be negative.");

    // Dynamic Staking & Slippage Validations
    if (s.minStake <= 0) errors.push("Minimum dynamic stake floor must be greater than 0.");
    if (s.maxStake < s.minStake) errors.push("Maximum dynamic stake ceiling cannot be lower than the minimum stake floor.");
    if (s.maxSlippagePct <= 0 || s.maxSlippagePct > 1.0) errors.push("Max slippage tolerance must be between 0.01% and 1.0%.");

    return errors;
}

// ---- Auto market selection ---------------------------------------------------------------

export type DurationUnit = "t" | "s" | "m";

export interface ScanSettings {
    universeMarket: string;
    maxSymbols: number;
    durationUnit: DurationUnit;
    duration: number;
    maxMarginPct: number;
    collectSeconds: number;
    signalMaxAgeSeconds: number;
    targetWinRatePct: number;
    minSampleTrades: number;
    adaptive: boolean;
    requireEvidence: boolean;
    minShadowTrades: number;
    confidencePct: number;
    breakevenPct: number;
    shadowWindow: number;
}

/** Starting values for institutional scanning workflows. */
export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
    universeMarket: "commodities",
    maxSymbols: 6,
    durationUnit: "m",
    duration: 1,
    maxMarginPct: 5.0, // Tighter institutional house margin cap
    collectSeconds: 3,
    signalMaxAgeSeconds: 10,
    targetWinRatePct: 70,
    minSampleTrades: 20,
    adaptive: true,
    requireEvidence: true,
    minShadowTrades: 100,
    confidencePct: 95,
    breakevenPct: 55,
    shadowWindow: 300,
};

export function validateScanSettings(s: ScanSettings): string[] {
    const errors: string[] = [];
    const nums = [
        s.maxSymbols, s.duration, s.maxMarginPct, s.collectSeconds, s.signalMaxAgeSeconds, s.targetWinRatePct, s.minSampleTrades,
        s.minShadowTrades, s.confidencePct, s.breakevenPct, s.shadowWindow,
    ];
    if (nums.some((v) => typeof v !== "number" || !Number.isFinite(v))) return ["Every auto-select setting must be a valid number."];
    if (!s.universeMarket) errors.push("Choose a market category to scan.");
    if (!isInt(s.maxSymbols) || s.maxSymbols < 1 || s.maxSymbols > 10) errors.push("Markets to watch must be a whole number from 1 to 10.");
    if (!["t", "s", "m"].includes(s.durationUnit)) errors.push("Duration unit must be ticks, seconds or minutes.");
    if (!isInt(s.duration) || s.duration < 1) errors.push("Duration must be a whole number of at least 1.");
    if (s.durationUnit === "t" && s.duration > 10) errors.push("Tick durations are limited to 10.");
    if (s.maxMarginPct <= 0 || s.maxMarginPct > 20) errors.push("Max institutional house margin must be between 0 and 20%.");
    if (s.collectSeconds < 0 || s.collectSeconds > 30) errors.push("Comparison window must be between 0 and 30 seconds.");
    if (s.signalMaxAgeSeconds < 1) errors.push("Signal max age must be at least 1 second.");
    if (s.targetWinRatePct <= 0 || s.targetWinRatePct >= 100) errors.push("Target win rate must be between 0 and 100.");
    if (!isInt(s.minSampleTrades) || s.minSampleTrades < 5) errors.push("Minimum sample must be a whole number of at least 5 trades.");
    if (!isInt(s.minShadowTrades) || s.minShadowTrades < 5) errors.push("Paper trades needed must be a whole number of at least 5.");
    if (s.confidencePct <= 50 || s.confidencePct >= 100) errors.push("Confidence must be above 50 and below 100.");
    if (s.breakevenPct <= 0 || s.breakevenPct >= 100) errors.push("Assumed break-even must be between 0 and 100.");
    if (!isInt(s.shadowWindow) || s.shadowWindow < s.minShadowTrades || s.shadowWindow > 2000) {
        errors.push("Paper-trade window must be a whole number from the 'paper trades needed' value up to 2000.");
    }
    return errors;
}