import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickBestEdge, wilsonLowerPct, zOneSided, type Candidate } from "../src/strategy/scanner";
import { ShadowBook } from "../src/strategy/shadow";
import { ALL_STRATEGY_IDS, PoolTracker } from "../src/strategy/strategies";
import { DEFAULT_SCAN_SETTINGS, validateScanSettings } from "../src/strategy/settings";

const PARAMS = { fastPeriod: 2, slowPeriod: 5, rsiPeriod: 3, rsiOverbought: 70, rsiOversold: 30 };

describe("statistics", () => {
    it("zOneSided matches known quantiles", () => {
        assert.ok(Math.abs(zOneSided(0.05) - 1.645) < 0.002);
        assert.ok(Math.abs(zOneSided(0.025) - 1.96) < 0.002);
        assert.ok(Math.abs(zOneSided(0.001) - 3.09) < 0.002);
    });

    it("a stricter z gives a lower, more cautious bound", () => {
        assert.ok(wilsonLowerPct(60, 100, 3)! < wilsonLowerPct(60, 100, 1.645)!);
    });

    it("a true 60% win rate needs hundreds of trades to prove it beats a 55% break-even", () => {
        const z = zOneSided(0.05 / 24); // 24 comparisons, 95% confidence
        assert.ok(wilsonLowerPct(60, 100, z)! < 55, "100 trades are not enough");
        assert.ok(wilsonLowerPct(600, 1000, z)! > 55, "1000 trades are enough");
    });
});

describe("strategy pool", () => {
    it("runs all four strategies on every market", () => {
        assert.deepEqual(new PoolTracker("X", PARAMS).ids, ALL_STRATEGY_IDS);
    });

    it("breakout fires Higher when price exceeds the recent range, once", () => {
        const pool = new PoolTracker("X", PARAMS);
        const flat = Array(8).fill(100);
        flat.forEach((p) => pool.update(p));
        const up = pool.update(101).filter((s) => s.strategyId === "breakout");
        assert.equal(up[0]?.side, "CALL");
        const again = pool.update(102).filter((s) => s.strategyId === "breakout");
        assert.equal(again.length, 0); // still beyond the range: no repeat signal until price re-enters it
    });

    it("rsi reversion fires Higher on entering oversold and Lower on entering overbought", () => {
        const down = new PoolTracker("X", PARAMS);
        const sigs = [100, 99, 98, 97, 96, 95, 94].flatMap((p) => down.update(p)).filter((s) => s.strategyId === "rsi_reversion");
        assert.equal(sigs[0]?.side, "CALL");
        const up = new PoolTracker("X", PARAMS);
        const sigs2 = [100, 101, 102, 103, 104, 105, 106].flatMap((p) => up.update(p)).filter((s) => s.strategyId === "rsi_reversion");
        assert.equal(sigs2[0]?.side, "PUT");
    });

    it("bollinger reversion fires when price jumps far from its mean", () => {
        // The band window includes the current price, so it needs about 6+ ticks for a 2-sigma move to be reachable.
        const pool = new PoolTracker("X", { ...PARAMS, slowPeriod: 10 });
        const base = [100, 100.1, 99.9, 100, 100.1, 99.9, 100, 100.1, 99.9, 100, 100.1, 99.9];
        base.forEach((p) => pool.update(p));
        const s = pool.update(103).filter((x) => x.strategyId === "bollinger_reversion");
        assert.equal(s[0]?.side, "PUT");
    });
});

describe("shadow book", () => {
    const cfg = { unit: "t" as const, duration: 2, window: 5 };

    it("settles a Higher paper trade after the duration and counts a win", () => {
        const b = new ShadowBook(cfg);
        assert.equal(b.open("k", "CALL", 100, 0), true);
        assert.equal(b.open("k", "CALL", 100, 0), false); // one at a time
        assert.equal(b.onTick("k", 100.5, 1), false);
        assert.equal(b.onTick("k", 101, 2), true);
        assert.deepEqual([b.stats("k", 1.645).n, b.stats("k", 1.645).wins], [1, 1]);
    });

    it("treats an equal exit as a loss and a wrong-way move as a loss", () => {
        const b = new ShadowBook(cfg);
        b.open("a", "CALL", 100, 0); b.onTick("a", 100, 1); b.onTick("a", 100, 2); // equal -> loss
        b.open("b", "PUT", 100, 0); b.onTick("b", 101, 1); b.onTick("b", 102, 2); // wrong way -> loss
        assert.equal(b.stats("a", 1.645).wins, 0);
        assert.equal(b.stats("b", 1.645).wins, 0);
    });

    it("time-based durations settle on elapsed seconds, not tick count", () => {
        const b = new ShadowBook({ unit: "m", duration: 1, window: 5 });
        b.open("k", "PUT", 100, 1000);
        assert.equal(b.onTick("k", 99, 1030), false);
        assert.equal(b.onTick("k", 99, 1060), true);
        assert.equal(b.stats("k", 1.645).wins, 1);
    });

    it("keeps only the rolling window and survives a save/load round trip", () => {
        const b = new ShadowBook(cfg);
        for (let i = 0; i < 8; i++) { b.open("k", "CALL", 100, i); b.onTick("k", 100, i); b.onTick("k", 101, i); }
        assert.equal(b.stats("k", 1.645).n, 5); // window = 5
        const restored = new ShadowBook(cfg, JSON.parse(JSON.stringify(b.serialize())));
        assert.deepEqual(restored.stats("k", 1.645), b.stats("k", 1.645));
        assert.equal(new ShadowBook(cfg, { version: 1, results: { k: [true, "x" as never, false] } }).stats("k", 1).n, 2);
    });
});

describe("pickBestEdge", () => {
    const q = (ask: number, payout: number, id: string) => ({ id, askPrice: ask, payout, spot: null });
    const cand = (symbol: string, lower: number, payout = 1.95): Candidate => ({
        symbol, side: "CALL", strength: 0, reason: "t", strategyLabel: "S", lowerPct: lower, sample: 100,
        call: q(1, payout, `${symbol}-c`), put: q(1, payout, `${symbol}-p`),
    });

    it("picks the largest edge over the live break-even", () => {
        const pick = pickBestEdge([cand("A", 58), cand("B", 62)], 10, true);
        assert.equal(pick.chosen?.symbol, "B");
        assert.match(pick.summary, /edge \+/);
    });

    it("with evidence required, refuses a candidate whose cautious win rate is below break-even", () => {
        // break-even at payout 1.95 is 51.3%; 50% lower bound has no edge
        assert.equal(pickBestEdge([cand("A", 50)], 10, true).chosen, null);
    });

    it("explore mode may take a candidate without edge, but still respects the margin cap", () => {
        assert.equal(pickBestEdge([cand("A", 50)], 10, false).chosen?.symbol, "A");
        assert.equal(pickBestEdge([cand("A", 50, 1.7)], 3, false).chosen, null); // margin ~17% > 3%
    });
});

describe("adaptive settings", () => {
    it("defaults validate, and bad evidence settings are rejected", () => {
        assert.deepEqual(validateScanSettings(DEFAULT_SCAN_SETTINGS), []);
        assert.ok(validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, confidencePct: 100 }).length > 0);
        assert.ok(validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, minShadowTrades: 1 }).length > 0);
        assert.ok(validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, shadowWindow: 50, minShadowTrades: 100 }).length > 0);
    });
});