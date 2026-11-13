export interface Quote {
    id: string | null;
    askPrice: number;
    payout: number | null;
    spot: number | null;
    timestamp?: number;
}

export interface QuoteMetrics {
    profit: number | null;
    returnPct: number | null;
    impliedProbPct: number | null;
    riskRewardRatio: number | null;
    expectedValue: number | null;
}

const finite = (v: unknown): number | null => {
    if (
        v === null ||
        v === undefined ||
        v === "" ||
        typeof v === "boolean"
    ) return null;

    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export function parseQuote(
    proposal: Record<string, any> | null | undefined,
): Quote | null {
    if (!proposal || typeof proposal !== "object") return null;

    const askPrice = finite(proposal.ask_price);
    const payout = finite(proposal.payout);
    const spot = finite(proposal.spot);

    const id =
        typeof proposal.id === "string" && proposal.id.trim()
            ? proposal.id
            : null;

    // A proposal without an ID cannot safely be purchased.
    if (!id || askPrice === null || askPrice <= 0) return null;

    // Reject invalid or impossible payout information.
    if (payout === null || payout <= askPrice) return null;

    return {
        id,
        askPrice,
        payout,
        spot,
        timestamp: Date.now(),
    };
}

export function quoteMetrics(
    q: Quote,
    estimatedWinProbability?: number,
): QuoteMetrics {
    if (
        !Number.isFinite(q.askPrice) ||
        q.askPrice <= 0 ||
        q.payout === null ||
        !Number.isFinite(q.payout) ||
        q.payout <= q.askPrice
    ) {
        return {
            profit: null,
            returnPct: null,
            impliedProbPct: null,
            riskRewardRatio: null,
            expectedValue: null,
        };
    }

    const profit = q.payout - q.askPrice;
    const returnPct = (profit / q.askPrice) * 100;
    const impliedProbPct = (q.askPrice / q.payout) * 100;
    const riskRewardRatio = q.payout / q.askPrice;

    let expectedValue: number | null = null;

    if (
        estimatedWinProbability !== undefined &&
        Number.isFinite(estimatedWinProbability) &&
        estimatedWinProbability >= 0 &&
        estimatedWinProbability <= 1
    ) {
        expectedValue =
            estimatedWinProbability * q.payout - q.askPrice;
    }

    return {
        profit,
        returnPct,
        impliedProbPct,
        riskRewardRatio,
        expectedValue,
    };
}

export function houseMarginPct(
    a: Quote | null,
    b: Quote | null,
): number | null {
    if (!a || !b) return null;

    const pa = quoteMetrics(a).impliedProbPct;
    const pb = quoteMetrics(b).impliedProbPct;

    if (pa === null || pb === null) return null;

    const margin = pa + pb - 100;

    return Number.isFinite(margin) ? margin : null;
}

export function isHouseMarginAcceptable(
    a: Quote | null,
    b: Quote | null,
    maxAcceptableMarginPct = 5,
): boolean {
    if (
        !Number.isFinite(maxAcceptableMarginPct) ||
        maxAcceptableMarginPct < 0
    ) {
        return false;
    }

    const margin = houseMarginPct(a, b);

    // Fail closed when margin cannot be calculated.
    return margin !== null && margin <= maxAcceptableMarginPct;
}

export function movedAgainstBuyer(
    seen: Quote,
    latest: Quote,
    tolerancePct: number,
): boolean {
    if (
        !Number.isFinite(tolerancePct) ||
        tolerancePct < 0 ||
        !Number.isFinite(seen.askPrice) ||
        !Number.isFinite(latest.askPrice) ||
        seen.askPrice <= 0 ||
        latest.askPrice <= 0
    ) {
        return true;
    }

    const tolerance = tolerancePct / 100;

    if (latest.askPrice > seen.askPrice * (1 + tolerance)) {
        return true;
    }

    if (
        seen.payout !== null &&
        (
            latest.payout === null ||
            !Number.isFinite(latest.payout) ||
            latest.payout < seen.payout * (1 - tolerance)
        )
    ) {
        return true;
    }

    return false;
}