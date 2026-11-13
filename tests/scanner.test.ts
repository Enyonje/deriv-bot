import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { breakevenWinRatePct, MarketTracker, pickBest, wilsonLowerPct, winRateGuard, type Candidate } from "../src/strategy/scanner";
import { DEFAULT_SCAN_SETTINGS, validateScanSettings } from "../src/strategy/settings";

const q = (askPrice: number, payout: number | null, id = "x") => ({ id, askPrice, payout, spot: null });
const cand = (symbol: string, payout: number | null, strength = 1, side: "CALL" | "PUT" = "CALL"): Candidate => ({
    symbol,
    side,
    strength,
    reason: "test",
    call: payout === null ? null : q(1, payout, `${symbol}-c`),
    put: payout === null ? null : q(1, payout, `${symbol}-p`),
});

describe("pickBest", () => {
    it("chooses the market with the lowest two-sided margin", () => {
        const pick = pickBest([cand("A", 1.9), cand("B", 1.95), cand("C", 1.92)], 10);
        assert.equal(pick.chosen?.symbol, "B");
    });

    it("breaks margin ties by signal strength", () => {
        const pick = pickBest([cand("A", 1.9, 1), cand("B", 1.9, 3)], 10);
        assert.equal(pick.chosen?.symbol, "B");
    });

    it("never chooses a market above the margin cap", () => {
        const pick = pickBest([cand("A", 1.8)], 3); // margin ~11%
        assert.equal(pick.chosen, null);
        assert.match(pick.summary, /No market qualified/);
    });

    it("ignores markets without both prices", () => {
        const pick = pickBest([cand("A", null), cand("B", 1.9)], 10);
        assert.equal(pick.chosen?.symbol, "B");
        assert.equal(pickBest([cand("A", null)], 10).chosen, null);
    });
});

describe("win-rate maths", () => {
    it("computes break-even from stake and payout", () => {
        const be = breakevenWinRatePct([{ stake: 1, payout: 1.95 }, { stake: 1, payout: 1.9 }, { stake: 1, payout: null }]);
        assert.ok(be !== null && Math.abs(be - ((1 / 1.95 + 1 / 1.9) / 2) * 100) < 1e-9);
        assert.equal(breakevenWinRatePct([]), null);
    });

    it("guard waits for the minimum sample, then halts below target", () => {
        assert.equal(winRateGuard(1, 10, 70, 20).halt, false); // too few trades
        assert.equal(winRateGuard(14, 20, 70, 20).halt, false); // exactly 70%
        const g = winRateGuard(11, 20, 70, 20);
        assert.equal(g.halt, true);
        assert.match(g.reason ?? "", /55\.0%.*70%/);
    });

    it("Wilson lower bound is cautious for small samples", () => {
        const small = wilsonLowerPct(7, 10)!;
        const large = wilsonLowerPct(700, 1000)!;
        assert.ok(small < 45 && large > 66 && large < 70);
        assert.equal(wilsonLowerPct(0, 0), null);
    });
});

describe("tracker and settings", () => {
    it("tracker emits a CALL with a strength on an upward crossover", () => {
        const t = new MarketTracker("X", { fastPeriod: 2, slowPeriod: 3, rsiPeriod: 2, rsiOverbought: 95, rsiOversold: 5 });
        const out = [100, 99.5, 99, 98.5, 98, 97.5, 97, 97.4, 97.9, 98.5, 99.2, 100].map((p) => t.update(p)).filter((s) => s);
        assert.equal(out[0]?.side, "CALL");
        assert.ok((out[0]?.strength ?? -1) >= 0);
    });

    it("validates scan settings", () => {
        assert.deepEqual(validateScanSettings(DEFAULT_SCAN_SETTINGS), []);
        assert.ok(validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, targetWinRatePct: 100 }).length > 0);
        assert.ok(validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, universeMarket: "" }).length > 0);
        assert.ok(validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, durationUnit: "t", duration: 30 }).length > 0);
        assert.ok(validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, minSampleTrades: 2 }).length > 0);
    });
});