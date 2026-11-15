import { analyseMarket } from "./market-intelligence";
import { evaluateStrategies } from "./strategy-agent";
import { approveTrade } from "./risk-agent";
import type { AgentDecision, MarketObservation, RiskPolicy, RiskState } from "./types";

export interface DecisionConfig { stake: number; duration: number; durationUnit: "t" | "s" | "m"; minConfidence: number; }

/** One complete agent cycle: observe -> analyse -> strategize -> risk gate -> decision. */
export function runDecisionCycle(input: MarketObservation, config: DecisionConfig, policy: RiskPolicy, state: RiskState, now = Date.now()): AgentDecision {
  const analysis = analyseMarket(input);
  const signals = evaluateStrategies(analysis);
  const selected = signals[0];
  if (!selected) return { status: "no_trade", proposal: null, risk: null, analysis, signals, summary: "No strategy produced a qualifying signal. Continue observing; no order was sent." };
  const proposal = { symbol: input.symbol, side: selected.side, stake: config.stake, duration: config.duration, durationUnit: config.durationUnit, strategyId: selected.strategyId, confidence: selected.confidence, rationale: [selected.reason, `Market regime: ${analysis.regime}`, `Observations: ${analysis.observations}`], createdAt: now };
  const risk = approveTrade(proposal, { ...policy, minConfidence: Math.max(policy.minConfidence, config.minConfidence) }, state, now);
  return { status: risk.approved ? "approved" : "rejected", proposal, risk, analysis, signals, summary: risk.approved ? "Signal passed deterministic risk checks. Execution still requires the configured execution controller." : `Trade rejected: ${risk.reasons.join(" ")}` };
}
