import type { MarketAnalysis, StrategySignal } from "./types";

/** Deterministic, explainable signal ensemble. It proposes; it never places orders. */
export function evaluateStrategies(m: MarketAnalysis): StrategySignal[] {
  const out: StrategySignal[] = [];
  if (m.observations < 30 || m.warnings.some(w => w.startsWith("Invalid"))) return out;
  if (m.regime === "bullish" && m.emaFast !== null && m.emaSlow !== null && m.emaFast > m.emaSlow && m.momentum > 0 && (m.rsi === null || m.rsi < 75)) {
    out.push({ strategyId: "trend_momentum", side: "CALL", confidence: Math.min(95, 60 + m.trendStrength * 30), reason: "Bullish EMA alignment with positive momentum and no extreme RSI reading." });
  }
  if (m.regime === "bearish" && m.emaFast !== null && m.emaSlow !== null && m.emaFast < m.emaSlow && m.momentum < 0 && (m.rsi === null || m.rsi > 25)) {
    out.push({ strategyId: "trend_momentum", side: "PUT", confidence: Math.min(95, 60 + m.trendStrength * 30), reason: "Bearish EMA alignment with negative momentum and no extreme RSI reading." });
  }
  if (m.regime === "ranging" && m.previousRsi !== null && m.rsi !== null && m.previousRsi < 25 && m.rsi >= 25) {
    out.push({ strategyId: "rsi_reversion", side: "CALL", confidence: 72, reason: `RSI oversold recovery confirmed (${m.previousRsi.toFixed(1)} → ${m.rsi.toFixed(1)}).` });
  }
  if (m.regime === "ranging" && m.previousRsi !== null && m.rsi !== null && m.previousRsi > 75 && m.rsi <= 75) {
    out.push({ strategyId: "rsi_reversion", side: "PUT", confidence: 72, reason: `RSI overbought reversal confirmed (${m.previousRsi.toFixed(1)} → ${m.rsi.toFixed(1)}).` });
  }

  const prices = m.recentPrices;
  if (prices.length >= 22) {
    const window = prices.slice(-21, -1);
    const mean = window.reduce((a,b) => a+b, 0) / window.length;
    const variance = window.reduce((sum, value) => sum + (value-mean)**2, 0) / window.length;
    const deviation = Math.sqrt(variance);
    if (deviation > 0) {
      const previousZ = (window[window.length-1] - mean) / deviation;
      const currentMean = prices.slice(-20).reduce((a,b) => a+b, 0) / 20;
      const currentVariance = prices.slice(-20).reduce((sum,value) => sum+(value-currentMean)**2,0) / 20;
      const currentDeviation = Math.sqrt(currentVariance);
      const currentZ = currentDeviation > 0 ? (m.lastPrice-currentMean)/currentDeviation : 0;
      if (m.regime === "ranging" && previousZ <= -2 && currentZ > -2) out.push({ strategyId: "bollinger_reversion", side: "CALL", confidence: 70, reason: `Price re-entered the lower Bollinger extreme (${currentZ.toFixed(2)}σ).` });
      if (m.regime === "ranging" && previousZ >= 2 && currentZ < 2) out.push({ strategyId: "bollinger_reversion", side: "PUT", confidence: 70, reason: `Price re-entered the upper Bollinger extreme (${currentZ.toFixed(2)}σ).` });
    }
    const priorRange = prices.slice(-21, -1);
    const priorHigh = Math.max(...priorRange), priorLow = Math.min(...priorRange);
    if (m.regime === "bullish" && m.lastPrice > priorHigh && m.momentum > 0) out.push({ strategyId: "breakout", side: "CALL", confidence: Math.min(95, 65 + m.trendStrength * 30), reason: "Bullish price breakout above the recent range with positive momentum." });
    if (m.regime === "bearish" && m.lastPrice < priorLow && m.momentum < 0) out.push({ strategyId: "breakout", side: "PUT", confidence: Math.min(95, 65 + m.trendStrength * 30), reason: "Bearish price breakout below the recent range with negative momentum." });
  }
  return out.sort((a,b) => b.confidence-a.confidence);
}
