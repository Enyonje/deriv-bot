import type { BotSettings, ScanSettings } from "../strategy/settings";
import type { ShadowState } from "../strategy/shadow";

const PREFIX = "deriv-bot:evidence:v1:";

function hash(text: string): string {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/**
 * Paper-trading evidence only means something for the same strategy parameters and contract duration,
 * so the storage key is derived from them. Change either and the bot starts a fresh record.
 */
export function evidenceKey(settings: BotSettings, scan: ScanSettings): string {
    return (
        PREFIX +
        hash(
            JSON.stringify([
                settings.fastPeriod,
                settings.slowPeriod,
                settings.rsiPeriod,
                settings.rsiOverbought,
                settings.rsiOversold,
                scan.durationUnit,
                scan.duration,
            ]),
        )
    );
}

export function loadEvidence(key: string): ShadowState | null {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.version === 1 && parsed.results && typeof parsed.results === "object" ? (parsed as ShadowState) : null;
    } catch {
        return null; // storage unavailable or corrupt: start fresh
    }
}

export function saveEvidence(key: string, state: ShadowState): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
        /* storage full or blocked: evidence simply won't persist */
    }
}

export function clearEvidence(key: string): void {
    try {
        window.localStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}