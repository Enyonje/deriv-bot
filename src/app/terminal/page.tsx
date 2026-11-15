"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import BotPanel from "../../components/BotPanel";
import QuoteBoard from "../../components/QuoteBoard";
import AgentInsightPanel from "../../components/AgentInsightPanel";
import { useDerivAccount } from "../../hooks/useDerivAccount";
import {
  useDerivWebSocket,
  type ConnectionStatus,
} from "../../hooks/useDerivWebSocket";



const STATUS: Record<
  ConnectionStatus,
  { label: string; className: string }
> = {
  disconnected: {
    label: "Disconnected",
    className: "text-slate-400",
  },
  connecting: {
    label: "Connecting...",
    className: "text-amber-400",
  },
  connected: {
    label: "Connected",
    className: "text-emerald-400",
  },
  reconnecting: {
    label: "Reconnecting...",
    className: "text-amber-400",
  },
  error: {
    label: "Connection failed",
    className: "text-red-400",
  },
};

const inputClass =
  "w-full p-3 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

function OnboardingForm({
  saving,
  error,
  onSubmit,
}: {
  saving: boolean;
  error: string | null;
  onSubmit: (v: {
    appId: string;
    pat: string;
    accountId: string;
    symbol: string;
  }) => Promise<boolean>;
}) {
  const [appId, setAppId] = useState("");
  const [pat, setPat] = useState("");
  const [accountId, setAccountId] = useState("");
  const [symbol, setSymbol] = useState("R_100");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const ok = await onSubmit({
      appId: appId.trim(),
      pat,
      accountId: accountId.trim(),
      symbol: symbol.trim().toUpperCase(),
    });

    if (ok) {
      setPat("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-xs text-blue-200 space-y-2">
        <p className="font-semibold text-sm">Connect your Deriv account</p>

        <p>
          Enter your Deriv API credentials to initialize the trading
          terminal.
        </p>

        <p>
          Generate your credentials through{" "}
          <a
            className="underline font-semibold"
            href="https://developers.deriv.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Deriv API
          </a>
          .
        </p>

        <p className="text-amber-300">
          Never share your Personal Access Token with another person.
        </p>
      </div>

      <div>
        <label
          htmlFor="appId"
          className="block text-sm font-medium text-white-300 mb-1"
        >
          App ID
        </label>

        <input
          id="appId"
          required
          inputMode="numeric"
          placeholder="e.g. 1089"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="pat"
          className="block text-sm font-medium text-white-300 mb-1"
        >
          Personal Access Token
        </label>

        <input
          id="pat"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Deriv API Token"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="accountId"
          className="block text-sm font-medium text-white-300 mb-1"
        >
          Account ID
        </label>

        <input
          id="accountId"
          required
          placeholder="e.g. CR1234567"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="symbol"
          className="block text-sm font-medium text-white-300 mb-1"
        >
          Primary Market Symbol
        </label>

        <input
          id="symbol"
          required
          placeholder="e.g. R_100"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold p-3 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800"
      >
        {saving ? "Verifying credentials..." : "Connect Deriv Account"}
      </button>
    </form>
  );
}

export default function DerivBotPage() {
  const acct = useDerivAccount();
  const ws = useDerivWebSocket();

  const [botRunning, setBotRunning] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [liveAcknowledged, setLiveAcknowledged] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    logEndRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [ws.logs]);

  const busy =
    ws.status === "connecting" || ws.status === "reconnecting";

  const connected = ws.status === "connected";

  const account = acct.account;
  const accountType = account?.accountType ?? ws.accountType;

  const isRealAccount = accountType === "real";

  // Automated trading requires a live connection.
  // Real accounts additionally require explicit acknowledgement.
  const tradingBlocked =
    !connected ||
    manualBusy ||
    (isRealAccount && !liveAcknowledged);

  const balanceText = ws.balance
    ? `${ws.balance.amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${ws.balance.currency}`
    : "—";

  const tickText = ws.tick
    ? ws.tick.pipSize !== null
      ? ws.tick.quote.toFixed(ws.tick.pipSize)
      : String(ws.tick.quote)
    : "—";

  async function handleRemove() {
    ws.disconnect();

    setBotRunning(false);
    setLiveAcknowledged(false);

    await acct.remove();
  }

  function handleDisconnect() {
    ws.disconnect();
    setBotRunning(false);
    setLiveAcknowledged(false);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center gap-6 p-4 py-8">
      <div className="w-full max-w-2xl bg-slate-900 p-6 rounded-2xl shadow-2xl border border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              Deriv Bot Trading Terminal
            </h1>

            <p className="text-xs text-slate-400 mt-1">
              Multi-market scanning, quote validation and risk-controlled
              execution
            </p>
          </div>

          <span className="text-xs bg-blue-500/10 text-blue-300 px-2.5 py-1 rounded-full border border-blue-500/30 font-mono">
            v3.6
          </span>
        </div>

        {acct.loading ? (
          <p
            className="text-slate-400 text-center py-8"
            role="status"
          >
            Loading account configuration...
          </p>
        ) : !account ? (
          <OnboardingForm
            saving={acct.saving}
            error={acct.error}
            onSubmit={acct.save}
          />
        ) : (
          <>
            {/* Account information */}
            <div className="flex flex-wrap justify-between gap-3 bg-slate-950/70 p-3 rounded-xl border border-slate-800 mb-5 text-sm">
              <div>
                <p className="text-xs text-slate-500">
                  Account ID
                </p>

                <p className="text-white font-mono">
                  {account.accountId}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  Application
                </p>

                <p className="text-white font-mono">
                  {account.appId}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  Account Type
                </p>

                <span
                  className={`inline-flex mt-1 rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${isRealAccount
                    ? "bg-red-500/10 text-red-400 border border-red-500/30"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    }`}
                >
                  {isRealAccount ? "Real Account" : "Demo Account"}
                </span>
              </div>
            </div>

            {/* Real account warning */}
            {isRealAccount && (
              <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <p className="font-semibold text-red-300 text-sm">
                  Real-money trading enabled
                </p>

                <p className="mt-2 text-xs leading-relaxed text-red-200/80">
                  Automated trades will use real funds. Strategy
                  performance is not guaranteed, and a positive
                  historical win rate does not guarantee profitability.
                  Verify your risk settings and test the strategy on a
                  demo account before proceeding.
                </p>

                <label className="mt-4 flex items-start gap-3 cursor-pointer text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={liveAcknowledged}
                    onChange={(e) =>
                      setLiveAcknowledged(e.target.checked)
                    }
                    className="mt-1 h-4 w-4 accent-red-500"
                  />

                  <span>
                    I understand that automated trading can lose real
                    money and I authorize the bot to operate on this
                    account.
                  </span>
                </label>
              </div>
            )}

            {/* Gateway controls */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={ws.connect}
                disabled={busy || connected}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold p-3 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {busy
                  ? "Connecting..."
                  : connected
                    ? "Gateway Connected"
                    : "Connect Gateway"}
              </button>

              <button
                type="button"
                onClick={handleDisconnect}
                disabled={!connected && !busy}
                className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-semibold px-5 py-3 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                Disconnect
              </button>
            </div>

            {/* Connection information */}
            <dl
              className="mt-6 space-y-3 border-t border-slate-800 pt-4 text-sm"
              aria-live="polite"
            >
              <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-lg">
                <dt className="text-slate-400">
                  Gateway Status
                </dt>

                <dd
                  className={`font-semibold font-mono ${STATUS[ws.status].className}`}
                >
                  {STATUS[ws.status].label}
                </dd>
              </div>

              <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-lg">
                <dt className="text-slate-400">
                  Portfolio Balance
                </dt>

                <dd className="font-bold text-white font-mono">
                  {balanceText}
                </dd>
              </div>

              <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-lg">
                <dt className="text-slate-400">
                  Market Feed
                  <span className="text-slate-500">
                    {" "}({ws.symbol ?? account.symbol})
                  </span>
                </dt>

                <dd className="font-semibold text-emerald-400 font-mono tabular-nums">
                  {tickText}
                </dd>
              </div>
            </dl>

            {/* Trading readiness */}
            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-200">
                  Automated Trading Readiness
                </p>

                <span
                  className={`text-xs font-semibold ${tradingBlocked
                    ? "text-amber-400"
                    : "text-emerald-400"
                    }`}
                >
                  {tradingBlocked ? "Blocked" : "Ready"}
                </span>
              </div>

              <p className="text-xs text-slate-400 mt-2">
                {!connected
                  ? "Connect the Deriv gateway before starting automated trading."
                  : manualBusy
                    ? "A manual trading operation is in progress."
                    : isRealAccount && !liveAcknowledged
                      ? "Acknowledge the real-account risk warning to enable automated trading."
                      : "Connection and account acknowledgement checks passed. The bot's internal risk and strategy checks still apply."}
              </p>
            </div>

            {/* Telemetry */}
            <section
              className="mt-6"
              aria-labelledby="activity-heading"
            >
              <div className="flex justify-between items-center mb-2">
                <h2
                  id="activity-heading"
                  className="text-xs font-semibold text-slate-400 uppercase tracking-wider"
                >
                  Activity Log
                </h2>

                <span className="text-[10px] text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded border border-slate-700">
                  WebSocket
                </span>
              </div>

              <div
                role="log"
                aria-live="polite"
                aria-relevant="additions"
                tabIndex={0}
                className="bg-black text-emerald-400 p-4 h-60 overflow-y-auto rounded-xl font-mono text-xs whitespace-pre-wrap shadow-inner border border-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {ws.logs.length === 0
                  ? "System initialized. Connect the Deriv gateway to begin receiving market data."
                  : ws.logs.join("\n")}

                <div ref={logEndRef} />
              </div>
            </section>

            {/* Account controls */}
            <div className="mt-6 border-t border-slate-800 pt-4 flex flex-wrap justify-between items-center gap-3">
              <button
                type="button"
                onClick={handleRemove}
                className="text-xs text-red-400 hover:text-red-300 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
              >
                Revoke Account Authorization
              </button>

              <span className="text-[11px] text-slate-500">
                Account credentials managed by account hook
              </span>
            </div>

            {acct.error && (
              <p
                role="alert"
                className="mt-3 text-sm text-red-400"
              >
                {acct.error}
              </p>
            )}
          </>
        )}
      </div>

      {/* Trading components */}
      {account && (
        <div className="w-full max-w-2xl space-y-6">
          <AgentInsightPanel symbol={ws.symbol ?? account.symbol} prices={ws.priceHistory} />
          <QuoteBoard
            ws={ws}
            accountType={account.accountType}
            symbol={account.symbol}
            botRunning={botRunning}
            onManualBusyChange={setManualBusy}
          />

          <BotPanel
            ws={ws}
            accountType={account.accountType}
            symbol={ws.symbol ?? account.symbol}
            blocked={tradingBlocked}
            onRunningChange={setBotRunning}
          />
        </div>
      )}
    </main>
  );
}