"use client";
import { useMemo } from "react";
import { analyseMarket } from "@/agents/market-intelligence";
import { evaluateStrategies } from "@/agents/strategy-agent";

export default function AgentInsightPanel({ symbol, prices }: { symbol: string; prices: number[] }) {
  const analysis = useMemo(() => analyseMarket({ symbol, prices, timestamp: Date.now() }), [symbol, prices]);
  const signals = useMemo(() => evaluateStrategies(analysis), [analysis]);
  const regime = analysis.regime.replace("_", " ");
  return <section aria-labelledby="agent-insights" className="w-full max-w-3xl rounded-2xl border border-cyan-900/60 bg-slate-900 p-5 shadow-lg">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-cyan-300">Agentic intelligence</p><h2 id="agent-insights" className="mt-1 text-xl font-bold text-white">Market analysis agent</h2></div><span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold capitalize text-cyan-200">{regime}</span></div>
    <p className="mt-2 text-xs text-slate-400">Explainable, rule-based analysis of the live price stream. This panel does not place orders.</p>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
      ["Observations", String(analysis.observations)],
      ["Fast EMA", analysis.emaFast === null ? "Warming up" : analysis.emaFast.toFixed(4)],
      ["Slow EMA", analysis.emaSlow === null ? "Warming up" : analysis.emaSlow.toFixed(4)],
      ["RSI", analysis.rsi === null ? "—" : analysis.rsi.toFixed(1)],
    ].map(([label,value])=><div key={label} className="rounded-lg border border-slate-800 bg-slate-950 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 break-all text-sm font-semibold text-slate-100">{value}</p></div>)}</div>
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Strategy agent</h3><span className="text-xs text-slate-500">{signals.length} candidate(s)</span></div>{signals.length ? <div className="mt-3 space-y-2">{signals.map((signal,i)=><div key={`${signal.strategyId}-${i}`} className="rounded-lg border border-slate-800 p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{signal.strategyId.replaceAll("_"," ")}</span><span className={`rounded px-2 py-1 text-xs font-bold ${signal.side==="CALL"?"bg-emerald-500/10 text-emerald-300":"bg-rose-500/10 text-rose-300"}`}>{signal.side} · {signal.confidence.toFixed(0)}%</span></div><p className="mt-2 text-xs leading-5 text-slate-400">{signal.reason}</p></div>)}</div> : <p className="mt-3 text-sm text-slate-400">{analysis.observations < 30 ? "Collecting market history. At least 30 observations are required before the strategy agent evaluates a signal." : "No strategy currently qualifies. The agent will continue observing."}</p>}</div>
    {analysis.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-300">{analysis.warnings.map(w=><li key={w}>{w}</li>)}</ul>}
    <p className="mt-3 text-[11px] leading-5 text-slate-500">Signals are not predictions or trade instructions. Existing execution and risk controls remain separate; no order is submitted by this intelligence panel.</p>
  </section>;
}
