import Link from "next/link";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Deriv Bot | Automated Trading Tools & Market Intelligence",
  description: "Analyse Deriv markets, evaluate systematic trading strategies and manage automated execution with transparent risk controls.",
  alternates: { canonical: siteUrl("/") },
  openGraph: { title: "Deriv Bot | Automated Trading Tools", description: "Market intelligence, systematic strategies and risk-aware automated trading workflows.", url: siteUrl("/"), type: "website" },
};

const features = [
  ["Market intelligence", "Monitor price behaviour, trend conditions, momentum and volatility across supported markets."],
  ["Strategy evaluation", "Compare rule-based signals and understand why a strategy did or did not qualify."],
  ["Risk controls", "Set session loss limits, trade limits, cooldowns and account-level execution safeguards."],
  ["Execution monitoring", "Review trade status, quotes, account balance and activity from one terminal."],
];

export const dynamic = "force-dynamic";
export default function HomePage() {
  const schema = {
    "@context": "https://schema.org", "@graph": [
      { "@type": "Organization", name: "Deriv Bot", url: siteUrl("/"), logo: siteUrl("/og-derivbot.png") },
      { "@type": "SoftwareApplication", name: "Deriv Bot", applicationCategory: "FinanceApplication", operatingSystem: "Web", description: "A market analysis and automated trading interface for Deriv accounts. Trading involves risk and results are not guaranteed.", url: siteUrl("/") }
    ]
  };
  return <main className="min-h-screen bg-slate-950 text-slate-100">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6"><Link href="/" className="text-xl font-black tracking-tight">DERIV<span className="text-cyan-400">BOT</span></Link><nav className="hidden gap-7 text-sm text-slate-300 md:flex"><Link href="/features">Features</Link><Link href="/ai-trading">AI Trading</Link><Link href="/strategies">Strategies</Link><Link href="/pricing">Pricing</Link><Link href="/faq">FAQ</Link></nav><Link href="/terminal" className="rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-bold text-slate-950">Open terminal</Link></header>
    <section className="mx-auto grid max-w-7xl gap-12 px-6 pb-24 pt-20 md:grid-cols-[1.1fr_.9fr] md:items-center">
      <div><p className="mb-5 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300">MARKET INTELLIGENCE · SYSTEMATIC EXECUTION</p><h1 className="max-w-3xl text-5xl font-black leading-tight tracking-tight md:text-6xl">Trade with a clearer view of the market.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">Deriv Bot brings market scanning, rule-based strategy evaluation, configurable risk controls and trade monitoring into one focused workspace.</p><div className="mt-8 flex flex-wrap gap-4"><Link href="/terminal" className="rounded-lg bg-cyan-400 px-6 py-3 font-bold text-slate-950">Launch trading terminal</Link><Link href="/features" className="rounded-lg border border-slate-700 px-6 py-3 font-semibold">Explore features</Link></div><p className="mt-5 max-w-xl text-xs leading-6 text-slate-500">Trading CFDs and other derivatives involves substantial risk. Automation does not remove market risk or guarantee returns. Test carefully using a demo account.</p></div>
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><span className="text-sm font-semibold text-slate-300">Trading intelligence workspace</span><span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">Risk-aware design</span></div><div className="grid grid-cols-2 gap-3">{[["Market scanning", "Multi-market observation"], ["Strategy signals", "Rule-based evaluation"], ["Risk management", "Independent trade checks"], ["Trade monitoring", "Live status and history"]].map(([a, b]) => <div key={a} className="rounded-xl border border-slate-800 bg-slate-950 p-4"><div className="mb-2 h-2 w-10 rounded bg-cyan-400" /><h2 className="font-bold">{a}</h2><p className="mt-2 text-xs leading-5 text-slate-400">{b}</p></div>)}</div><div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4"><div className="mb-3 flex justify-between text-xs text-slate-400"><span>Execution safeguards</span><span>Always enforced</span></div><div className="h-2 rounded-full bg-slate-800"><div className="h-2 w-4/5 rounded-full bg-cyan-400" /></div><p className="mt-3 text-xs text-slate-500">Signals are proposals. Configured risk rules remain the final gate.</p></div></div>
    </section>
    <section className="border-y border-slate-800 bg-slate-900/40"><div className="mx-auto grid max-w-7xl gap-8 px-6 py-16 md:grid-cols-4">{features.map(([title, body]) => <article key={title}><h2 className="text-lg font-bold">{title}</h2><p className="mt-3 text-sm leading-6 text-slate-400">{body}</p></article>)}</div></section>
    <section className="mx-auto max-w-7xl px-6 py-16"><h2 className="text-3xl font-black">Built around visibility and control</h2><p className="mt-4 max-w-3xl leading-7 text-slate-400">Review signals, inspect the rationale, configure your risk boundaries and monitor activity. Deriv Bot is a software tool, not an investment adviser or a promise of trading performance.</p><Link href="/faq" className="mt-6 inline-block text-cyan-300 underline">Read common questions</Link></section>
    <footer className="border-t border-slate-800 px-6 py-8 text-sm text-slate-500"><div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4"><span>© {new Date().getFullYear()} Deriv Bot. All rights reserved.</span><div className="flex gap-5"><Link href="/about">About</Link><Link href="/contact">Contact</Link><Link href="/risk-disclosure">Risk disclosure</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></div></footer>
  </main>;
}
