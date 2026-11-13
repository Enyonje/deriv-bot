import { wilsonLowerPct } from "./scanner";
import type { DurationUnit } from "./settings";
import type { Side } from "./strategy";

export interface ShadowConfig {
    unit: DurationUnit;
    duration: number;
    /** Only the most recent `window` results per key are kept. */
    window: number;
}

export interface ShadowState {
    version: 1;
    results: Record<string, boolean[]>;
}

interface PendingShadow {
    side: Side;
    entry: number;
    epoch: number;
    ticks: number;
}

export interface ShadowStats {
    n: number;
    wins: number;
    winRatePct: number | null;
    lowerPct: number | null;
}

/**
 * Paper trades: records what a strategy's signal WOULD have done over the contract duration, without
 * spending anything. A key is "market|strategy". Only one paper trade per key is open at a time, so
 * overlapping trades don't inflate the sample. Higher wins if the exit is above the entry, Lower if
 * below; an equal exit is a loss, as on Deriv.
 * Approximation: entry is the signal tick, whereas a real contract starts on the next tick.
 */
export class ShadowBook {
    private readonly pending = new Map<string, PendingShadow>();
    private readonly results = new Map<string, boolean[]>();

    constructor(private readonly cfg: ShadowConfig, state?: ShadowState | null) {
        if (state?.version === 1 && state.results) {
            for (const [key, list] of Object.entries(state.results)) {
                if (Array.isArray(list)) this.results.set(key, list.filter((x) => typeof x === "boolean").slice(-cfg.window));
            }
        }
    }

    /** Opens a paper trade unless one is already running for this key. */
    open(key: string, side: Side, price: number, epoch: number): boolean {
        if (this.pending.has(key)) return false;
        this.pending.set(key, { side, entry: price, epoch, ticks: 0 });
        return true;
    }

    /** Feed every tick of the key's market. Returns true when a paper trade settled on this tick. */
    onTick(key: string, price: number, epoch: number): boolean {
        const p = this.pending.get(key);
        if (!p) return false;
        p.ticks++;
        const seconds = this.cfg.unit === "m" ? this.cfg.duration * 60 : this.cfg.duration;
        const due = this.cfg.unit === "t" ? p.ticks >= this.cfg.duration : epoch - p.epoch >= seconds;
        if (!due) return false;

        const win = p.side === "CALL" ? price > p.entry : price < p.entry;
        const list = this.results.get(key) ?? [];
        list.push(win);
        while (list.length > this.cfg.window) list.shift();
        this.results.set(key, list);
        this.pending.delete(key);
        return true;
    }

    stats(key: string, z: number): ShadowStats {
        const list = this.results.get(key) ?? [];
        const n = list.length;
        const wins = list.filter(Boolean).length;
        return { n, wins, winRatePct: n ? (wins / n) * 100 : null, lowerPct: wilsonLowerPct(wins, n, z) };
    }

    serialize(): ShadowState {
        return { version: 1, results: Object.fromEntries(this.results) };
    }
}