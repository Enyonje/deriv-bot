import Link from "next/link";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/seo";
export const metadata: Metadata = { title: "Deriv Bot FAQ | Automated Trading Questions", description: "Answers about Deriv Bot, account connection, strategies, demo testing, risk controls and automated trading.", alternates: { canonical: siteUrl("/faq") } };
const faqs = [
["Does Deriv Bot guarantee profits?","No. No trading software, AI model or strategy can guarantee profits. Derivatives trading involves substantial risk and losses are possible."],
["Should I test with a demo account first?","Yes. Validate account connectivity, strategy behaviour, risk controls and execution handling on a demo account before considering live trading."],
["Does the AI execute every signal?","No. Signals are candidates. A separate risk policy must approve a proposal before an execution controller can act."],
["Can I connect a real Deriv account?","Real-account availability depends on deployment configuration, account permissions and explicit user authorization. Keep real-money execution disabled until the deployment has been independently tested."],
["Is Deriv Bot financial advice?","No. It is software for market analysis and trading workflows, not investment or financial advice."],
["How should I protect my API token?","Only enter credentials through the secure account connection form. Never share tokens in chat, email, screenshots or support tickets."]
];
export default function FaqPage() {
 const schema={"@context":"https://schema.org","@type":"FAQPage","mainEntity":faqs.map(([q,a])=>({"@type":"Question",name:q,acceptedAnswer:{"@type":"Answer",text:a}}))};
 return <main className="min-h-screen bg-slate-950 text-slate-100"><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}}/><header className="mx-auto flex max-w-5xl justify-between px-6 py-6"><Link href="/" className="font-black">DERIV<span className="text-cyan-400">BOT</span></Link><Link href="/terminal" className="text-cyan-300">Open terminal →</Link></header><article className="mx-auto max-w-4xl px-6 py-16"><h1 className="text-4xl font-black">Frequently asked questions</h1><p className="mt-4 text-slate-400">Important information about using Deriv Bot responsibly.</p><div className="mt-10 divide-y divide-slate-800">{faqs.map(([q,a])=><section key={q} className="py-6"><h2 className="text-xl font-bold">{q}</h2><p className="mt-3 leading-7 text-slate-400">{a}</p></section>)}</div></article></main>;
}
