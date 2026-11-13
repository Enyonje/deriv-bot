import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BotSnapshot } from "../src/strategy/engine";
import { ScanEngine, SCAN_TICK_REQ_BASE } from "../src/strategy/scanEngine";
import { DEFAULT_SCAN_SETTINGS, DEFAULT_SETTINGS, type BotSettings, type ScanSettings } from "../src/strategy/settings";

const SETTINGS: BotSettings = {
    ...DEFAULT_SETTINGS,
    fastPeriod: 2,
    slowPeriod: 3,
    rsiPeriod: 2,
    rsiOverbought: 95,
    rsiOversold: 5,
    cooldownSeconds: 0,
};
const SCAN: ScanSettings = { ...DEFAULT_SCAN_SETTINGS, adaptive: false, collectSeconds: 5, signalMaxAgeSeconds: 30, maxMarginPct: 6, minSampleTrades: 5, targetWinRatePct: 70 };
const DOWN_THEN_UP = [100, 99.5, 99, 98.5, 98, 97.5, 97, 97.4, 97.9, 98.5, 99.2, 100];
const SYMBOLS = ["frxXAUUSD", "frxXAGUSD"];

function harness(scan: ScanSettings = SCAN, settings: BotSettings = SETTINGS, symbols = SYMBOLS) {
    const sent: Record<string, any>[] = [];
    const logs: string[] = [];
    let snap: BotSnapshot | null = null;
    let clock = 1_000_000;
    const engine = new ScanEngine({
        settings,
        scan,
        symbols,
        currency: "USD",
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
    const tick = (symbolIndex: number, price: number, sub?: string) =>
        engine.handleMessage({ msg_type: "tick", req_id: SCAN_TICK_REQ_BASE + symbolIndex, tick: { quote: price }, ...(sub ? { subscription: { id: sub } } : {}) });
    const proposals = () => sent.filter((r) => r.proposal);
    const quote = (reqId: number, id: string, ask: number, payout: number) =>
        engine.handleMessage({ msg_type: "proposal", req_id: reqId, proposal: { id, ask_price: ask, payout, spot: 1 } });
    return { engine, sent, logs, tick, proposals, quote, advance: (ms: number) => (clock += ms), snap: () => snap! };
}

/** Runs both markets to a signal, waits out the comparison window, and returns the 4 proposal requests. */
function bothSignal(h: ReturnType<typeof harness>) {
    for (const p of DOWN_THEN_UP) h.tick(0, p);
    for (const p of DOWN_THEN_UP) h.tick(1, p);
    assert.equal(h.snap().phase, "collecting");
    h.advance(6000);
    h.tick(0, 100.1); // any tick after the window triggers quoting
    assert.equal(h.snap().phase, "quoting");
    return h.proposals();
}

describe("scan engine", () => {
    it("subscribes to every watched market on start", () => {
        const h = harness();
        const subs = h.sent.filter((r) => r.ticks);
        assert.deepEqual(subs.map((r) => [r.ticks, r.req_id]), [["frxXAUUSD", SCAN_TICK_REQ_BASE], ["frxXAGUSD", SCAN_TICK_REQ_BASE + 1]]);
    });

    it("quotes both sides of every signalling market and buys on the cheapest", () => {
        const h = harness();
        const props = bothSignal(h);
        assert.equal(props.length, 4);
        for (const p of props) {
            assert.equal(p.basis, "stake");
            assert.equal(p.duration, SCAN.duration);
            assert.equal(p.duration_unit, SCAN.durationUnit);
            assert.equal(p.currency, "USD");
        }
        const get = (symbol: string, side: string) => props.find((p) => p.underlying_symbol === symbol && p.contract_type === side)!;
        // XAU: payout 1.9 (margin ~5.3%), XAG: payout 1.95 (margin ~2.6%) -> XAG should win.
        h.quote(get("frxXAUUSD", "CALL").req_id, "xau-c", 1, 1.9);
        h.quote(get("frxXAUUSD", "PUT").req_id, "xau-p", 1, 1.9);
        h.quote(get("frxXAGUSD", "CALL").req_id, "xag-c", 1, 1.95);
        h.quote(get("frxXAGUSD", "PUT").req_id, "xag-p", 1, 1.95);

        const buy = h.sent.find((r) => r.buy)!;
        assert.ok(buy, "a purchase was sent");
        assert.match(buy.buy, /^xag-/);
        assert.equal(buy.price, SETTINGS.stake); // never pays above the stake
        assert.equal(h.snap().phase, "buying");
        assert.match(h.snap().decision ?? "", /Chose frxXAGUSD/);
    });

    it("does not trade when every market is above the margin cap", () => {
        const h = harness();
        const props = bothSignal(h);
        for (const p of props) h.quote(p.req_id, `id-${p.req_id}`, 1, 1.7); // margin ~17%
        assert.equal(h.sent.some((r) => r.buy), false);
        assert.match(h.snap().decision ?? "", /No market qualified/);
        assert.notEqual(h.snap().phase, "halted");
    });

    it("drops a market after repeated price errors and keeps trading the rest", () => {
        const h = harness();
        // Two quoting rounds, both with errors on XAU only.
        for (let round = 0; round < 2; round++) {
            const before = h.proposals().length;
            for (const p of DOWN_THEN_UP) h.tick(0, p + round * 0.01);
            h.advance(6000);
            h.tick(1, 50); // trigger quoting
            const fresh = h.proposals().slice(before);
            for (const p of fresh) h.engine.handleMessage({ msg_type: "proposal", req_id: p.req_id, error: { message: "Trading is not offered for this duration." } });
        }
        const row = h.snap().markets!.find((m) => m.symbol === "frxXAUUSD")!;
        assert.match(row.excluded ?? "", /repeated price errors/);
        assert.notEqual(h.snap().phase, "halted"); // XAG still available
    });

    it("halts on the win-rate guard once the sample is big enough and the rate is below target", () => {
        const h = harness({ ...SCAN, minSampleTrades: 5 }, { ...SETTINGS, maxTrades: 99, maxConsecutiveLosses: 99, maxSessionLoss: 1000, stake: 1, sessionTakeProfit: 1000 });
        let n = 0;
        while (h.snap().phase !== "halted" && n < 8) {
            n++;
            const before = h.proposals().length;
            for (const p of DOWN_THEN_UP) h.tick(0, p * (1 + n * 0.0001));
            h.advance(6000);
            h.tick(1, 10);
            const fresh = h.proposals().slice(before);
            if (fresh.length === 0) continue;
            for (const p of fresh) h.quote(p.req_id, `id${p.req_id}`, 1, 1.95);
            const buy = h.sent.filter((r) => r.buy).at(-1)!;
            h.engine.handleMessage({ msg_type: "buy", req_id: buy.req_id, buy: { contract_id: 1000 + n, buy_price: 1 } });
            h.engine.handleMessage({ msg_type: "proposal_open_contract", proposal_open_contract: { contract_id: 1000 + n, is_sold: 1, profit: -1 } });
        }
        assert.equal(h.snap().phase, "halted");
        assert.match(h.snap().haltReason ?? "", /below your 70% target/);
        assert.equal(h.snap().stats.trades, 5);
    });

    it("halts if the connection drops while a purchase is unconfirmed", () => {
        const h = harness();
        const props = bothSignal(h);
        for (const p of props) h.quote(p.req_id, `id-${p.req_id}`, 1, 1.95);
        assert.equal(h.snap().phase, "buying");
        h.engine.onConnectionLost();
        assert.equal(h.snap().phase, "halted");
        assert.equal(h.snap().trades[0]!.result, "unknown");
    });

    it("stop() releases tick streams and opens no further trades", () => {
        const h = harness();
        h.tick(0, 100, "sub-a");
        h.tick(1, 100, "sub-b");
        h.engine.stop();
        assert.ok(h.sent.some((r) => r.forget === "sub-a") && h.sent.some((r) => r.forget === "sub-b"));
        for (const p of DOWN_THEN_UP) h.tick(0, p);
        assert.equal(h.proposals().length, 0);
        assert.equal(h.snap().phase, "stopped");
    });
});