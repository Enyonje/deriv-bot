import type { MarketAnalysis, MarketObservation, MarketRegime } from "./types";

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const alpha = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i++) value = alpha * values[i] + (1 - alpha) * value;
  return value;
}
function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change; else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}
export function analyseMarket(input: MarketObservation): MarketAnalysis {
  const prices = input.prices.filter(Number.isFinite);
  const warnings: string[] = [];
  const lastPrice = prices.at(-1) ?? 0;
  const fast = ema(prices, 9), slow = ema(prices, 21);
  const momentum = prices.length >= 6 ? lastPrice - prices[prices.length - 6] : 0;
  const returns = prices.slice(1).map((p, i) => p - prices[i]);
  const mean = returns.length ? returns.reduce((a,b) => a+b, 0) / returns.length : 0;
  const volatility = returns.length ? Math.sqrt(returns.reduce((s,x) => s + (x-mean)**2, 0) / returns.length) : 0;
  const path = returns.reduce((s,x) => s + Math.abs(x), 0);
  const efficiency = path ? Math.abs(lastPrice - (prices[0] ?? lastPrice)) / path : 0;
  let regime: MarketRegime = "unknown";
  if (prices.length < 21) warnings.push("Insufficient history: collect at least 21 observations.");
  else if (efficiency < 0.2) regime = "ranging";
  else if (fast !== null && slow !== null && fast > slow && momentum > 0) regime = "bullish";
  else if (fast !== null && slow !== null && fast < slow && momentum < 0) regime = "bearish";
  else regime = "volatile";
  if (prices.length < 15) warnings.push("RSI unavailable until sufficient observations are collected.");
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) warnings.push("Invalid latest market price.");
  return { symbol: input.symbol, regime, lastPrice, emaFast: fast, emaSlow: slow, rsi: rsi(prices), previousRsi: rsi(prices.slice(0, -1)), recentPrices: prices.slice(-40), volatility, momentum, trendStrength: Math.max(0, Math.min(1, efficiency)), observations: prices.length, timestamp: input.timestamp, warnings };
}
