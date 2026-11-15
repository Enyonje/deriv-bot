export type MarketRegime = "bullish" | "bearish" | "ranging" | "volatile" | "unknown";
export type TradeSide = "CALL" | "PUT";
export type AgentStatus = "idle" | "analysing" | "ready" | "blocked" | "error";

export interface MarketObservation {
  symbol: string;
  prices: number[];
  timestamp: number;
}
export interface MarketAnalysis {
  symbol: string;
  regime: MarketRegime;
  lastPrice: number;
  emaFast: number | null;
  emaSlow: number | null;
  rsi: number | null;
  previousRsi: number | null;
  recentPrices: number[];
  volatility: number;
  momentum: number;
  trendStrength: number;
  observations: number;
  timestamp: number;
  warnings: string[];
}
export interface StrategySignal {
  strategyId: string;
  side: TradeSide;
  confidence: number;
  reason: string;
}
export interface TradeProposal {
  symbol: string;
  side: TradeSide;
  stake: number;
  duration: number;
  durationUnit: "t" | "s" | "m";
  strategyId: string;
  confidence: number;
  rationale: string[];
  createdAt: number;
}
export interface RiskPolicy {
  maxStake: number;
  maxSessionLoss: number;
  maxDailyLoss: number;
  maxConsecutiveLosses: number;
  maxTradesPerSession: number;
  minConfidence: number;
  allowRealAccount: boolean;
}
export interface RiskState {
  sessionPnl: number;
  dailyPnl: number;
  consecutiveLosses: number;
  tradesThisSession: number;
  accountType: "demo" | "real";
  tradingEnabled: boolean;
}
export interface RiskDecision {
  approved: boolean;
  reasons: string[];
  checkedAt: number;
}
export interface AgentDecision {
  status: "no_trade" | "approved" | "rejected";
  proposal: TradeProposal | null;
  risk: RiskDecision | null;
  analysis: MarketAnalysis;
  signals: StrategySignal[];
  summary: string;
}
