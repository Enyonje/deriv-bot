import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyseMarket } from "../src/agents/market-intelligence";
import { approveTrade } from "../src/agents/risk-agent";
import { runDecisionCycle } from "../src/agents/decision-agent";
import { buildPerformanceReport } from "../src/agents/performance-agent";
import type { RiskPolicy, RiskState, TradeProposal } from "../src/agents/types";

const policy: RiskPolicy = { maxStake: 2, maxSessionLoss: 10, maxDailyLoss: 15, maxConsecutiveLosses: 3, maxTradesPerSession: 10, minConfidence: 60, allowRealAccount: false };
const state: RiskState = { sessionPnl: 0, dailyPnl: 0, consecutiveLosses: 0, tradesThisSession: 0, accountType: "demo", tradingEnabled: true };
const proposal: TradeProposal = { symbol: "R_100", side: "CALL", stake: 1, duration: 5, durationUnit: "t", strategyId: "trend_momentum", confidence: 80, rationale: ["test"], createdAt: 1000 };

describe("agentic decision pipeline", () => {
  it("analyses a valid market observation and reports sample count", () => {
    const prices = Array.from({length: 50}, (_, i) => 100 + i * 0.2 + Math.sin(i) * 0.03);
    const result = analyseMarket({ symbol: "R_100", prices, timestamp: 1000 });
    assert.equal(result.observations, 50);
    assert.ok(["bullish", "bearish", "ranging", "volatile", "unknown"].includes(result.regime));
    assert.ok(Number.isFinite(result.lastPrice));
  });
  it("rejects a stake above the hard maximum", () => {
    const result = approveTrade({ ...proposal, stake: 3 }, policy, state, 1000);
    assert.equal(result.approved, false);
    assert.ok(result.reasons.some(r => r.includes("maximum")));
  });
  it("rejects real-account execution when policy does not allow it", () => {
    const result = approveTrade(proposal, policy, { ...state, accountType: "real" }, 1000);
    assert.equal(result.approved, false);
    assert.ok(result.reasons.some(r => r.includes("Real-account")));
  });
  it("rejects a proposal that would breach the daily loss limit", () => {
    const result = approveTrade(proposal, policy, { ...state, dailyPnl: -14.5 }, 1000);
    assert.equal(result.approved, false);
    assert.ok(result.reasons.some(r => r.includes("daily loss limit")));
  });
  it("rejects a stale proposal", () => {
    const result = approveTrade(proposal, policy, state, 40000);
    assert.equal(result.approved, false);
    assert.ok(result.reasons.some(r => r.includes("stale")));
  });
  it("returns a no-trade result while history is insufficient", () => {
    const result = runDecisionCycle({ symbol: "R_100", prices: [100, 101], timestamp: 1000 }, { stake: 1, duration: 5, durationUnit: "t", minConfidence: 60 }, policy, state, 1000);
    assert.equal(result.status, "no_trade");
    assert.equal(result.proposal, null);
  });
});
describe("performance agent", () => {
  it("computes win rate, net PnL and drawdown", () => {
    const report = buildPerformanceReport([
      { profit: 2, stake: 1, strategyId: "trend", closedAt: 1 },
      { profit: -1, stake: 1, strategyId: "trend", closedAt: 2 },
      { profit: 1, stake: 1, strategyId: "reversion", closedAt: 3 },
      { profit: 100, stake: 0, strategyId: "invalid", closedAt: 4 },
    ]);
    assert.equal(report.winRatePct, 2 / 3 * 100);
    assert.equal(report.netPnl, 2);
    assert.equal(report.trades, 3);
    assert.equal(report.profitFactor, 3);
    assert.equal(report.maxDrawdown, 1);
    assert.equal(report.byStrategy.trend.trades, 2);
  });
});
