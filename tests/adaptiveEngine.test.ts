import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BotSnapshot } from "../src/strategy/engine";
import { ScanEngine, SCAN_TICK_REQ_BASE } from "../src/strategy/scanEngine";
import { DEFAULT_SCAN_SETTINGS, DEFAULT_SETTINGS, type BotSettings, type ScanSettings } from "../src/strategy/settings";
import type { ShadowState } from "../src/strategy/shadow";

const SETTINGS: BotSettings = {
    ...DEFAULT_SETTINGS,
    fastPeriod: 2,
    slowPeriod: 3,
    rsiPeriod: 2,
    rsiOverbought: 95,
    rsiOversold: 5,
    cooldownSeconds: 0,
};
const SCAN: ScanSettings = {
    ...DEFAULT_SCAN_SETTINGS,
    adaptive: true,
    requireEvidence: true,
    durationUnit: "t",
    duration: 2,
    minShadowTrades: 5,
    shadowWindow: 50,
    confidencePct: 95,
    breakevenPct: 55,
    collectSeconds: 0,
    signalMaxAgeSeconds: 30,
    maxMarginPct: 6,
    minSampleTrades: 5,
};
const DOWN_THEN_UP = [100, 99.5, 99, 98.5, 98, 97.5, 97, 97.4, 97.9, 98.5, 99.2, 100];
const SYMBOLS = ["frxXAUUSD", "frxXAGUSD"];

const record = (wins: number, n: number): boolean[] => Array.from({ length: n }, (_, i) => i < wins);
const seed = (results: Record<string, boolean[]>): ShadowState => ({ version: 1, results });

function harness(opts: { scan?: Partial<ScanSettings>; shadow?: ShadowState | null } = {}) {
    const sent: Record<string, any>[] = [];
    const logs: string[] = [];
    const saves: ShadowState[] = [];
    let snap: BotSnapshot | null = null;
    let clock = 1_000_000;
    const engine = new ScanEngine({
        settings: SETTINGS,
        scan: { ...SCAN, ...opts.scan },
        symbols: SYMBOLS,
        currency: "USD",
        shadowState: opts.shadow ?? null,
        onShadowSave: (s) => saves.push(s),
        send: (r) => {
            sent.push(r);
            return true;
        },
        log: (m) => logs.push(m),
        onChange: (s) => {
            snap = s;
        },
        now: () => clock,
    });
    engine.start();
    let epoch = 1_700_000_000;
    const tick = (i: number, price: number) =>
        engine.handleMessage({ msg_type: "tick", req_id: SCAN_TICK_REQ_BASE + i, tick: { quote: price, epoch: epoch++ } });
    const proposals = () => sent.filter((r) => r.proposal);
    const quote = (reqId: number, id: string, ask: number, payout: number) =>
        engine.handleMessage({ msg_type: "proposal", req_id: reqId, proposal: { id, ask_price: ask, payout, spot: 1 } });
    return { engine, sent, logs, saves, tick, proposals, quote, snap: () => snap! };
}

function quoteAll(h: ReturnType<typeof harness>) {
    for (const p of h.proposals()) h.quote(p.req_id, `${p.underlying_symbol}-${p.contract_type}`, 1, 1.95);
}

describe("adaptive engine", () => {
    it("does not trade, and says why, when no strategy has proven itself", () => {
        const h = harness();
        for (const p of DOWN_THEN_UP) h.tick(0, p);
        assert.equal(h.proposals().length, 0);
        assert.match(h.snap().decision ?? "", /no strategy has proven itself/i);
        assert.ok(h.snap().strategies && h.snap().strategies!.length > 0);
        assert.match(h.snap().evidenceNote ?? "", /paper trades/);
    });

    it("loads saved evidence and reports it as qualified", () => {
        const h = harness({ shadow: seed({ "frxXAUUSD|ema_rsi": record(30, 30) }) });
        h.tick(0, 100);
        const row = h.snap().strategies!.find((r) => r.symbol === "frxXAUUSD" && r.strategyId === "ema_rsi")!;
        assert.equal(row.n, 30);
        assert.equal(row.status, "qualified");
    });

    it("trades the strategy that has earned it, and names it", () => {
        const h = harness({ shadow: seed({ "frxXAUUSD|ema_rsi": record(30, 30) }) });
        for (const p of DOWN_THEN_UP) h.tick(0, p);
        const props = h.proposals();
        assert.equal(props.length, 2); // Higher and Lower, on the one market with a qualified strategy
        assert.ok(props.every((p) => p.underlying_symbol === "frxXAUUSD" && p.duration_unit === "t" && p.duration === 2));
        quoteAll(h);
        const buy = h.sent.find((r) => r.buy);
        assert.ok(buy, "purchase sent");
        assert.equal(buy!.price, SETTINGS.stake);
        assert.match(h.snap().decision ?? "", /via EMA crossover \+ RSI/);
        assert.match(h.snap().trades[0]!.reason, /EMA crossover \+ RSI/);
    });

    it("refuses a strategy whose cautious win rate is below break-even, even with a large sample", () => {
        const h = harness({ shadow: seed({ "frxXAUUSD|ema_rsi": record(20, 40) }) }); // 50% over 40 trades
        for (const p of DOWN_THEN_UP) h.tick(0, p);
        assert.equal(h.proposals().length, 0);
    });

    it("explore mode trades once the sample is big enough, even without proven edge", () => {
        const h = harness({ scan: { requireEvidence: false }, shadow: seed({ "frxXAUUSD|ema_rsi": record(6, 10) }) });
        for (const p of DOWN_THEN_UP) h.tick(0, p);
        assert.equal(h.proposals().length, 2);
        quoteAll(h);
        assert.ok(h.sent.some((r) => r.buy), "explore mode bought");
    });

    it("explore mode still waits for the minimum number of paper trades", () => {
        const h = harness({ scan: { requireEvidence: false }, shadow: seed({ "frxXAUUSD|ema_rsi": record(2, 3) }) });
        for (const p of DOWN_THEN_UP) h.tick(0, p);
        assert.equal(h.proposals().length, 0);
    });

    it("runs paper trades on every tick without spending anything", () => {
        const h = harness();
        // A wobbling series gives every strategy something to react to.
        for (let i = 0; i < 80; i++) h.tick(i % 2, 100 + Math.sin(i / 3) * 2 + (i % 7) * 0.1);
        const total = h.snap().strategies!.reduce((a, r) => a + r.n, 0);
        assert.ok(total > 0, "paper trades settled");
        assert.equal(h.sent.filter((r) => r.buy).length, 0, "no real purchase was made");
    });

    it("saves its paper results when stopped", () => {
        const h = harness({ shadow: seed({ "frxXAUUSD|ema_rsi": record(30, 30) }) });
        h.tick(0, 100);
        h.engine.stop();
        const last = h.saves.at(-1)!;
        assert.equal(last.version, 1);
        assert.equal(last.results["frxXAUUSD|ema_rsi"]!.length, 30);
    });
});