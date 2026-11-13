/** Pure helpers for Deriv's `active_symbols` response (new API field names). */

export interface MarketSymbol {
    symbol: string;
    name: string;
    market: string;
    submarket: string | null;
    tradable: boolean;
}

export interface MarketGroup {
    market: string;
    label: string;
    items: MarketSymbol[];
}

const SYMBOL_RE = /^[A-Za-z0-9_]{1,32}$/;

/** Turns "commodities" / "synthetic_index" into "Commodities" / "Synthetic Index". */
export function marketLabel(market: string): string {
    return market
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/** Skips malformed entries and duplicates. A symbol is tradable when its exchange is open and it is not suspended. */
export function parseActiveSymbols(raw: unknown): MarketSymbol[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: MarketSymbol[] = [];
    for (const row of raw) {
        const symbol = row?.underlying_symbol;
        if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol) || seen.has(symbol)) continue;
        seen.add(symbol);
        const market = typeof row.market === "string" && row.market ? row.market : "other";
        out.push({
            symbol,
            name: typeof row.underlying_symbol_name === "string" && row.underlying_symbol_name ? row.underlying_symbol_name : symbol,
            market,
            submarket: typeof row.submarket === "string" ? row.submarket : null,
            tradable: Number(row.exchange_is_open ?? 1) !== 0 && Number(row.is_trading_suspended ?? 0) !== 1,
        });
    }
    return out;
}

export function groupByMarket(symbols: MarketSymbol[]): MarketGroup[] {
    const groups = new Map<string, MarketSymbol[]>();
    for (const s of symbols) {
        const list = groups.get(s.market) ?? [];
        list.push(s);
        groups.set(s.market, list);
    }
    return [...groups.entries()]
        .map(([market, items]) => ({
            market,
            label: marketLabel(market),
            items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}