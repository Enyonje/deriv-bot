import type { RiskDecision, RiskPolicy, RiskState, TradeProposal } from "./types";

/** Independent hard gate. A strategy or language model cannot override these checks. */
export function approveTrade(proposal: TradeProposal, policy: RiskPolicy, state: RiskState, now = Date.now()): RiskDecision {
  const reasons: string[] = [];
  const policyNumbers = [policy.maxStake, policy.maxSessionLoss, policy.maxDailyLoss, policy.maxConsecutiveLosses, policy.maxTradesPerSession, policy.minConfidence];
  const stateNumbers = [state.sessionPnl, state.dailyPnl, state.consecutiveLosses, state.tradesThisSession];
  if (policyNumbers.some(value => !Number.isFinite(value)) || policy.maxStake <= 0 || policy.maxSessionLoss <= 0 || policy.maxDailyLoss <= 0 || !Number.isInteger(policy.maxConsecutiveLosses) || policy.maxConsecutiveLosses < 1 || !Number.isInteger(policy.maxTradesPerSession) || policy.maxTradesPerSession < 1 || policy.minConfidence < 0 || policy.minConfidence > 100) reasons.push("Risk policy is invalid; fail-closed approval required.");
  if (stateNumbers.some(value => !Number.isFinite(value)) || !Number.isInteger(state.consecutiveLosses) || state.consecutiveLosses < 0 || !Number.isInteger(state.tradesThisSession) || state.tradesThisSession < 0) reasons.push("Risk state is invalid; fail-closed approval required.");
  if (!state.tradingEnabled) reasons.push("Trading is paused or disabled.");
  if (!Number.isFinite(proposal.stake) || proposal.stake <= 0) reasons.push("Stake must be a positive finite number.");
  if (proposal.stake > policy.maxStake) reasons.push("Stake exceeds the configured maximum.");
  if (proposal.stake > policy.maxSessionLoss + state.sessionPnl) reasons.push("Potential next-trade loss would breach the session loss limit.");
  if (state.sessionPnl <= -policy.maxSessionLoss) reasons.push("Session loss limit reached.");
  if (state.dailyPnl <= -policy.maxDailyLoss) reasons.push("Daily loss limit reached.");
  if (state.dailyPnl - proposal.stake < -policy.maxDailyLoss) reasons.push("Potential next-trade loss would breach the daily loss limit.");
  if (state.consecutiveLosses >= policy.maxConsecutiveLosses) reasons.push("Consecutive-loss circuit breaker is active.");
  if (state.tradesThisSession >= policy.maxTradesPerSession) reasons.push("Maximum trades per session reached.");
  if (state.accountType === "real" && !policy.allowRealAccount) reasons.push("Real-account execution is not enabled by policy.");
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < policy.minConfidence) reasons.push("Signal confidence is below the configured threshold.");
  if (!proposal.symbol || !/^[A-Za-z0-9_]+$/.test(proposal.symbol)) reasons.push("Invalid market symbol.");
  if (!Number.isFinite(proposal.duration) || proposal.duration <= 0) reasons.push("Invalid contract duration.");
  if (proposal.createdAt > now + 1000 || now - proposal.createdAt > 30_000) reasons.push("Trade proposal is stale or has an invalid timestamp.");
  return { approved: reasons.length === 0, reasons, checkedAt: now };
}
