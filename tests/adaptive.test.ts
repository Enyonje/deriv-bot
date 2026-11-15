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

    it("holds breakout evaluation until the market-regime warmup is complete", () => {
        const pool = new PoolTracker("X", PARAMS);
        Array(8).fill(100).forEach((p) => pool.update(p));
        assert.equal(pool.ready, false);
        assert.deepEqual(pool.update(101), []);
        Array(7).fill(101).forEach((p) => pool.update(p));
        assert.equal(pool.ready, true);
    });

    it("does not evaluate mean-reversion signals before the market warmup completes", () => {
        const down = new PoolTracker("X", PARAMS);
        const sigs = [100, 99, 98, 97, 96, 95, 94].flatMap((p) => down.update(p));
        assert.equal(down.ready, false);
        assert.deepEqual(sigs, []);
    });

    it("requires the configured long-period warmup before evaluating Bollinger reversion", () => {
        const pool = new PoolTracker("X", { ...PARAMS, slowPeriod: 10 });
        const base = Array(12).fill(100);
        base.forEach((p) => pool.update(p));
        assert.equal(pool.ready, false);
        assert.deepEqual(pool.update(103), []);
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

    it("explore mode still rejects negative expected value and respects the margin cap", () => {
        assert.equal(pickBestEdge([cand("A", 50)], 10, false).chosen, null);
        assert.equal(pickBestEdge([cand("A", 50, 1.7)], 3, false).chosen, null);
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