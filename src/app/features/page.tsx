import MarketingPage, { marketingMetadata, type MarketingContent } from "@/components/MarketingPage";
const content: MarketingContent = {
  "title": "Deriv Bot Features | Market Scanning, Strategies & Risk Controls",
  "description": "Explore Deriv Bot features for market scanning, strategy evaluation, trade execution monitoring and configurable risk management.",
  "intro": "Deriv Bot combines the key workflows of an automated trading terminal: observe markets, evaluate systematic signals, apply risk rules and monitor execution.",
  "sections": [
    {
      "heading": "Multi-market scanning",
      "body": "Observe supported Deriv markets and compare signal conditions and available contract quotes. Market scanning helps organize information; it does not predict market outcomes."
    },
    {
      "heading": "Strategy evaluation",
      "body": "Use defined technical strategies and indicators to produce explainable signals. Review the signal rationale and strategy performance rather than relying on unsupported win-rate claims."
    },
    {
      "heading": "Risk controls",
      "body": "Configure stake boundaries, session loss limits, trade quotas, cooldown periods and consecutive-loss circuit breakers. The risk gate should be treated as a mandatory control, not a profitability feature."
    },
    {
      "heading": "Execution visibility",
      "body": "Monitor account connection status, balance, quotes, active contracts and trade outcomes through the trading terminal."
    }
  ]
};
export const metadata = marketingMetadata(content, "/features");
export default function Page() { return <MarketingPage content={content} path="/features"/>; }
