import { NextResponse } from "next/server";
import { TradingOrchestrator } from "@/agents/orchestrator";
import type { MarketObservation, RiskPolicy, RiskState } from "@/agents/types";
import { isSameOrigin } from "@/lib/http";

const number = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const b = body as Record<string, unknown>;
  if (typeof b.symbol !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(b.symbol)) return NextResponse.json({ error: "Invalid market symbol." }, { status: 400 });
  if (!Array.isArray(b.prices) || b.prices.length < 1 || b.prices.length > 1000 || !b.prices.every(x => number(x, Number.MIN_VALUE))) return NextResponse.json({ error: "Prices must contain 1–1000 positive finite values." }, { status: 400 });
  const stake = b.stake ?? 1, duration = b.duration ?? 5, minConfidence = b.minConfidence ?? 70;
  if (!number(stake, 0.01, 100000) || !number(duration, 1, 10000) || !number(minConfidence, 0, 100)) return NextResponse.json({ error: "Invalid decision configuration." }, { status: 400 });
  const accountType = b.accountType === "real" ? "real" : b.accountType === "demo" ? "demo" : null;
  if (!accountType) return NextResponse.json({ error: "Account type must be demo or real." }, { status: 400 });
  const policy: RiskPolicy = { maxStake: 5, maxSessionLoss: 20, maxDailyLoss: 30, maxConsecutiveLosses: 3, maxTradesPerSession: 50, minConfidence, allowRealAccount: false };
  const state: RiskState = { sessionPnl: 0, dailyPnl: 0, consecutiveLosses: 0, tradesThisSession: 0, accountType, tradingEnabled: true };
  const observation: MarketObservation = { symbol: b.symbol, prices: b.prices as number[], timestamp: Date.now() };
  const orchestrator = new TradingOrchestrator({ stake, duration, durationUnit: "t", minConfidence }, policy);
  const result = orchestrator.evaluate(observation, state);
  return NextResponse.json({ ...result, execution: "not_requested", riskContext: "preview_only" }, { headers: { "Cache-Control": "no-store" } });
}
