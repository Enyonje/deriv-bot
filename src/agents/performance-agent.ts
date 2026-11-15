export interface ClosedTrade { profit: number; stake: number; strategyId: string; closedAt: number; }
export interface PerformanceReport { trades: number; wins: number; losses: number; winRatePct: number | null; netPnl: number; profitFactor: number | null; maxDrawdown: number; byStrategy: Record<string, { trades: number; wins: number; pnl: number }>; }
/** Read-only analytics. It does not mutate or optimize live strategy parameters. */
export function buildPerformanceReport(trades: ClosedTrade[]): PerformanceReport {
  let validTrades=0, wins=0, losses=0, grossWin=0, grossLoss=0, pnl=0, peak=0, maxDrawdown=0;
  const byStrategy: PerformanceReport["byStrategy"] = {};
  for (const t of trades) {
    if (!Number.isFinite(t.profit) || !Number.isFinite(t.stake) || t.stake <= 0) continue;
    validTrades++;
    pnl += t.profit; peak = Math.max(peak, pnl); maxDrawdown = Math.max(maxDrawdown, peak-pnl);
    if (t.profit > 0) { wins++; grossWin += t.profit; } else if (t.profit < 0) { losses++; grossLoss += Math.abs(t.profit); }
    const row = byStrategy[t.strategyId] ?? (byStrategy[t.strategyId] = { trades: 0, wins: 0, pnl: 0 });
    row.trades++; row.pnl += t.profit; if (t.profit > 0) row.wins++;
  }
  const count = wins + losses;
  return { trades: validTrades, wins, losses, winRatePct: count ? wins/count*100 : null, netPnl: pnl, profitFactor: grossLoss ? grossWin/grossLoss : null, maxDrawdown, byStrategy };
}
