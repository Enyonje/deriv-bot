export interface RiskSettings {
    stake: number;
    maxSessionLoss: number;
    sessionTakeProfit: number;
    maxConsecutiveLosses: number;
    maxTrades: number;

    // Retained for compatibility, but dynamic sizing is deliberately disabled.
    useDynamicStaking?: boolean;
    minStake?: number;
    maxStake?: number;
}

export type RiskCheck =
    | { ok: true }
    | { ok: false; reason: string };

export interface RiskStats {
    pnl: number;
    trades: number;
    wins: number;
    losses: number;
    breakevenTrades: number;
    consecutiveLosses: number;
    winRate: number | null;
    currentStake: number;
    maxDrawdown: number;
}

export class RiskManager {
    private pnl = 0;
    private trades = 0;
    private wins = 0;
    private losses = 0;
    private breakevenTrades = 0;
    private consecutiveLosses = 0;

    private peakPnl = 0;
    private maxDrawdown = 0;

    private readonly stake: number;

    constructor(private readonly s: RiskSettings) {
        this.validateSettings(s);
        this.stake = s.stake;
    }

    private validateSettings(s: RiskSettings): void {
        const positive = [
            ["stake", s.stake],
            ["maxSessionLoss", s.maxSessionLoss],
            ["sessionTakeProfit", s.sessionTakeProfit],
            ["maxConsecutiveLosses", s.maxConsecutiveLosses],
            ["maxTrades", s.maxTrades],
        ] as const;

        for (const [name, value] of positive) {
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error(`Invalid risk setting: ${name}`);
            }
        }

        if (!Number.isInteger(s.maxConsecutiveLosses)) {
            throw new Error("maxConsecutiveLosses must be an integer.");
        }

        if (!Number.isInteger(s.maxTrades)) {
            throw new Error("maxTrades must be an integer.");
        }

        if (
            s.minStake !== undefined &&
            (!Number.isFinite(s.minStake) || s.minStake <= 0)
        ) {
            throw new Error("minStake must be a positive finite number.");
        }

        if (
            s.maxStake !== undefined &&
            (!Number.isFinite(s.maxStake) || s.maxStake <= 0)
        ) {
            throw new Error("maxStake must be a positive finite number.");
        }

        if (
            s.minStake !== undefined &&
            s.maxStake !== undefined &&
            s.minStake > s.maxStake
        ) {
            throw new Error("minStake cannot exceed maxStake.");
        }

        if (
            (s.minStake !== undefined && s.stake < s.minStake) ||
            (s.maxStake !== undefined && s.stake > s.maxStake)
        ) {
            throw new Error("stake must be within the configured stake limits.");
        }

        if (
            s.useDynamicStaking !== undefined &&
            typeof s.useDynamicStaking !== "boolean"
        ) {
            throw new Error("useDynamicStaking must be a boolean.");
        }
    }

    /**
     * Fixed staking is intentional until a reliable bankroll-aware
     * and payout-adjusted sizing model has been validated.
     */
    getCalculatedStake(_estimatedPayoutRatio?: number): number {
        return this.stake;
    }

    check(): RiskCheck {
        this.updateDrawdown();

        if (this.pnl <= -this.s.maxSessionLoss) {
            return {
                ok: false,
                reason: "Hard stop: maximum session loss reached.",
            };
        }

        if (this.pnl - this.stake < -this.s.maxSessionLoss) {
            return {
                ok: false,
                reason: "Projected risk: next trade could breach the session loss limit.",
            };
        }

        if (this.pnl >= this.s.sessionTakeProfit) {
            return {
                ok: false,
                reason: "Session take-profit target reached.",
            };
        }

        if (this.consecutiveLosses >= this.s.maxConsecutiveLosses) {
            return {
                ok: false,
                reason: "Circuit breaker: maximum consecutive losses reached.",
            };
        }

        if (this.trades >= this.s.maxTrades) {
            return {
                ok: false,
                reason: "Maximum session trade count reached.",
            };
        }

        return { ok: true };
    }

    recordResult(profit: number): void {
        if (!Number.isFinite(profit)) {
            throw new Error("Trade profit must be a finite number.");
        }

        this.trades++;
        this.pnl += profit;

        if (profit > 0) {
            this.wins++;
            this.consecutiveLosses = 0;
        } else if (profit < 0) {
            this.losses++;
            this.consecutiveLosses++;
        } else {
            this.breakevenTrades++;
            this.consecutiveLosses = 0;
        }

        this.updateDrawdown();
    }

    private updateDrawdown(): void {
        this.peakPnl = Math.max(this.peakPnl, this.pnl);

        const drawdown = this.peakPnl - this.pnl;

        this.maxDrawdown = Math.max(
            this.maxDrawdown,
            drawdown,
        );
    }

    stats(): RiskStats {
        return {
            pnl: Number(this.pnl.toFixed(2)),
            trades: this.trades,
            wins: this.wins,
            losses: this.losses,
            breakevenTrades: this.breakevenTrades,
            consecutiveLosses: this.consecutiveLosses,
            winRate:
                this.trades > 0
                    ? this.wins / this.trades
                    : null,
            currentStake: this.stake,
            maxDrawdown: Number(this.maxDrawdown.toFixed(2)),
        };
    }
}