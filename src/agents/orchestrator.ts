import { runDecisionCycle, type DecisionConfig } from "./decision-agent";
import type { MarketObservation, RiskPolicy, RiskState, AgentDecision } from "./types";

/**
 * Synchronous orchestrator for one market observation. Scheduling, persistence and
 * Deriv order transport remain in the application layer. This module never buys/sells.
 */
export class TradingOrchestrator {
  constructor(private readonly config: DecisionConfig, private readonly policy: RiskPolicy) {}
  evaluate(observation: MarketObservation, state: RiskState, now = Date.now()): AgentDecision {
    return runDecisionCycle(observation, this.config, this.policy, state, now);
  }
}
